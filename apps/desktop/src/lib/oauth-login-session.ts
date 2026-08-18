/**
 * One vendor-account login attempt, seen from the renderer (ADR 0095).
 *
 * The ordering here is the whole point. A flow can ask its first question
 * before `providersOauthStart` has even returned — OpenAI Codex opens with a
 * browser-or-device-code choice, and pi-ai raises it in the same tick the login
 * begins — so a listener attached after the start call resolves misses it and
 * the dialog waits forever on a question nobody sees. This subscribes first and
 * starts second, holding events that arrive before the login id is known and
 * releasing them in order once it is.
 */
import type {
  OAuthLoginEvent,
  OAuthRespondInput,
  OAuthStartResult,
} from "@pi-desktop/shared";

/** The slice of the preload API a login needs; injected so it can be tested. */
export type OAuthLoginApi = {
  onOauthLogin: (listener: (event: OAuthLoginEvent) => void) => () => void;
  startOauthLogin: (vendorId: string) => Promise<OAuthStartResult>;
  respondOauthLogin: (input: OAuthRespondInput) => Promise<{ ok: boolean }>;
  cancelOauthLogin: (loginId: string) => Promise<{ ok: boolean }>;
};

export type OAuthLoginSession = {
  /** Answer a prompt the flow raised. */
  respond: (promptId: string, value: string) => Promise<void>;
  /**
   * Abort the login, stopping the local callback server or device-code poll.
   * Resolves false when main no longer knows the attempt — it already ended.
   */
  cancel: () => Promise<boolean>;
  /** Stop listening. Does not cancel the login. */
  dispose: () => void;
};

export function beginOAuthLogin({
  api,
  vendorId,
  onEvent,
  onError,
}: {
  api: OAuthLoginApi;
  vendorId: string;
  onEvent: (event: OAuthLoginEvent) => void;
  /** The login could not be started at all. */
  onError: (message: string) => void;
}): OAuthLoginSession {
  let loginId: string | null = null;
  let disposed = false;
  let pending: OAuthLoginEvent[] = [];

  const deliver = (event: OAuthLoginEvent) => {
    if (disposed) return;
    onEvent(event);
  };

  const unsubscribe = api.onOauthLogin((event) => {
    if (disposed) return;
    if (loginId === null) {
      // The id is still in flight; keep the event until it can be matched.
      pending.push(event);
      return;
    }
    if (event.loginId === loginId) deliver(event);
  });

  const started = api.startOauthLogin(vendorId).then(
    (result) => {
      loginId = result.loginId;
      const held = pending;
      pending = [];
      for (const event of held) {
        if (event.loginId === loginId) deliver(event);
      }
      return result.loginId;
    },
    (error: unknown) => {
      pending = [];
      if (!disposed) {
        onError(error instanceof Error ? error.message : String(error));
      }
      return null;
    },
  );

  return {
    respond: async (promptId, value) => {
      const id = await started;
      if (id === null) return;
      await api.respondOauthLogin({ loginId: id, promptId, value });
    },
    cancel: async () => {
      const id = await started;
      if (id === null) return false;
      const result = await api.cancelOauthLogin(id);
      return result?.ok === true;
    },
    dispose: () => {
      disposed = true;
      pending = [];
      unsubscribe();
    },
  };
}
