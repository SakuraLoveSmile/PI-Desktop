import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type FetchFunction,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  classifyAgentError,
  type ClassifiedAgentError,
} from "./agent-errors.js";

/** Maximum number of retries after the first rate-limited request. */
export const PROVIDER_RATE_LIMIT_MAX_RETRIES = 5;
export const PROVIDER_RATE_LIMIT_INITIAL_DELAY_MS = 2_000;
export const PROVIDER_RATE_LIMIT_JITTER_FACTOR = 0.25;
/** Keep a provider outage bounded even when it sends an unusably long delay. */
export const PROVIDER_RATE_LIMIT_MAX_DELAY_MS = 30_000;
/** Preserve pi-ai's short setup retry for non-rate-limit transient failures. */
export const PROVIDER_SETUP_RETRY_INITIAL_DELAY_MS = 500;
export const PROVIDER_SETUP_MAX_RETRY_DELAY_MS = 8_000;

export type ProviderRetryPhase = "request" | "stream";

export type ProviderResponseSnapshot = {
  status: number;
  headers: Record<string, string>;
};

export type ProviderRetryController = {
  /** Claim one retry in the shared logical-turn budget. */
  claim: (
    error: ClassifiedAgentError,
    phase: ProviderRetryPhase,
  ) => number | undefined;
  /** Headers captured from the failed HTTP response, if any. */
  headers: () => Readonly<Record<string, string>> | undefined;
  /** Status captured even when the provider body omits the HTTP code. */
  status?: () => number | undefined;
  onRetry?: (input: {
    error: ClassifiedAgentError;
    phase: ProviderRetryPhase;
    attempt: number;
    delayMs: number;
  }) => void;
  /** Test hook; production uses the abortable timer below. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Apply a captured HTTP 429 before relying on provider error wording. Some
 * adapters return a generic body (or `fetch failed`) even though the response
 * status is rate limiting. Keep explicit non-retryable classifications such as
 * auth and context errors terminal.
 */
export function classifyProviderError(
  error: unknown,
  providerStatus?: number,
): ClassifiedAgentError {
  const classified = classifyAgentError(error);
  if (
    providerStatus === 429 &&
    classified.code !== "PROVIDER_RATE_LIMITED" &&
    classified.retriable
  ) {
    return {
      ...classified,
      code: "PROVIDER_RATE_LIMITED",
      retriable: true,
      details: {
        ...classified.details,
        providerStatus,
      },
    };
  }
  return classified;
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  return entry?.[1];
}

function boundedServerDelay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PROVIDER_RATE_LIMIT_MAX_DELAY_MS, Math.max(0, Math.ceil(value)));
}

/**
 * OpenCode's order of precedence: provider milliseconds, Retry-After seconds,
 * HTTP-date, then exponential backoff with positive jitter. Header values are
 * capped so a bad or stale server response cannot hold a turn indefinitely.
 */
export function providerRateLimitDelayMs(
  attempt: number,
  headers?: Readonly<Record<string, string>>,
  now = Date.now(),
  random = Math.random(),
): number {
  const retryAfterMs = headerValue(headers, "retry-after-ms");
  if (retryAfterMs !== undefined && retryAfterMs.trim() !== "") {
    const parsed = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsed)) return boundedServerDelay(parsed);
  }

  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined && retryAfter.trim() !== "") {
    const seconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(seconds)) {
      return boundedServerDelay(seconds * 1_000);
    }
    const dateMs = Date.parse(retryAfter) - now;
    if (!Number.isNaN(dateMs)) {
      return boundedServerDelay(dateMs);
    }
  }

  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = PROVIDER_RATE_LIMIT_INITIAL_DELAY_MS * 2 ** (safeAttempt - 1);
  const jitter = Math.min(1, Math.max(0, random));
  return Math.min(
    PROVIDER_RATE_LIMIT_MAX_DELAY_MS,
    Math.ceil(base + base * PROVIDER_RATE_LIMIT_JITTER_FACTOR * jitter),
  );
}

/** The non-429 setup retry retains pi-ai's short exponential shape. */
export function providerSetupRetryDelayMs(
  attempt: number,
  random = Math.random(),
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = PROVIDER_SETUP_RETRY_INITIAL_DELAY_MS * 2 ** (safeAttempt - 1);
  const jitter = Math.min(1, Math.max(0, random));
  return Math.min(
    PROVIDER_SETUP_MAX_RETRY_DELAY_MS,
    Math.ceil(base * (1 - PROVIDER_RATE_LIMIT_JITTER_FACTOR * jitter)),
  );
}

export function delayWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Capture HTTP status/headers, including failed 429 responses that pi-ai's
 * onResponse callback intentionally does not expose. */
export function captureProviderResponse(
  fetchFn: FetchFunction | undefined,
  onResponse: (response?: ProviderResponseSnapshot) => void,
): FetchFunction {
  const baseFetch = fetchFn ?? globalThis.fetch;
  return async (input, init) => {
    // Clear the previous response before a new fetch. If this request fails
    // before receiving headers, a prior 429 must not classify the new failure.
    onResponse();
    const response = await baseFetch(input, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    onResponse({ status: response.status, headers });
    return response;
  };
}

function normalizeRateLimitMessage(message: AssistantMessage): AssistantMessage {
  const errorMessage = message.errorMessage ?? "";
  if (/^\s*429\b/.test(errorMessage)) return message;
  return {
    ...message,
    errorMessage: `429: ${errorMessage || "provider rate limited"}`,
  };
}

function setupErrorMessage(
  model: Model<Api>,
  error: unknown,
  aborted: boolean,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

type StreamFactory = (
  options: SimpleStreamOptions,
) => AssistantMessageEventStream;

/**
 * pi-ai returns setup failures as an error event rather than throwing. This
 * adapter consumes only those pre-stream failures, retries them through the
 * shared controller, and forwards every event from a started stream unchanged
 * so runtime mid-stream recovery can replace the visible assistant safely.
 */
export function createProviderRetryStream(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  createStream: StreamFactory,
  controller: ProviderRetryController,
): AssistantMessageEventStream {
  // Keep the context in the signature: it prevents callers from accidentally
  // building a retry stream around a different request than the provider call.
  void context;
  const outer = createAssistantMessageEventStream();
  const sleep = controller.sleep ?? delayWithAbort;

  void (async () => {
    for (;;) {
      const inner = createStream({ ...options, maxRetries: 0 });
      let sawStart = false;
      let retry:
        | { error: ClassifiedAgentError; attempt: number }
        | undefined;

      for await (const event of inner) {
        if (event.type === "start") sawStart = true;
        if (
          !sawStart &&
          event.type === "error" &&
          event.reason === "error"
        ) {
          const errorMessage =
            typeof event.error.errorMessage === "string"
              ? event.error.errorMessage
              : event.error;
          const error = classifyProviderError(
            errorMessage,
            controller.status?.(),
          );
          const attempt = controller.claim(error, "request");
          if (attempt !== undefined) {
            retry = { error, attempt };
            break;
          }
        }
        const forwardedEvent =
          event.type === "error" &&
          event.reason === "error" &&
          controller.status?.() === 429
            ? { ...event, error: normalizeRateLimitMessage(event.error) }
            : event;
        outer.push(forwardedEvent);
      }

      if (!retry) {
        const result = await inner.result();
        const finalResult =
          result.stopReason === "error" && controller.status?.() === 429
            ? normalizeRateLimitMessage(result)
            : result;
        outer.end(finalResult);
        return;
      }

      // The failed event has already ended this inner stream. Awaiting its
      // result keeps providers with deferred cleanup from overlapping retries.
      await inner.result();
      const delayMs =
        retry.error.code === "PROVIDER_RATE_LIMITED"
          ? providerRateLimitDelayMs(
              retry.attempt,
              controller.headers(),
            )
          : providerSetupRetryDelayMs(retry.attempt);
      controller.onRetry?.({
        error: retry.error,
        phase: "request",
        attempt: retry.attempt,
        delayMs,
      });
      await sleep(delayMs, options.signal);
    }
  })().catch((error) => {
    const aborted =
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError");
    const message = setupErrorMessage(model, error, Boolean(aborted));
    outer.push({
      type: "error",
      reason: message.stopReason === "aborted" ? "aborted" : "error",
      error: message,
    });
    outer.end(message);
  });

  return outer;
}
