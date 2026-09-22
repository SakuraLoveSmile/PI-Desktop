/**
 * Trust policy for the network endpoints a user enters themselves.
 *
 * Address judgement lives in `public-network.ts`, which answers "is this
 * address public?". This module answers the separate question the app asks
 * before it applies that judgement: "did the user type this endpoint in
 * themselves, and did they accept the plaintext case for it?".
 *
 * Endpoints the user typed — a model base URL, an MCP server, a market source,
 * a git remote, a WebDAV root — are that person's own choice, so the guard
 * treats loopback and LAN addresses as reachable. Content the app did not
 * receive from the user — a registry record, a market catalog body, an HTTP
 * redirect target — keeps the strict public-network policy, because that is
 * where the SSRF risk lives.
 */

/**
 * Who chose the address one request is judged for.
 *
 * `user` is an endpoint the person typed into a settings field: their own
 * machine, their own LAN service, their own public server. `third-party` is
 * everything the app did not receive from them — a redirect target, a catalog
 * body, a registry record — which keeps the strict public-network policy,
 * because that is the input an attacker controls.
 */
export type EndpointOrigin = "user" | "third-party";

/** `settings.networkPolicy`. */
export type NetworkPolicySettings = {
  /**
   * Permit plain `http` for a user-supplied endpoint. Off by default: on a LAN
   * a plaintext hop carries whatever credentials that endpoint accepts, so it
   * stays the user's explicit call rather than a default (the shape ADR 0300
   * uses for a WebDAV endpoint).
   */
  allowInsecureUserEndpoints?: boolean;
};

export const DEFAULT_NETWORK_POLICY: NetworkPolicySettings = {
  allowInsecureUserEndpoints: false,
};

/** Keep only the fields this policy defines, with their usable values. */
export function normalizeNetworkPolicy(value: unknown): NetworkPolicySettings {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: NetworkPolicySettings = {};
  if (record.allowInsecureUserEndpoints === true) {
    next.allowInsecureUserEndpoints = true;
  }
  return next;
}

export type ValidateNetworkPolicyResult =
  | { ok: true; value: NetworkPolicySettings }
  | { ok: false; error: string };

export function validateNetworkPolicy(value: unknown): ValidateNetworkPolicyResult {
  if (value === undefined || value === null) {
    return { ok: true, value: { ...DEFAULT_NETWORK_POLICY } };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "networkPolicy must be an object" };
  }
  const flag = (value as Record<string, unknown>).allowInsecureUserEndpoints;
  if (flag !== undefined && typeof flag !== "boolean") {
    return { ok: false, error: "allowInsecureUserEndpoints must be a boolean" };
  }
  return { ok: true, value: normalizeNetworkPolicy(value) };
}

/**
 * Read the plaintext opt-in out of a whole settings object.
 *
 * Only the `networkPolicy` section is read. A top-level lookalike key must not
 * be able to turn the opt-in on: the host validates this section on write, and
 * any other spelling of the flag is a field nothing sets.
 */
export function allowInsecureUserEndpoints(settings: unknown): boolean {
  const section =
    settings && typeof settings === "object"
      ? (settings as { networkPolicy?: unknown }).networkPolicy
      : undefined;
  return normalizeNetworkPolicy(section).allowInsecureUserEndpoints === true;
}
