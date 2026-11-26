const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD HH:mm` in the viewer's local time, the way the approved canvas dates the note; empty for an unreadable stamp. */
export function summaryTimestamp(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
