import { useTranslation } from "react-i18next";
import type { GoalReport } from "@pi-desktop/shared";
import { Badge } from "../../ui";
import { IconTriangleAlert } from "../../icons";
import { EvidenceRefs, ReportSection } from "./report-primitives";

export function GoalReportVerification({ report }: { report: GoalReport }) {
  const { t } = useTranslation();
  if (!report.checks?.length && !report.evidences?.length && !report.criteria?.length) return null;
  const observations = new Map((report.checkObservations ?? []).map((observation) => [observation.checkId, observation]));
  const resolutions = new Map((report.evidenceResolution ?? []).map((resolution) => [resolution.evidenceId, resolution]));
  return <ReportSection title={t("goalReport.view.checks")} testId="goal-report-evidence">
    {report.checks?.length > 0 && <div className="goal-report-table-wrap" tabIndex={0} role="region" aria-label={t("goalReport.view.checks")}>
      <table className="goal-report-table goal-report-checks-table">
        <thead><tr>
          <th scope="col">{t("goalReport.view.checkLabel")}</th>
          <th scope="col">{t("goalReport.view.checkCommand")}</th>
          <th scope="col">{t("goalReport.view.checkModelResult")}</th>
          <th scope="col">{t("goalReport.view.checkHostResult")}</th>
          <th scope="col">{t("goalReport.view.checkDetail")}</th>
        </tr></thead>
        <tbody>{report.checks.map((check, index) => {
          const observation = observations.get(check.id);
          const contradiction = observation && check.result !== "inconclusive" &&
            observation.result !== "inconclusive" && check.result !== observation.result;
          return <tr key={check.id || index} className={`goal-report-check-row ${contradiction ? "is-contradiction" : ""}`}>
            <th scope="row">{check.label || check.command}</th>
            <td><code className="goal-report-check-command">{check.command}</code><EvidenceRefs refs={check.evidenceRefs} /></td>
            <td>
              <Badge className={`goal-report-check-badge result-${check.result}`}>{t(`goalReport.view.checkResult.${check.result}`)}</Badge>
              {check.disposition && <p className="goal-report-cell-note">{t(`goalReport.view.checkDisposition.${check.disposition}`)}</p>}
              {check.exitCode != null && <p className="goal-report-cell-note">{t("goalReport.view.exitCode", { code: check.exitCode })}</p>}
            </td>
            <td>{observation ? <>
              <Badge className={`goal-report-check-badge host-obs result-${observation.result}`}>
                {t(`goalReport.view.checkResult.${observation.result}`)}
              </Badge>
              {observation.command && observation.command !== check.command && <p className="goal-report-cell-note"><code>{observation.command}</code></p>}
              {observation.exitCode != null && <p className="goal-report-cell-note">{t("goalReport.view.exitCode", { code: observation.exitCode })}</p>}
              <EvidenceRefs refs={observation.evidenceIds} />
            </> : <span className="goal-report-cell-note">{t("goalReport.view.hostNotObserved")}</span>}</td>
            <td>
              {check.detail && <p className="goal-report-check-detail"><span>{t("goalReport.view.modelClaim")}: </span>{check.detail}</p>}
              {observation?.detail && <p className="goal-report-check-obs-detail"><span>{t("goalReport.view.hostObservation")}: </span>{observation.detail}</p>}
              {contradiction && <Badge className="goal-report-contradiction-badge" tone="error">
                <IconTriangleAlert size={12} />{t("goalReport.view.contradiction")}
              </Badge>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    {report.criteria?.length > 0 && <div className="goal-report-sub-block" data-testid="goal-report-criteria">
      <h3 className="goal-report-subtitle-heading">{t("goalReport.view.criteria")}</h3>
      <ul className="goal-report-criteria-list">{report.criteria.map((criterion, index) =>
        <li key={criterion.id || index} className={`goal-report-criterion-row verdict-${criterion.verdict}`}>
          <div className="goal-report-criterion-head">
            <Badge className={`goal-report-criterion-verdict verdict-${criterion.verdict}`}>
              {t(`goalReport.view.criterionVerdict.${criterion.verdict}`)}
            </Badge>
            <span className="goal-report-criterion-text">{criterion.text}</span>
          </div>
          {criterion.contractRef && <code>{criterion.contractRef}</code>}
          {criterion.explanation && <p className="goal-report-criterion-explanation">{criterion.explanation}</p>}
          <EvidenceRefs refs={criterion.evidenceRefs} />
        </li>)}</ul>
    </div>}

    {report.evidences?.length > 0 && <div className="goal-report-sub-block">
      <h3 className="goal-report-subtitle-heading">{t("goalReport.view.evidences")}</h3>
      <div className="goal-report-evidences-list">{report.evidences.map((evidence, index) => {
        const resolution = resolutions.get(evidence.id);
        // Missing Host resolution is not proof that an owning record exists.
        const state = resolution?.state ?? "unknown";
        const label = state === "recorded" ? "evidenceRecorded" : state === "unresolved" ? "evidenceUnresolved" : "evidenceResolutionUnknown";
        return <article key={evidence.id || index} className={`goal-report-evidence-card res-${state}`} data-resolution={state}>
          <div className="goal-report-evidence-head">
            <Badge className="goal-report-ref-chip">#{evidence.id}</Badge>
            <span className="goal-report-evidence-kind">{t(`goalReport.view.evidenceKind.${evidence.kind}`)}</span>
            <code>{evidence.refId}</code>
            <Badge className={`goal-report-evidence-res-badge res-${state}`}>{t(`goalReport.view.${label}`)}</Badge>
          </div>
          <p className="goal-report-evidence-summary">{evidence.summary}</p>
          {evidence.detail && <p className="goal-report-evidence-detail">{evidence.detail}</p>}
          {resolution?.detail && <p className="goal-report-evidence-res-detail">{resolution.detail}</p>}
        </article>;
      })}</div>
    </div>}
  </ReportSection>;
}
