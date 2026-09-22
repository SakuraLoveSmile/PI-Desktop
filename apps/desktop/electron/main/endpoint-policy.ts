/**
 * The user's plaintext opt-in for endpoints they enter themselves, as the main
 * process currently holds it.
 *
 * The judgement of what an address *is* lives in `@pi-desktop/shared`
 * (`public-network.ts`); whether the user accepted a plaintext hop to their own
 * LAN service lives in the stored app settings (`networkPolicy`). The public
 * network client runs synchronously per request, so the settings value is
 * mirrored here whenever the host hands the app its settings, exactly as
 * `network-proxy.ts` mirrors the proxy.
 */
import { allowInsecureUserEndpoints } from "@pi-desktop/shared";

let applied = false;

/** Mirror the stored `networkPolicy` section; returns the effective flag. */
export function applyUserEndpointPolicyFromAppSettings(settings: unknown): boolean {
  applied = allowInsecureUserEndpoints(settings);
  return applied;
}

/** Whether plain `http` is currently allowed for a user-supplied endpoint. */
export function allowInsecureUserEndpointsEnabled(): boolean {
  return applied;
}
