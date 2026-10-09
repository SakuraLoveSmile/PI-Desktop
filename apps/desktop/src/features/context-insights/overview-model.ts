import type { ContextInsightsSnapshot, SessionSummary } from "@pi-desktop/shared";

export function contextDay(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Host usage buckets use local calendar days, including DST boundaries. */
export function contextDayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year, month - 1, date);
  if (contextDay(start.getTime()) !== day) return null;
  return { startDate: start.getTime(), endDate: new Date(year, month - 1, date + 1).getTime() - 1 };
}

export function recentContextDays(now: number, length: number) {
  const today = new Date(now);
  return Array.from({ length }, (_, index) =>
    contextDay(
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - (length - 1 - index),
      ).getTime(),
    ),
  );
}

export function filterOverviewSessions(
  sessions: SessionSummary[],
  options: { query: string; project: string; range: string; day: string; now: number },
  snapshots: ContextInsightsSnapshot[],
) {
  const bySession = new Map(snapshots.map((snapshot) => [snapshot.sessionId, snapshot]));
  return sessions.filter((session) => {
    if (options.project && session.projectPath !== options.project) return false;
    const text =
      `${session.title} ${session.projectName ?? ""} ${session.projectPath ?? ""}`.toLocaleLowerCase();
    if (options.query && !text.includes(options.query.toLocaleLowerCase())) return false;
    if (options.range === "all") return true;
    if (options.range === "day") {
      // updatedAt is the newest activity: it cannot establish or exclude
      // activity on an earlier day in a conversation spanning several days.
      return (
        bySession
          .get(session.id)
          ?.requests.some((request) => contextDay(request.startedAt) === options.day) ?? false
      );
    }
    return (
      new Date(session.updatedAt).getTime() >= options.now - Number(options.range) * 86_400_000
    );
  });
}
