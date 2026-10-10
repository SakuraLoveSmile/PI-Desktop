import { useSyncExternalStore } from "react";
import type { ModelInfo, ProviderPublic } from "@pi-desktop/shared";

type StoreState = {
  providers: ProviderPublic[];
  providerModels: Record<string, ModelInfo[]>;
  settings: undefined;
  settingsTab: string | undefined;
  setSettingsTab: (tab: string) => void;
  loadProviderModels: (providerId: string) => Promise<void>;
  showToast: (message: string) => void;
};

const listeners = new Set<() => void>();
let state: StoreState = {
  providers: [],
  providerModels: {},
  settings: undefined,
  settingsTab: undefined,
  setSettingsTab: (settingsTab) => useAppStore.setState({ settingsTab }),
  loadProviderModels: async () => {},
  showToast: () => {},
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const useAppStore = Object.assign(
  function useAppStore<T>(selector: (state: StoreState) => T): T {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    );
  },
  {
    getState: () => state,
    setState: (next: Partial<StoreState>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  },
);

export { useAppStore };
