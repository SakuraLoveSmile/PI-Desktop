import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api } from "../lib/api";

export type HostCollectionLoadResult = "loaded" | "failed" | "stale";

export type HostCollection<T> = {
  data: T;
  setData: Dispatch<SetStateAction<T>>;
  /** First paint only: the page shows skeletons until the first load lands. */
  loading: boolean;
  /** Later reloads keep the rows on screen and only dim them. */
  refreshing: boolean;
  /** Captures this mounted fetcher's lifetime before an external write or read. */
  captureOwner: () => () => boolean;
  /** Superseded or retired reads never count as a failed refresh. */
  reload: (options?: { reportError?: boolean }) => Promise<HostCollectionLoadResult>;
};

/**
 * Loads a host-backed collection and reloads it whenever a plugin changes or
 * the host comes back (the agent capability pages: skills, MCP servers,
 * subagents).
 *
 * Skeletons belong to the first paint only; later reloads dim the list instead
 * of tearing it down, so toggling a row never blinks the page away. Every
 * request is stamped with a counter and only the newest one may write state,
 * so a slow fetch for the previous project can never land after the current
 * one and overwrite it.
 */
export function useHostCollection<T>(
  fetcher: () => Promise<T>,
  empty: T,
  onError: (error: unknown) => void,
): HostCollection<T> {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hydrated = useRef(false);
  const latestRequest = useRef(0);
  const ownerRef = useRef<{ fetcher: () => Promise<T>; active: boolean } | null>(null);
  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const captureOwner = useCallback(() => {
    const owner = ownerRef.current;
    return () => owner !== null && owner.active && owner === ownerRef.current && owner.fetcher === fetcher;
  }, [fetcher]);

  const reload = useCallback(async (options?: { reportError?: boolean }): Promise<HostCollectionLoadResult> => {
    const owner = ownerRef.current;
    // A save can finish after its page/project has changed. Its old reload
    // closure must not claim a new request number or revive the retired fetcher.
    if (!owner?.active || owner.fetcher !== fetcher) return "stale";
    const requestId = ++latestRequest.current;
    const isCurrent = () => owner.active && owner === ownerRef.current && requestId === latestRequest.current;
    if (hydrated.current) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await fetcher();
      if (!isCurrent()) return "stale";
      setData(next);
      hydrated.current = true;
      return "loaded";
    } catch (error) {
      if (!isCurrent()) return "stale";
      if (options?.reportError !== false) onErrorRef.current(error);
      setData(emptyRef.current);
      return "failed";
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    const owner = { fetcher, active: true };
    ownerRef.current = owner;
    void reload();
    const offPluginChanged = api.onPluginChanged(() => void reload());
    const offHostStatus = api.onHostStatus((status) => {
      if (status.ok) void reload();
    });
    return () => {
      owner.active = false;
      offPluginChanged();
      offHostStatus();
      // Retire any request still in flight so it cannot write after unmount
      // or after the fetcher (e.g. the selected project) has changed.
      latestRequest.current += 1;
    };
  }, [fetcher, reload]);

  return { data, setData, loading, refreshing, reload, captureOwner };
}
