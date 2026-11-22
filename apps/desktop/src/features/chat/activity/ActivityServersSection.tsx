import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconServer } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { ActivityRailGroup } from "./ActivityRailGroup";
import { ActivityRowStatus } from "./ActivityRowStatus";
import type { ActivityServer } from "./activity-server-rows";
import "./session-activity-servers.css";

/** The canvas's stop glyph: a 10px square with 2px corners, in the text colour. */
const StopSquare = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false"><rect width="10" height="10" rx="2" fill="currentColor" /></svg>;

/**
 * Servers the session started in the background: the name, the address it serves in muted text and a stop. The name
 * opens the process details (its output); the address opens the page in the work panel's browser. Without a handler a
 * control is left out, so a read-only rail shows the same facts and nothing to press.
 */
export function ActivityServersSection({ sessionId, servers, stopping, onOpenDetails, onOpenAddress, onStop, details }: {
  sessionId: string; servers: readonly ActivityServer[]; stopping: ReadonlySet<string>;
  onOpenDetails: (id: string) => void; onOpenAddress?: (url: string) => void; onStop?: (id: string) => void;
  /** The open process details of one of these servers, shown under the rows. */
  details?: ReactNode;
}) {
  const { t } = useTranslation();
  return <ActivityRailGroup sessionId={sessionId} group="server" sectionHeading label={t("panel.activity.servers")}
    items={servers.map((server) => ({ id: server.id, status: server.status }))}>
    <>{servers.map((server) => {
      const stopLabel = t("panel.activity.server.stop", { name: server.name });
      const openLabel = t("panel.activity.server.open", { address: server.display });
      return <div key={server.id} className="session-activity-row-shell">
        <div className="session-activity-row session-activity-server" data-server-id={server.id}>
          <span className="session-activity-icon" aria-hidden><IconServer size={16} /></span>
          <TooltipButton type="button" className="session-activity-server-name" tooltip={`${server.command}\n${server.cwd}`}
            ariaLabel={`${t("panel.activity.openProcess")} · ${server.name}`} onClick={() => onOpenDetails(server.id)}>{server.name}</TooltipButton>
          {onOpenAddress
            ? <TooltipButton type="button" className="session-activity-server-address" tooltip={openLabel} ariaLabel={openLabel}
              onClick={() => onOpenAddress(server.url)}>{server.display}</TooltipButton>
            : <span className="session-activity-server-address" data-static="true">{server.display}</span>}
          {server.status === "stopping" || stopping.has(server.id)
            ? <span className="session-activity-server-end"><ActivityRowStatus status="stopping" label={t("panel.activity.status.stopping")} /></span>
            : onStop && <TooltipButton type="button" className="session-activity-server-stop" tooltip={stopLabel} ariaLabel={stopLabel}
              onClick={() => onStop(server.id)}><StopSquare /></TooltipButton>}
        </div>
      </div>;
    })}{details}</>
  </ActivityRailGroup>;
}
