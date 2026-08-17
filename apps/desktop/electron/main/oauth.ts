/**
 * Vendor-account (OAuth) login for model providers.
 *
 * pi-ai owns the seven login flows and the locked token refresh; persistence
 * and the user-facing half of the conversation are the app's job (see
 * `auth/types.d.ts`: "Login/logout orchestration is app-owned"). This module is
 * that half:
 *
 *  - a CredentialStore backed by host-core's encrypted secret store, keyed
 *    `secret:provider:<providerRowId>:oauth` so an API key and a vendor account
 *    can coexist on one provider row;
 *  - a bridge from pi-ai's prompt/notify interaction to renderer events;
 *  - short-lived request auth (`ModelAuth`) for the agent sidecar.
 *
 * Refresh tokens never leave the main process: callers get either a boolean, a
 * non-secret account label, or an already-resolved `ModelAuth`.
 */

import { randomUUID } from "node:crypto";

import { getSupportedThinkingLevels, InMemoryModelsStore } from "@earendil-works/pi-ai";
import type {
  Api,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential,
  CredentialInfo,
  CredentialStore,
  Model,
  ModelAuth,
  MutableModels,
  Provider,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  piModelConfigFromModel,
  type VendorModelBinding,
} from "@pi-desktop/agent-runtime";
import {
  OAUTH_AUTH_KIND,
  type OAuthLoginEvent,
  type OAuthPromptRequest,
  type OAuthRespondInput,
  type OAuthStartResult,
  type OAuthVendor,
  type ThinkingLevel,
} from "@pi-desktop/shared";

export { OAUTH_AUTH_KIND };

/** Mirrors `secret_ref_for_provider_oauth` in crates/host-core/src/secrets.rs. */
export function secretRefForProviderOauth(providerId: string): string {
  return `secret:provider:${providerId}:oauth`;
}

const API_STYLE_BY_WIRE_API: Record<string, string> = {
  "anthropic-messages": "anthropic_messages",
  "openai-completions": "chat_completions",
  "openai-responses": "responses",
  "openai-codex-responses": "openai_codex_responses",
  "google-generative-ai": "google_generative_ai",
  "pi-messages": "pi_messages",
};

const PROTOCOL_BY_API_STYLE: Record<string, string> = {
  anthropic_messages: "anthropic",
  chat_completions: "openai_compatible",
  responses: "openai",
  openai_codex_responses: "openai",
  google_generative_ai: "google",
  pi_messages: "custom_http",
};

/**
 * A provider row stores one apiStyle, but a vendor can span wire APIs (GitHub
 * Copilot serves Anthropic, Chat Completions and Responses models), so the
 * style follows the selected model rather than the vendor.
 */
export function apiStyleForWireApi(api: string): string {
  return API_STYLE_BY_WIRE_API[api] ?? "chat_completions";
}

export function protocolForApiStyle(apiStyle: string): string {
  return PROTOCOL_BY_API_STYLE[apiStyle] ?? "openai_compatible";
}

export type HostCall = <T = unknown>(
  method: string,
  params?: unknown,
) => Promise<T>;

/** The slice of a provider row this module reads; the rest stays in index.ts. */
export type OAuthProviderRow = {
  id: string;
  vendorKey?: string;
  authKind?: string;
  hasOauth?: boolean;
  oauthAccountLabel?: string;
  baseUrl?: string;
  defaultModelId?: string;
};

/** A model offered by a signed-in vendor, with the row fields it implies. */
export type OAuthModelOption = {
  modelId: string;
  displayName: string;
  apiStyle: string;
  baseUrl: string;
};

export type VendorOAuthDeps = {
  /** host-core RPC. Only the generic `secrets.*` and `providers.*` methods. */
  call: HostCall;
  /** Push login progress to the renderer. Never carries token material. */
  emit: (event: OAuthLoginEvent) => void;
  /** Open the vendor's consent page; rejects when no browser could be launched. */
  openExternal: (url: string) => Promise<void>;
  log?: (
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ) => void;
  /** Test seam: build the pi-ai collection without touching the real flows. */
  createModels?: (credentials: CredentialStore) => MutableModels;
  newId?: () => string;
};

/**
 * A login event minus the identifiers `push()` stamps on. Distributed over the
 * union so each variant keeps its own fields.
 */
type OAuthEventBody = OAuthLoginEvent extends infer Variant
  ? Variant extends unknown
    ? Omit<Variant, "loginId" | "vendorId">
    : never
  : never;

type PendingPrompt = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

type LoginSession = {
  loginId: string;
  vendorId: string;
  providerId: string;
  /** Whether this login created the row, and so owns cleaning it up on failure. */
  createdRow: boolean;
  controller: AbortController;
  prompts: Map<string, PendingPrompt>;
  /** Serializes renderer events so `authUrl` cannot overtake an earlier notice. */
  tail: Promise<void>;
};

function promptRequest(
  promptId: string,
  prompt: AuthPrompt,
): OAuthPromptRequest {
  return {
    promptId,
    type: prompt.type,
    message: prompt.message,
    placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
    options:
      prompt.type === "select"
        ? prompt.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
          }))
        : undefined,
  };
}

export class VendorOAuth {
  private readonly deps: VendorOAuthDeps;
  private readonly logins = new Map<string, LoginSession>();
  /** pi-ai provider id → PI-Desktop provider row id. */
  private readonly rowIds = new Map<string, string>();
  /** Per-vendor write chain: `modify` must be a serialized read-modify-write. */
  private readonly chains = new Map<string, Promise<unknown>>();
  private modelsPromise?: Promise<MutableModels>;

  constructor(deps: VendorOAuthDeps) {
    this.deps = deps;
  }

  /** Every vendor pi-ai can sign in to, paired with its local row if any. */
  async listVendors(): Promise<OAuthVendor[]> {
    const models = await this.ensureModels();
    const rows = await this.rows();
    return models
      .getProviders()
      .filter((provider) => provider.auth.oauth)
      .map((provider) => {
        const oauth = provider.auth.oauth!;
        const row = rows.find(
          (candidate) =>
            candidate.authKind === OAUTH_AUTH_KIND &&
            candidate.vendorKey === provider.id,
        );
        return {
          vendorId: provider.id,
          name: oauth.name || provider.name,
          loginLabel: oauth.loginLabel,
          isSubscription: oauth.isSubscription === true,
          providerId: row?.id,
          accountLabel: row?.oauthAccountLabel,
          signedIn: row?.hasOauth === true,
        };
      });
  }

  /**
   * Begin a login. The provider row is created first so the credential has a
   * stable secret ref to land in; a login that fails or is cancelled takes the
   * row it created back out.
   */
  async start(vendorId: string): Promise<OAuthStartResult> {
    const models = await this.ensureModels();
    const provider = models.getProvider(vendorId);
    if (!provider?.auth.oauth) {
      throw new Error(`unknown vendor account: ${vendorId}`);
    }
    // A second click replaces the attempt in flight rather than racing it.
    for (const running of this.logins.values()) {
      if (running.vendorId === vendorId) this.cancel(running.loginId);
    }

    const row = await this.ensureRow(vendorId, provider);
    const session: LoginSession = {
      loginId: this.nextId(),
      vendorId,
      providerId: row.providerId,
      createdRow: row.created,
      controller: new AbortController(),
      prompts: new Map(),
      tail: Promise.resolve(),
    };
    this.logins.set(session.loginId, session);
    void this.run(session, provider);
    return { loginId: session.loginId };
  }

  /** Answer a prompt. An absent value cancels the prompt and the login. */
  respond(input: OAuthRespondInput): boolean {
    const session = this.logins.get(input.loginId);
    const pending = session?.prompts.get(input.promptId);
    if (!session || !pending) return false;
    if (input.value === undefined) {
      pending.reject(new Error("login cancelled"));
      session.controller.abort();
    } else {
      pending.resolve(input.value);
    }
    return true;
  }

  /** Abort a login: stops the local callback server or device-code polling. */
  cancel(loginId: string): boolean {
    const session = this.logins.get(loginId);
    if (!session) return false;
    session.controller.abort();
    return true;
  }

  /** Forget the credential, keeping the row (and its model choice) in place. */
  async logout(vendorId: string): Promise<void> {
    const models = await this.ensureModels();
    await models.logout(vendorId);
    const providerId = await this.rowIdFor(vendorId);
    if (providerId) {
      await this.deps.call("providers.update", {
        id: providerId,
        oauthAccountLabel: "",
      });
    }
  }

  /**
   * Resolve request auth for one model request. pi-ai refreshes the token under
   * the store lock when it has expired; the caller only ever sees the resulting
   * short-lived access token, headers and per-credential baseUrl.
   */
  async resolveAuth(vendorId: string): Promise<ModelAuth> {
    const models = await this.ensureModels();
    const resolved = await models.getAuth(vendorId);
    if (!resolved) throw new Error(`vendor account not signed in: ${vendorId}`);
    return resolved.auth;
  }

  /**
   * Models the signed-in account may actually use. This replaces the `/models`
   * probe: `getAvailable` applies the vendor's own `filterModels`, which is how
   * Copilot narrows the list to the user's subscription.
   */
  async listModels(vendorId: string): Promise<OAuthModelOption[]> {
    const models = await this.ensureModels();
    // Dynamic catalogs (radius, Copilot) are empty until refreshed; static and
    // unconfigured providers are skipped inside pi-ai.
    await models.refresh({ providers: [vendorId] });
    const available = await models.getAvailable(vendorId);
    return available.map((model) => this.optionFor(model));
  }

  private optionFor(model: Model<Api>): OAuthModelOption {
    return {
      modelId: model.id,
      displayName: model.name || model.id,
      apiStyle: apiStyleForWireApi(model.api),
      baseUrl: model.baseUrl,
    };
  }

  /**
   * Everything a provider binding needs for one model of a signed-in account.
   *
   * A vendor row cannot take this from the builtin catalog: one account spans
   * wire APIs (GitHub Copilot serves Anthropic, Chat Completions and Responses
   * models, so the selected model — not the row — decides the style), and a
   * gateway's catalog (radius) is not in the builtin one at all. The
   * authenticated collection knows both.
   */
  async bindingFor(
    vendorId: string,
    modelId: string,
  ): Promise<VendorModelBinding | undefined> {
    const models = await this.ensureModels();
    let model = models.getModel(vendorId, modelId);
    if (!model) {
      // Dynamic catalogs are empty until the first refresh.
      await models.refresh({ providers: [vendorId] });
      model = models.getModel(vendorId, modelId);
    }
    if (!model) return undefined;
    const levels: ThinkingLevel[] = model.reasoning
      ? [...(getSupportedThinkingLevels(model) as ThinkingLevel[])]
      : ["off"];
    return {
      apiStyle: apiStyleForWireApi(model.api),
      baseUrl: model.baseUrl,
      modelConfig: piModelConfigFromModel(model),
      supportsReasoning: model.reasoning === true,
      supportedThinkingLevels: levels,
    };
  }

  private async run(session: LoginSession, provider: Provider): Promise<void> {
    try {
      await (
        await this.ensureModels()
      ).login(session.vendorId, "oauth", this.interactionFor(session));
      const accountLabel = provider.auth.oauth?.name || provider.name;
      await this.completeRow(session, provider, accountLabel);
      this.push(session, {
        kind: "done",
        providerId: session.providerId,
        accountLabel,
      });
    } catch (error) {
      await this.discardRow(session);
      if (session.controller.signal.aborted) {
        this.push(session, { kind: "cancelled" });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.log("warn", "vendor account login failed", {
          vendorId: session.vendorId,
          message,
        });
        this.push(session, { kind: "error", message });
      }
    } finally {
      for (const pending of session.prompts.values()) {
        pending.reject(new Error("login finished"));
      }
      await session.tail;
      this.logins.delete(session.loginId);
    }
  }

  /** Point the row at a usable model now that the catalog can be read. */
  private async completeRow(
    session: LoginSession,
    provider: Provider,
    accountLabel: string,
  ): Promise<void> {
    let chosen: OAuthModelOption | undefined;
    try {
      const options = await this.listModels(session.vendorId);
      chosen = options[0];
    } catch (error) {
      // A catalog that will not load is not worth failing a good login over;
      // the row stays selectable and the model picker retries later.
      this.log("warn", "vendor model catalog unavailable after login", {
        vendorId: session.vendorId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const apiStyle = chosen?.apiStyle;
    await this.deps.call("providers.update", {
      id: session.providerId,
      name: provider.auth.oauth?.name || provider.name,
      authKind: OAUTH_AUTH_KIND,
      oauthAccountLabel: accountLabel,
      baseUrl: chosen?.baseUrl ?? provider.baseUrl,
      ...(apiStyle
        ? {
            apiStyle,
            protocol: protocolForApiStyle(apiStyle),
            defaultModelId: chosen?.modelId,
          }
        : {}),
    });
  }

  private async discardRow(session: LoginSession): Promise<void> {
    if (!session.createdRow) return;
    try {
      await this.deps.call("providers.delete", { id: session.providerId });
      this.rowIds.delete(session.vendorId);
    } catch (error) {
      this.log("warn", "could not remove the half-created provider row", {
        vendorId: session.vendorId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private interactionFor(session: LoginSession): AuthInteraction {
    return {
      signal: session.controller.signal,
      prompt: (prompt) => this.ask(session, prompt),
      notify: (event) => this.notify(session, event),
    };
  }

  private ask(session: LoginSession, prompt: AuthPrompt): Promise<string> {
    const promptId = this.nextId();
    return new Promise<string>((resolve, reject) => {
      const cleanups: Array<() => void> = [];
      const settle = () => {
        session.prompts.delete(promptId);
        for (const cleanup of cleanups) cleanup();
      };
      const entry: PendingPrompt = {
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      };
      session.prompts.set(promptId, entry);

      // The flow cancels a prompt when it answers the step itself — a callback
      // that beats the paste box — so the renderer has to close that input.
      const abort = () => {
        this.push(session, { kind: "promptCancelled", promptId });
        entry.reject(new Error("prompt cancelled"));
      };
      for (const signal of [prompt.signal, session.controller.signal]) {
        if (!signal) continue;
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", abort));
      }

      this.push(session, {
        kind: "prompt",
        request: promptRequest(promptId, prompt),
      });
    });
  }

  private notify(session: LoginSession, event: AuthEvent): void {
    switch (event.type) {
      case "info":
        this.push(session, {
          kind: "info",
          message: event.message,
          links: event.links?.map((link) => ({
            url: link.url,
            label: link.label,
          })),
        });
        return;
      case "auth_url":
        this.pushAuthUrl(session, event.url, event.instructions);
        return;
      case "device_code":
        this.push(session, {
          kind: "deviceCode",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
        return;
      case "progress":
        this.push(session, { kind: "progress", message: event.message });
    }
  }

  private pushAuthUrl(
    session: LoginSession,
    url: string,
    instructions?: string,
  ): void {
    session.tail = session.tail.then(async () => {
      // Report whether the browser actually opened: when it did not, the
      // renderer has to offer the link for copying instead.
      const opened = await this.deps.openExternal(url).then(
        () => true,
        () => false,
      );
      this.deps.emit({
        loginId: session.loginId,
        vendorId: session.vendorId,
        kind: "authUrl",
        url,
        instructions,
        opened,
      });
    });
  }

  private push(session: LoginSession, event: OAuthEventBody): void {
    session.tail = session.tail.then(() => {
      this.deps.emit({
        ...event,
        loginId: session.loginId,
        vendorId: session.vendorId,
      } as OAuthLoginEvent);
    });
  }

  private async ensureModels(): Promise<MutableModels> {
    this.modelsPromise ??= (async () => {
      if (this.deps.createModels) return this.deps.createModels(this.credentials);
      // pi-ai loads each flow through a variable import specifier so bundlers
      // cannot follow it into Node-only code; registering the static set keeps
      // login working in the packaged app. Named for the Bun binary, but the
      // flows themselves are plain Node.
      registerBunOAuthFlows();
      return builtinModels({
        credentials: this.credentials,
        modelsStore: new InMemoryModelsStore(),
      });
    })();
    return this.modelsPromise;
  }

  /**
   * Credential storage, keyed by pi-ai provider id and translated to the
   * provider row's secret ref. `modify` is the only write path and is
   * serialized per vendor, which is what pi-ai's locked refresh assumes.
   */
  private readonly credentials: CredentialStore = {
    read: (vendorId) => this.readCredential(vendorId),
    list: async () => {
      // Enumerate from row metadata so status never decrypts a token.
      const rows = await this.rows();
      return rows.flatMap<CredentialInfo>((row) =>
        row.authKind === OAUTH_AUTH_KIND && row.hasOauth && row.vendorKey
          ? [{ providerId: row.vendorKey, type: "oauth" }]
          : [],
      );
    },
    modify: (vendorId, fn) =>
      this.serialize(vendorId, async () => {
        const current = await this.readCredential(vendorId);
        const next = await fn(current);
        if (next === undefined) return current;
        const ref = await this.secretRef(vendorId);
        if (!ref) throw new Error(`no provider row for vendor ${vendorId}`);
        await this.deps.call("secrets.set", {
          secretRef: ref,
          value: JSON.stringify(next),
        });
        return next;
      }),
    delete: (vendorId) =>
      this.serialize(vendorId, async () => {
        const ref = await this.secretRef(vendorId);
        if (ref) await this.deps.call("secrets.delete", { secretRef: ref });
      }),
  };

  private async readCredential(
    vendorId: string,
  ): Promise<Credential | undefined> {
    const ref = await this.secretRef(vendorId);
    if (!ref) return undefined;
    const { value } = await this.deps.call<{ value?: string | null }>(
      "secrets.getForRuntime",
      { secretRef: ref },
    );
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as Credential;
      return parsed?.type ? parsed : undefined;
    } catch {
      this.log("warn", "stored vendor credential is not readable", { vendorId });
      return undefined;
    }
  }

  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async secretRef(vendorId: string): Promise<string | undefined> {
    const providerId = await this.rowIdFor(vendorId);
    return providerId ? secretRefForProviderOauth(providerId) : undefined;
  }

  private async rowIdFor(vendorId: string): Promise<string | undefined> {
    const known = this.rowIds.get(vendorId);
    if (known) return known;
    const row = (await this.rows()).find(
      (candidate) =>
        candidate.authKind === OAUTH_AUTH_KIND &&
        candidate.vendorKey === vendorId,
    );
    if (row) this.rowIds.set(vendorId, row.id);
    return row?.id;
  }

  private async ensureRow(
    vendorId: string,
    provider: Provider,
  ): Promise<{ providerId: string; created: boolean }> {
    const existing = await this.rowIdFor(vendorId);
    if (existing) return { providerId: existing, created: false };
    const { provider: created } = await this.deps.call<{
      provider: OAuthProviderRow;
    }>("providers.create", {
      name: provider.auth.oauth?.name || provider.name,
      vendorKey: vendorId,
      type: "native",
      authKind: OAUTH_AUTH_KIND,
      baseUrl: provider.baseUrl,
    });
    this.rowIds.set(vendorId, created.id);
    return { providerId: created.id, created: true };
  }

  private async rows(): Promise<OAuthProviderRow[]> {
    const result = await this.deps.call<{ providers?: OAuthProviderRow[] }>(
      "providers.list",
      { includeDisabled: true },
    );
    return result.providers ?? [];
  }

  private nextId(): string {
    return this.deps.newId?.() ?? randomUUID();
  }

  private log(
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.deps.log?.(level, message, data);
  }
}
