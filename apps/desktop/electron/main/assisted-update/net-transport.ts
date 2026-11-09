import type { HttpResponse, HttpTransport } from "./download";
import { AssistedUpdateError } from "./errors";

/** The slice of Electron's `net` module the transport uses. */
export type ElectronNet = {
  request(options: {
    url: string;
    method: string;
    redirect: "manual";
    credentials: "omit";
    useSessionCookies: false;
  }): ElectronClientRequest;
};

export type ElectronClientRequest = {
  on(event: "response", listener: (response: ElectronIncomingMessage) => void): unknown;
  on(event: "redirect", listener: (status: number, method: string, url: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  followRedirect(): void;
  abort(): void;
  end(): void;
};

export type ElectronIncomingMessage = AsyncIterable<Uint8Array> & {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Downloads through Electron's network stack so the user's outbound proxy
 * setting applies (ADR 0177). Redirects are decided synchronously by the
 * caller; no cookie or credential is sent.
 */
export function createElectronNetTransport(net: ElectronNet): HttpTransport {
  return {
    get(url, { signal, allowRedirect }) {
      return new Promise<HttpResponse>((resolve, reject) => {
        const request = net.request({
          url,
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          useSessionCookies: false,
        });
        const onAbort = () => {
          request.abort();
          reject(new AssistedUpdateError("aborted", "download cancelled"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        request.on("redirect", (_status, _method, target) => {
          if (allowRedirect(target)) {
            request.followRedirect();
          } else {
            request.abort();
            reject(new AssistedUpdateError("redirect-rejected", "redirect refused"));
          }
        });
        request.on("response", (response) => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: response,
          });
        });
        request.on("error", (error) => reject(error));
        request.end();
      });
    },
  };
}
