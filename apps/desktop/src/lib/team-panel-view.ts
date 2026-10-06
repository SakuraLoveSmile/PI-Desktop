export type TeamDetailView =
  | { kind: "aggregate" }
  | { kind: "board" }
  | { kind: "member"; memberSessionId: string }
  | { kind: "task"; taskId: string }
  | { kind: "panorama" };

export function requestedView(input: {
  taskId?: string;
  memberSessionId?: string;
  view?: "aggregate" | "board" | "task" | "panorama";
}): TeamDetailView {
  if (input.taskId) return { kind: "task", taskId: input.taskId };
  if (input.memberSessionId) return { kind: "member", memberSessionId: input.memberSessionId };
  if (input.view === "task") return { kind: "aggregate" };
  return { kind: input.view ?? "aggregate" };
}
