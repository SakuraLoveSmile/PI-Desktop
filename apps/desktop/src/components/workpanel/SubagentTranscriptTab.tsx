import { Fragment, useId, useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/app-store";
import { useFollowScroll } from "../../hooks/use-follow-scroll";
import { useTranscriptView } from "../../hooks/use-transcript-view";
import { useTranscriptSearchFocus } from "../../hooks/use-transcript-search-focus";
import { IconArrowDown, IconChevronRight, IconCircleAlert } from "../icons";
import { Button, TooltipButton } from "../ui";
import { DisclosureAnchorContext } from "../../lib/disclosure-anchor-context";
import { DisclosureScope, disclosureKey, TranscriptDisclosureProvider, useAutomaticDisclosure } from "../../features/chat/transcript/disclosure";
import { TranscriptSearchContext } from "../../lib/transcript-search-context";
import type { TranscriptSearchTarget } from "../../lib/transcript-reading";
import type { SubagentRunItem } from "../../lib/assistant-turns";
import { cachedActivitySummary } from "../../lib/transcript-activity-summary";
import { activitySubagents } from "../../features/chat/activity/session-activity-model";
import { subagentAvatarVariant } from "../../features/chat/activity/subagent-row-presentation";
import "./subagent-transcript-detail.css";
import { buildSubagentTranscript } from "../../lib/subagent-transcript";
import {
  AssistantErrorMessage,
  ThinkingRow,
} from "../../features/chat/transcript/shared";
import {
  ReviewChangeCard,
} from "../ReviewChangeCard";
import { ToolRow } from "../../features/chat/transcript/ToolRow";
import { Markdown } from "../Markdown";

/**
 * The work-panel tab showing one delegation as a conversation (issue #917).
 *
 * Every `Task` call of the delegation chain opens a turn: the prompt the
 * parent sent renders as a bounded, expandable prompt, and the delegate's
 * process rows form consecutive disclosures between its progress paragraphs.
 * Output keeps the main transcript's own message-list language —
 * tool rows, thinking rows, and answer bubbles alike. Follow-up `Task` calls
 * on the same delegation append further turns, so a resumed delegate reads as
 * one continuing user/assistant exchange.
 *
 * The tab is display-only: the composer at the foot is a disabled textarea
 * whose placeholder says the delegate is driven by the main agent. There is
 * deliberately no send path.
 */
export function SubagentTranscriptTab({ delegationId }: { delegationId: string }) {
  return (
    <TranscriptDisclosureProvider key={delegationId}>
      <SubagentTranscriptSurface delegationId={delegationId} />
    </TranscriptDisclosureProvider>
  );
}

function SubagentTranscriptSurface({ delegationId }: { delegationId: string }) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  // A tab only renders inside a presented panel, which always has a session;
  // the empty key keeps the hook's contract while nothing is active.
  const transcript = useTranscriptView(activeSessionId ?? "");
  const { messages } = transcript;
  const isRunning = useAppStore(
    (state) => (activeSessionId ? state.runningSessions[activeSessionId] ?? false : false),
  );
  const transcriptResult = useMemo(
    () => buildSubagentTranscript(messages, delegationId),
    [messages, delegationId],
  );
  const agent = useMemo(
    () => activitySubagents(messages, isRunning).find((item) => item.delegationId === delegationId),
    [messages, isRunning, delegationId],
  );
  const {
    scrollRef,
    contentRef,
    showJump,
    handleScroll,
    jumpToLatest,
    scheduleFollowScroll,
    releaseFollow,
    disclosureAnchorNotifier,
  } = useFollowScroll();

  // Several delegation tabs can be open at once, so an explicit search hit
  // is claimed only by the tab whose own conversation contains the message;
  // the other tabs stay where the reader left them.
  const searchTarget = useMemo(() => {
    const focus = transcript.focus;
    if (!focus) return null;
    const claimed = transcriptResult?.turns.some((turn) =>
      turn.rows.some((row) => row.message.id === focus.messageId),
    );
    return claimed ? focus : null;
  }, [transcript.focus, transcriptResult]);

  useTranscriptSearchFocus({
    target: searchTarget,
    source:
      messages.find((message) => message.id === searchTarget?.messageId)?.content ?? "",
    scrollRef,
    contentRef,
    contentVersion: messages,
    onNavigate: releaseFollow,
  });

  useLayoutEffect(() => {
    if (!searchTarget) jumpToLatest();
  }, [jumpToLatest, searchTarget]);

  useLayoutEffect(() => {
    scheduleFollowScroll();
  }, [messages, scheduleFollowScroll]);

  return (
    <DisclosureAnchorContext.Provider value={disclosureAnchorNotifier}>
      <div className="subagent-transcript-tab" data-testid="subagent-transcript-tab">
        <div
          ref={scrollRef}
          data-scroll-owner="follow"
          className="subagent-transcript-scroll"
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-label={t("panel.subagent")}
          tabIndex={0}
        >
          <div ref={contentRef} className="subagent-transcript-list">
            {transcriptResult ? (
              <>
                <header className="subagent-detail-header">
                  <span className="subagent-activity-avatar" data-variant={subagentAvatarVariant(delegationId)} aria-hidden />
                  <div className="subagent-detail-heading">
                    <h2>{transcriptResult.agentName || agent?.agentName || t("panel.subagent")}</h2>
                    {transcriptResult.turns[0]?.task ? <p>{transcriptResult.turns[0].task.split("\n")[0]}</p> : null}
                  </div>
                  {agent ? <span className="subagent-detail-status" data-status={agent.status}>{t(`panel.activity.status.${agent.status}`)}</span> : null}
                </header>
                <TranscriptSearchContext.Provider value={searchTarget}>
                  {transcriptResult.turns.map((turn, turnIndex) => (
                    <section className="subagent-detail-turn" key={`turn-${turnIndex}`}>
                      <SubagentTaskPrompt task={turn.task} identity={`${delegationId}-${turnIndex}`} />
                      <SubagentTurnRows rows={turn.rows} isRunning={isRunning} searchTarget={searchTarget} />
                    </section>
                  ))}
                </TranscriptSearchContext.Provider>
              </>
            ) : (
              <div className="subagent-transcript-empty" role="status">
                {t("panel.subagentEmpty")}
              </div>
            )}
          </div>
        </div>
        {showJump ? (
          <TooltipButton
            type="button"
            className="jump-latest-btn subagent-transcript-jump"
            tooltip={t("chat.scrollToBottom")}
            ariaLabel={t("chat.scrollToBottom")}
            onClick={jumpToLatest}
          >
            <IconArrowDown size={14} />
          </TooltipButton>
        ) : null}
      </div>
    </DisclosureAnchorContext.Provider>
  );
}


function SubagentTaskPrompt({ task, identity }: { task: string; identity: string }) {
  const { t } = useTranslation();
  const detailsId = useId();
  const disclosure = useAutomaticDisclosure(false, undefined, disclosureKey("subagent-task", identity));
  return (
    <div className={`subagent-task-disclosure${disclosure.open ? " open" : ""}`}>
      <div ref={disclosure.bodyRef} id={detailsId} className="subagent-task-preview selectable" {...disclosure.bodyEvents}>
        {task || t("panel.subagentTaskEmpty")}
      </div>
      <Button variant="ghost" type="button" className="subagent-task-toggle" ref={disclosure.titleRef} aria-expanded={disclosure.open} aria-controls={detailsId} onClick={disclosure.toggle}>
        {t("panel.subagentTask")}
        <span>{t(disclosure.open ? "chat.subagentTaskCollapse" : "chat.subagentTaskExpand")}</span>
        <IconChevronRight size={12} aria-hidden />
      </Button>
    </div>
  );
}

/** Group only consecutive process rows; progress prose retains its chronology. */
function SubagentTurnRows({ rows, isRunning, searchTarget }: { rows: SubagentRunItem[]; isRunning: boolean; searchTarget: TranscriptSearchTarget | null }) {
  const segments = useMemo(() => {
    const result: { rows: SubagentRunItem[]; activity: boolean }[] = [];
    for (const row of rows) {
      const activity = row.kind !== "answer";
      const previous = result[result.length - 1];
      if (activity && previous?.activity) previous.rows.push(row);
      else result.push({ rows: [row], activity });
    }
    return result;
  }, [rows]);
  return segments.map((segment) => segment.activity ? (
    <SubagentProcessGroup key={segment.rows[0].message.id} rows={segment.rows.filter((row) => row.kind !== "answer")} isRunning={isRunning} searchTarget={searchTarget} />
  ) : <SubagentAnswer key={segment.rows[0].message.id} row={segment.rows[0]} />);
}

function SubagentProcessGroup({ rows, isRunning, searchTarget }: { rows: Exclude<SubagentRunItem, { kind: "answer" }>[]; isRunning: boolean; searchTarget: TranscriptSearchTarget | null }) {
  const { t } = useTranslation();
  const detailsId = useId();
  const revealRequest = rows.some((row) => row.message.id === searchTarget?.messageId) ? searchTarget?.requestId : undefined;
  const disclosure = useAutomaticDisclosure(false, revealRequest, disclosureKey("subagent-process", rows[0].message.id));
  const summary = useMemo(() => cachedActivitySummary(rows), [rows]);
  const active = isRunning && rows.some((row) => row.message.status === "streaming");
  return (
    <div className={`subagent-process-group${disclosure.open ? " open" : ""}`}>
      <Button variant="ghost" type="button" className="subagent-process-summary" ref={disclosure.titleRef} aria-expanded={disclosure.open} aria-controls={detailsId} onClick={disclosure.toggle}>
        <span className="subagent-process-count" aria-hidden>{summary.tools + summary.thinking}</span>
        <span>{[summary.thinking > 0 ? t("chat.activityThinking", { count: summary.thinking }) : "", summary.tools > 0 ? t("chat.activityTools", { count: summary.tools }) : ""].filter(Boolean).join(" · ")}</span>
        {active ? <span className="subagent-process-active">{t("chat.running")}</span> : null}
        {summary.issues > 0 ? <span className="turn-process-error"><IconCircleAlert size={14} aria-hidden />{t("chat.activityFailures", { count: summary.issues })}</span> : null}
        <IconChevronRight size={12} aria-hidden />
      </Button>
      <div id={detailsId} ref={disclosure.bodyRef} hidden={!disclosure.open} inert={!disclosure.open} className="subagent-process-body" {...disclosure.bodyEvents}>
        <DisclosureScope disclosure={disclosure}>
          {rows.map((row) => row.kind === "tool" ? (
            <Fragment key={row.message.id}>
              <ToolRow message={row.message} />
              <ReviewChangeCard message={row.message} readOnly />
            </Fragment>
          ) : <ThinkingRow key={row.message.id} message={row.message} streaming={isRunning && row.message.status === "streaming"} />)}
        </DisclosureScope>
      </div>
    </div>
  );
}

function SubagentAnswer({ row }: { row: SubagentRunItem }) {
  return (
    <div className="message-row assistant" data-message-id={row.message.id}>
      <div className="message-col">
        <div className="message-bubble">
          {row.message.content ? <div className="prose-chat selectable"><Markdown source={row.message.content} /></div> : null}
          {row.message.error ? <AssistantErrorMessage message={row.message} readOnly /> : null}
        </div>
      </div>
    </div>
  );
}
