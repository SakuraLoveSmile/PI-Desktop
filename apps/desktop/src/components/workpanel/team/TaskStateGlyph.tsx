import {
  IconCircle, IconCircleArrowRight, IconCircleCheck,
  IconCircleDashed, IconCircleSlash, IconCircleX,
} from "../../icons";
import type { TaskVisualState } from "../../../lib/team-presentation";

export function TaskStateGlyph({ state, size = 16 }: { state: TaskVisualState; size?: 12 | 16 }) {
  const Glyph = {
    in_progress: IconCircleArrowRight,
    pending: IconCircle,
    blocked: IconCircleDashed,
    completed: IconCircleCheck,
    failed: IconCircleX,
    cancelled: IconCircleSlash,
  }[state];
  return (
    <span className="team-task-glyph" data-state={state} aria-hidden="true">
      <Glyph size={size} />
    </span>
  );
}
