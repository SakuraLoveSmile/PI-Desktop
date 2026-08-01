import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getToolDisplayName,
  formatToolDuration,
} from "../lib/tool-display";
import type {
  AgentProgressPhase,
  AgentProgressState,
} from "../stores/app-store";
import { IconCheck, IconCircleAlert, IconSparkles } from "./icons";

const PHASES: readonly AgentProgressPhase[] = [
  "understanding",
  "working",
  "checking",
  "finalizing",
];

const PHASE_LABEL_KEYS: Record<AgentProgressPhase, string> = {
  understanding: "chat.progressUnderstanding",
  working: "chat.progressWorking",
  checking: "chat.progressChecking",
  finalizing: "chat.progressFinalizing",
};

type AgentProgressTimelineProps = {
  progress?: AgentProgressState;
  waitingForPermission: boolean;
};

export function AgentProgressTimeline({
  progress,
  waitingForPermission,
}: AgentProgressTimelineProps) {
  const { t } = useTranslation();
  const fallbackStartedAtRef = useRef(Date.now());
  const [now, setNow] = useState(Date.now);
  const phase = progress?.phase ?? "understanding";
  const activeIndex = PHASES.indexOf(phase);
  const startedAt = progress?.startedAt ?? fallbackStartedAtRef.current;
  const elapsed = formatToolDuration(Math.floor((now - startedAt) / 1000));

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress?.startedAt]);

  const detail = waitingForPermission
    ? t("chat.progressWaiting")
    : progress?.toolName
      ? t("chat.progressWorkingWith", {
          tool: getToolDisplayName(progress.toolName),
        })
      : t(PHASE_LABEL_KEYS[phase]);

  return (
    <section
      className="agent-progress"
      data-testid="agent-progress"
      role="status"
      aria-live="polite"
      aria-label={detail}
    >
      <div className="agent-progress-header">
        <span className="agent-progress-icon" aria-hidden>
          {waitingForPermission ? (
            <IconCircleAlert size={15} />
          ) : (
            <IconSparkles size={15} />
          )}
        </span>
        <span className="agent-progress-detail">{detail}</span>
        <span className="agent-progress-elapsed">{elapsed}</span>
      </div>
      <ol className="agent-progress-steps">
        {PHASES.map((candidate, index) => {
          const complete = index < activeIndex && !waitingForPermission;
          const active = index === activeIndex;
          return (
            <li
              key={candidate}
              className={`agent-progress-step${complete ? " complete" : ""}${
                active ? " active" : ""
              }`}
            >
              <span className="agent-progress-marker" aria-hidden>
                {complete ? <IconCheck size={11} /> : null}
              </span>
              <span>{t(PHASE_LABEL_KEYS[candidate])}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
