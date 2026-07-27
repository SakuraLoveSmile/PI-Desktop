import type { ToolPermissionRequest } from "@pi-desktop/shared";

export const PERMISSION_TIMEOUT_MS = 120_000;

export type PendingPermission = ToolPermissionRequest & {
  receivedAt: number;
};

export function setPendingPermission(
  pending: Record<string, PendingPermission>,
  permission: PendingPermission,
): Record<string, PendingPermission> {
  return { ...pending, [permission.sessionId]: permission };
}

export function clearPendingPermission(
  pending: Record<string, PendingPermission>,
  sessionId: string,
  requestId?: string,
): Record<string, PendingPermission> {
  const current = pending[sessionId];
  if (!current || (requestId !== undefined && current.requestId !== requestId)) {
    return pending;
  }
  const next = { ...pending };
  delete next[sessionId];
  return next;
}

export function permissionSecondsLeft(receivedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((receivedAt + PERMISSION_TIMEOUT_MS - now) / 1000));
}
