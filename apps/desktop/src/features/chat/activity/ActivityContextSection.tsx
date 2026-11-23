import { useTranslation } from "react-i18next";
import { formatCompactTokenCount, type ContextUsageDisplay } from "@pi-desktop/shared";
import { IconChevronRight } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { resolveContextUsageDisplay } from "../../../lib/context-usage";
import type { LatestTurnContextInspector } from "../../../lib/latest-turn-context";
import { useAppStore } from "../../../stores/app-store";
import { useLatestComposition } from "../../context-insights/use-latest-composition";
import { ActivityRailGroup } from "./ActivityRailGroup";
import { activityContextLabelKey, activityContextView, type ActivityContextView } from "./activity-context-view";
import { formatActivityTokens } from "./activity-token-format";
import "./session-activity-workspace.css";

const BUCKET_LABEL = { system: "chat.usageBucketSystem", tools: "chat.usageBucketTools", messages: "chat.usageBucketMessages" } as const;
const share = (percent: number) => `${(Math.round(percent * 10) / 10).toFixed(1)}%`;

/**
 * The newest request's context use, read-only: the same figures the composer's inspector shows, derived the same way,
 * with a link to the dashboard the inspector opens. The composer's entry stays the one place the usage is managed.
 */
export function ActivityContextSection({ sessionId, visible, inspector, onOpenDetails }: {
  sessionId: string; visible: boolean; inspector: LatestTurnContextInspector; onOpenDetails?: () => void;
}) {
  const { t } = useTranslation();
  const display = useAppStore((state) => resolveContextUsageDisplay(state.settings?.contextUsageDisplay));
  const view = activityContextView(inspector.usage, inspector.contextWindow, display);
  const dashboard = t("contextInsights.openDashboard");
  return <ActivityRailGroup sessionId={sessionId} group="context" sectionHeading trackAttention={false} label={t("panel.activity.context")}
    collapsedSummary={<span data-tone={view.level === "comfortable" ? undefined : view.level}>{t(activityContextLabelKey(display))} {view.percent}%</span>}
    action={onOpenDetails && <TooltipButton type="button" className="btn btn-ghost session-activity-heading-link" tooltip={dashboard}
      ariaLabel={dashboard} onClick={onOpenDetails}>{t("panel.activity.details")}<IconChevronRight size={14} aria-hidden /></TooltipButton>}>
    <ActivityContextBody sessionId={sessionId} visible={visible} inspector={inspector} display={display} />
  </ActivityRailGroup>;
}

/** Mounted only while the section is open, so the Host subscription for the breakdown lives exactly that long. */
function ActivityContextBody({ sessionId, visible, inspector, display }: {
  sessionId: string; visible: boolean; inspector: LatestTurnContextInspector; display: ContextUsageDisplay;
}) {
  const request = useLatestComposition(sessionId, visible);
  return <ActivityContextMeter view={activityContextView(inspector.usage, inspector.contextWindow, display, request)} />;
}

/** The headline, the bar and its legend for one derived view. Until the request's breakdown is known the bar is one segment. */
export function ActivityContextMeter({ view }: { view: ActivityContextView }) {
  const { t, i18n } = useTranslation();
  const display = view.display;
  const tone = view.level === "comfortable" ? undefined : view.level;
  // Chinese locales count in 万 here, as the approved canvas does; the composer and every other locale keep K and M.
  const tokens = (count: number) => formatActivityTokens(count, i18n.language);
  return <div className="session-activity-context">
    <div className="session-activity-context-head">
      <span data-tone={tone}>{t(activityContextLabelKey(display))} {view.percent}%</span>
      <span className="session-activity-context-tokens">~{tokens(view.usedTokens)} / {tokens(view.windowTokens)}</span>
    </div>
    <div className="session-activity-context-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.usedPercent}
      aria-label={t("chat.usageContextAria", { percent: view.usedPercent, count: formatCompactTokenCount(view.usedTokens), state: t("chat.usageContextAriaUsed") })}>
      {view.buckets ? view.buckets.filter((entry) => entry.tokens > 0).map((entry) => <i key={entry.bucket} data-bucket={entry.bucket} style={{ width: `${entry.percent}%` }} />)
        : <i data-bucket="used" style={{ width: `${view.usedPercent}%` }} />}
    </div>
    {view.buckets && <ul className="session-activity-context-legend">
      {view.buckets.map((entry) => <li key={entry.bucket}>
        <i className="session-activity-context-swatch" data-bucket={entry.bucket} aria-hidden />
        <span className="session-activity-label">{t(BUCKET_LABEL[entry.bucket])}</span>
        <span className="session-activity-context-value">~{tokens(entry.tokens)}</span>
        <span className="session-activity-context-share">{share(entry.percent)}</span>
      </li>)}
      <li>
        <i className="session-activity-context-swatch" data-bucket="free" aria-hidden />
        <span className="session-activity-label session-activity-dim">{t("panel.activity.contextFree")}</span>
        <span className="session-activity-context-value">{tokens(view.free.tokens)}</span>
        <span className="session-activity-context-share">{share(view.free.percent)}</span>
      </li>
    </ul>}
  </div>;
}
