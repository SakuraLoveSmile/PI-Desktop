import { memo, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { PlanProposal, PlanningState, UiMessage } from "@pi-desktop/shared";
import { proposalKindForMode } from "@pi-desktop/shared";
import { ConversationMinimap } from "../../../components/ConversationMinimap";
import { PermissionCard } from "../../../components/PermissionCard";
import { Button, TooltipButton } from "../../../components/ui";
import { TurnOutcomeCard } from "../../../components/TurnOutcomeCard";
import { GoalReportCard } from "../../../components/GoalReportCard";
import { PlanApprovalBar } from "../../../components/PlanApprovalBar";
import { goalReportWorkPanelTab, teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { shouldPresentGoalReportInTranscript } from "../../../lib/goal-report-presentation";
import { IconArrowDown, IconChevronRight } from "../../../components/icons";
import { usePendingTeamExecutionReview } from "../../../hooks/useTeamExecutionReview";
import { useAppStore } from "../../../stores/app-store";
import type { PendingPermission } from "../../../lib/pending-permissions";
import { TRANSCRIPT_SKELETON_ROWS } from "../../../lib/transcript-settle";
import {
  PlanningIndicator,
  RunActivityIndicator,
  WorkingIndicator,
} from "./ActivityGroup";
import { TranscriptHistory, TranscriptTail } from "./AssistantTurn";
import { useTranscriptScroll } from "./hooks/useTranscriptScroll";
import type { TranscriptSearchTarget } from "../../../lib/transcript-reading";
import { TranscriptSearchContext } from "../../../lib/transcript-search-context";
import { DisclosureAnchorContext } from "../../../lib/disclosure-anchor-context";
import { api } from "../../../lib/api";
import { mergeLiveSessionMessages } from "../../../lib/session-transcript";
import { conversationPlainText } from "../../../lib/chat-transcript-text";
import {
  TranscriptMenuProvider,
  useChatTextActions,
  useTranscriptMenu,
} from "./TranscriptMenu";
import { conversationMenuItems } from "./menu-items";
import { ThinkingDisplayControl } from "./ThinkingDisplayControl";
import { buildPlanTranscriptIndex } from "../../../lib/plan-transcript";
import { PlanTranscriptContext } from "../../../lib/plan-transcript-context";
import { buildTeamDispatchIndex, TeamDispatchContext } from "../../../lib/team-dispatch";
import { SlotSessionProvider } from "../../../plugins/renderer-slots/use-slots";

const EMPTY_PLAN_PROPOSALS: PlanProposal[] = [];

type ChatTranscriptProps = {
  sessionId: string | undefined;
  messages: UiMessage[];
  hasMoreBefore?: boolean;
  onLoadOlder?: () => Promise<void>;
  isRunning: boolean;
  pendingPermission?: PendingPermission;
  /** Requests waiting behind this one, from other delegates (ADR 0062). */
  queuedPermissions?: number;
  askPending?: boolean;
  planningState?: PlanningState;
  /**
   * Whether this instance's retained pane is the one on screen (ADR 0137). A
   * hidden pane keeps its DOM and scroll offset but must not chase the stream
   * or re-anchor, because its scroller has no visible viewport to correct.
   */
  paneVisible?: boolean;
  searchTarget?: TranscriptSearchTarget | null;
  readingWindow?: boolean;
  hasMoreAfter?: boolean;
  onLoadNewer?: () => Promise<void>;
  onReturnToLatest?: () => void;
  navigationLoading?: boolean;
};

/**
 * The transcript facade only mounts the right-click menu provider: the
 * scroller's own background menu has to consume that context, and a component
 * cannot read a provider it renders itself.
 */
export const ChatTranscript = memo(function ChatTranscript(
  props: ChatTranscriptProps,
) {
  return (
    <TranscriptMenuProvider>
      <TranscriptBody {...props} />
    </TranscriptMenuProvider>
  );
});

function TranscriptBody({
  sessionId,
  messages,
  hasMoreBefore = false,
  onLoadOlder,
  isRunning,
  pendingPermission,
  queuedPermissions = 0,
  askPending = false,
  planningState,
  paneVisible = true,
  searchTarget = null,
  readingWindow = false,
  hasMoreAfter = false,
  onLoadNewer,
  onReturnToLatest,
  navigationLoading = false,
}: ChatTranscriptProps) {
  const { t } = useTranslation();
  const openTranscriptMenu = useTranscriptMenu();
  const { copyText, selectText } = useChatTextActions();
  const showToast = useAppStore((state) => state.showToast);
  const settings = useAppStore((state) => state.settings);
  const transcriptRunning = isRunning && !readingWindow;
  const pendingTeamReview = usePendingTeamExecutionReview(sessionId, !readingWindow);
  const latestTurnResult = useAppStore((state) =>
    sessionId ? state.latestTurnResults[sessionId] : undefined,
  );
  const goalReports = useAppStore((state) =>
    sessionId ? state.goalReports[sessionId] : undefined,
  );
  const openWorkPanelTabForSession = useAppStore(
    (state) => state.openWorkPanelTabForSession,
  );
  const approvalPending = useAppStore((state) =>
    Boolean(
      sessionId && state.pendingPlans[sessionId]?.status === "pending",
    ),
  );
  const sessionProposals = useAppStore((state) =>
    sessionId ? state.planHistory[sessionId] ?? EMPTY_PLAN_PROPOSALS : EMPTY_PLAN_PROPOSALS,
  );
  const currentProposal = useAppStore((state) =>
    sessionId ? state.pendingPlans[sessionId] : undefined,
  );
  // Plan and Goal both project `planning`; the durable mode names which
  // contract is being written, so the indicator can use that kind's copy.
  const planningKind = useAppStore(
    (state) =>
      proposalKindForMode(
        state.sessions.find((session) => session.id === sessionId)?.mode ??
          "agent",
      ) ?? "plan",
  );
  const agentActivity = useAppStore((state) =>
    sessionId ? state.agentStatuses[sessionId]?.activity : undefined,
  );
  const compactions = useAppStore((state) =>
    sessionId ? state.sessionCompactions[sessionId] : undefined,
  );
  const teamDispatchIndex = useMemo(
    () => buildTeamDispatchIndex(messages, sessionId),
    [messages, sessionId],
  );

  const {
    scrollRef,
    wrapRef,
    contentRef,
    historyBoundaryRef,
    loadingOlder,
    showJump,
    historyEntries,
    tailEntry,
    transcriptEntries,
    minimapMessages,
    hasEarlierHistory,
    hydrationBounded,
    veilCovering,
    veilPhase,
    handleScroll,
    revealEarlierHistory,
    releaseFollow,
    jumpToLatest,
    disclosureAnchorNotifier,
  } = useTranscriptScroll({
    sessionId,
    messages,
    compactions,
    hasMoreBefore,
    onLoadOlder,
    isRunning: transcriptRunning,
    pendingPermission,
    askPending,
    approvalPending,
    planningState,
    paneVisible,
    searchTarget,
    readingWindow,
  });

  const previousPlanIndex = useRef<ReturnType<typeof buildPlanTranscriptIndex>>(undefined);
  const planTranscriptIndex = useMemo(() => buildPlanTranscriptIndex(
    transcriptEntries,
    currentProposal ? [...sessionProposals, currentProposal] : sessionProposals,
    sessionId,
    previousPlanIndex.current,
  ), [transcriptEntries, sessionProposals, currentProposal, sessionId]);
  previousPlanIndex.current = planTranscriptIndex;

  const specializedActivity = agentActivity;
  const hasSpecializedActivity = specializedActivity !== undefined;
  // Existing output does not mean the turn has finished: a text stream can
  // pause, and completed tool rows can outlive their activity. Keep one tail
  // status until the turn ends or a user interaction owns the pending state.
  const showStatus =
    transcriptRunning &&
    !pendingPermission &&
    !askPending &&
    !approvalPending;
  const showTeamReview = Boolean(pendingTeamReview) && !pendingPermission && !askPending && !approvalPending;
  const showRunActivity = showStatus && !pendingTeamReview && hasSpecializedActivity;
  const showWorking =
    showStatus &&
    !pendingTeamReview &&
    planningState !== "planning" &&
    !hasSpecializedActivity;
  const showPlanning =
    showStatus &&
    !pendingTeamReview &&
    planningState === "planning" &&
    !hasSpecializedActivity;

  // The tail status lane is part of the layout for the whole running turn: the
  // indicators below mount and clear with the turn's phase, and a lane that
  // came and went with them would resize `.thread-content` and push the rows
  // the user is already reading (issue #323). A pending Team review keeps its
  // entry reachable even after an ordinary Agent's explanatory turn ends.
  // A finished transcript without a pending review renders no lane.
  const runtimeStatusLane = transcriptRunning || showTeamReview;

  /*
    The background menu answers the right-clicks no row claimed: the space below
    the last turn, a system row, a permission or outcome card. It reads the
    conversation rather than one message, so it is the only surface that can
    copy the whole thread.
  */
  const copyConversation = async () => {
    if (!sessionId) return;
    try {
      // Explicit copy reads the full session without changing the reading window.
      const { session } = await api.getSession(sessionId);
      if (!session) throw new Error("Session unavailable");
      await copyText(conversationPlainText(
        mergeLiveSessionMessages(session.messages ?? [], messages),
        { user: t("chat.speakerYou"), assistant: t("chat.speakerAssistant") },
      ));
    } catch {
      showToast(t("chat.copyFailed"), { variant: "error" });
    }
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    openTranscriptMenu(event, {
      label: t("chat.conversationMenu"),
      items: conversationMenuItems({
        t,
        canCopy: Boolean(sessionId) && (hasMoreBefore || hasMoreAfter || messages.some(
          (message) => (message.role === "user" || message.role === "assistant") && message.content.trim(),
        )),
        onCopyConversation: () => void copyConversation(),
        scrollRef,
        contentRef,
        actions: { copyText, selectText },
        onReturnToLatest: () => {
          onReturnToLatest?.();
          jumpToLatest();
        },
      }),
    });
  };

  return (
    <TranscriptSearchContext.Provider value={searchTarget}>
    <DisclosureAnchorContext.Provider value={disclosureAnchorNotifier}>
    <TeamDispatchContext.Provider value={teamDispatchIndex}>
    <PlanTranscriptContext.Provider value={planTranscriptIndex}>
    <SlotSessionProvider sessionId={sessionId ?? ""}>
    <div
      className="thread-wrap"
      ref={wrapRef}
      data-transcript-settling={veilCovering ? "true" : undefined}
    >
      {settings ? (
        <div className="transcript-display-toolbar">
          <ThinkingDisplayControl
            mode={settings.thinkingDisplayMode}
            onChange={async (thinkingDisplayMode) => {
              const next = { ...settings, thinkingDisplayMode };
              try {
                await api.setSettings(next);
                useAppStore.setState({ settings: next });
              } catch (error) {
                showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
              }
            }}
          />
        </div>
      ) : null}
      {/* The minimap measures row positions against a rendered scroller. A
        * hidden pane has none, so measuring there would cache junk offsets and
        * reuse them on reveal. It is out of flow and re-measures on mount, so
        * leaving it out while hidden costs nothing. It also waits for the
        * settle veil to lift: mounting it against still-moving rows would cache
        * offsets the settled layout no longer matches. */}
      {paneVisible && !veilCovering ? (
        <ConversationMinimap
          scrollRef={scrollRef}
          messages={minimapMessages}
          hasEarlier={hasEarlierHistory}
          loadingEarlier={loadingOlder}
          onRevealEarlier={revealEarlierHistory}
          onReleaseFollow={releaseFollow}
        />
      ) : null}
      <div
        className="thread-scroll"
        ref={scrollRef}
        data-scroll-owner="transcript"
        onContextMenu={onContextMenu}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
      >
        <div className="thread-content" ref={contentRef}>
          <div
            ref={historyBoundaryRef}
            className="transcript-history-loading"
            role="status"
            aria-live="polite"
            aria-hidden={!loadingOlder}
          >
            {loadingOlder ? t("chat.loadingEarlierMessages") : null}
          </div>
          {hydrationBounded ? (
            // One viewport of slack, not a per-entry estimate. The spacer exists
            // so the bounded commit can still scroll to its bottom; sizing it
            // from a guessed row height made the expansion correct that guess in
            // view, which is exactly the jitter this avoids.
            <div className="transcript-hydration-spacer" aria-hidden />
          ) : null}
          {!readingWindow ? planTranscriptIndex.beforeEntries.map((proposal) => (
            <PlanApprovalBar key={proposal.id} proposal={proposal} />
          )) : null}
          <TranscriptHistory entries={historyEntries} isRunning={isRunning} />
          {tailEntry ? (
            <TranscriptTail
              entry={tailEntry}
              isRunning={isRunning}
              isActive={transcriptRunning && tailEntry.kind === "assistant-turn"}
              runtimeActivity={specializedActivity}
            />
          ) : null}
          {hasMoreAfter ? (
            <button
              type="button"
              className="transcript-load-later"
              disabled={navigationLoading}
              onClick={() => void onLoadNewer?.()}
            >
              {t("chat.loadLaterMessages")}
            </button>
          ) : null}
          {!readingWindow ? (
            <>
              {goalReports?.filter(shouldPresentGoalReportInTranscript).map((report) => (
                <GoalReportCard
                  key={report.reportId}
                  report={report}
                  onOpenReport={() => {
                    openWorkPanelTabForSession(
                      report.sessionId,
                      goalReportWorkPanelTab(report.executionId, report.goalTitle),
                    );
                  }}
                />
              ))}
              <TurnOutcomeCard
                messages={messages}
                result={latestTurnResult}
              />
            </>
          ) : null}
          {pendingPermission ? (
            <PermissionCard
              key={pendingPermission.requestId}
              permission={pendingPermission}
              queued={queuedPermissions}
            />
          ) : null}
          {runtimeStatusLane ? (
            <div className="transcript-runtime-status">
              {showTeamReview && pendingTeamReview ? (
                <div className="working-indicator" role="status" aria-live="polite" data-testid="team-review-waiting-indicator">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("chat.teamToolActions.strategy")}
                    onClick={() => {
                      if (sessionId) openWorkPanelTabForSession(sessionId, teamWorkPanelTab(pendingTeamReview.teamSessionId));
                    }}
                  >
                    {t("team.review.status.pending")}
                    <IconChevronRight size={12} aria-hidden />
                  </Button>
                </div>
              ) : null}
              {showRunActivity && specializedActivity ? (
                <RunActivityIndicator activity={specializedActivity} />
              ) : null}
              {showPlanning ? <PlanningIndicator kind={planningKind} /> : null}
              {showWorking ? <WorkingIndicator /> : null}
            </div>
          ) : null}
        </div>
      </div>
      {veilPhase !== "off" ? (
        // Positioned without a z-index on purpose: it paints above the scroller
        // in tree order and stays beneath the docked composer, so the user can
        // keep typing while the transcript settles.
        <div
          className="transcript-settle-veil"
          data-phase={veilPhase}
          role="status"
          aria-busy={veilCovering}
          aria-label={t("chat.loadingSession")}
        >
          <div className="transcript-settle-veil-band">
            {TRANSCRIPT_SKELETON_ROWS.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={`transcript-skeleton-row ${row.role}`}
                aria-hidden
              >
                {row.lines.map((width, lineIndex) => (
                  <span
                    key={lineIndex}
                    className="transcript-skeleton-line"
                    style={{ width }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {navigationLoading ? (
        <div className="transcript-navigation-loading" role="status">{t("chat.loadingSession")}</div>
      ) : null}
      {(showJump || readingWindow) && !veilCovering ? (
        <TooltipButton
          className="jump-latest-btn"
          ariaLabel={t("chat.scrollToBottom")}
          tooltip={t("chat.scrollToBottom")}
          onClick={() => {
            onReturnToLatest?.();
            jumpToLatest();
          }}
        >
          <IconArrowDown size={14} />
        </TooltipButton>
      ) : null}
    </div>
    </SlotSessionProvider>
    </PlanTranscriptContext.Provider>
    </TeamDispatchContext.Provider>
    </DisclosureAnchorContext.Provider>
    </TranscriptSearchContext.Provider>
  );
}
