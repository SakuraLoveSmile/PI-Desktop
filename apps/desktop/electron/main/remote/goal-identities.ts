/** Remap nested Goal identities without changing the remote transport response. */
export function remapGoalSession<T>(value: T, sessionId: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const mapped: Record<string, unknown> = { ...record, ...(typeof record.sessionId === "string" ? { sessionId } : {}) };
  for (const key of ["hold", "progress", "execution", "report"]) {
    if (record[key] !== undefined) mapped[key] = remapGoalSession(record[key], sessionId);
  }
  return mapped as T;
}
