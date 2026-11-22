import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui";
import { ActivityRowStatus } from "./ActivityRowStatus";
import type { ActivityReference, McpReconnectTarget } from "./activity-mcp-rows";

type McpDetail = NonNullable<ActivityReference["mcp"]>;

/** How an MCP row's server reads: a sign-in it asks for outranks its connection state. */
export function mcpStatusMark(mcp: McpDetail): { status: string; labelKey: string } {
  if (mcp.authRequired) return { status: "degraded", labelKey: "panel.activity.mcp.authNeeded" };
  switch (mcp.state) {
    case "connecting": return { status: "running", labelKey: "extensions.mcp.state.connecting" };
    case "failed": return { status: "failed", labelKey: "extensions.mcp.state.failed" };
    case "ready": return { status: "ready", labelKey: "extensions.mcp.state.ready" };
    default: return { status: "idle", labelKey: "panel.activity.mcp.idle" };
  }
}

/**
 * The trailing status of an MCP row: a spinner while the server connects, a word otherwise. A failed server that a
 * retry could help says "Reconnect" in the warning colour in the word's place, when the pane can act on it; the
 * failure itself stays in the button's name and in the row's tooltip.
 */
export function ActivityMcpStatus({ mcp, name, onReconnect }: { mcp: McpDetail; name?: string; onReconnect?: (target: McpReconnectTarget) => void }) {
  const { t } = useTranslation();
  const mark = mcpStatusMark(mcp);
  const target = mcp.reconnect;
  if (target && onReconnect) {
    return <Button variant="ghost" className="session-activity-row-action"
      aria-label={t("panel.activity.mcp.reconnectNamed", { name: name ?? target.label })} onClick={() => onReconnect(target)}>
      {t("panel.activity.mcp.reconnect")}
    </Button>;
  }
  return <ActivityRowStatus status={mark.status} label={t(mark.labelKey)} />;
}

/** The row's tooltip: the server, how it reads now, and the server's own message when it sent one. */
export function mcpReferenceTitle(label: string, mcp: McpDetail | undefined, translate: (key: string) => string): string {
  if (!mcp) return label;
  return [label, translate(mcpStatusMark(mcp).labelKey), mcp.message?.trim()].filter(Boolean).join(" · ");
}
