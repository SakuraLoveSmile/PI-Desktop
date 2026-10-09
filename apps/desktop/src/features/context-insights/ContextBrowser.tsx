import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextInsightsRequest } from "@pi-desktop/shared";
import { Input, Panel, Select, SegmentedControl } from "../../components/ui";
import { Markdown } from "../../components/Markdown";
import { categories, count, searchEntries } from "./model";

export function ContextBrowser({
  request,
  baselineRequest,
  loading,
  toolSort,
  onToolSort,
}: {
  request: ContextInsightsRequest | undefined;
  baselineRequest?: ContextInsightsRequest;
  loading: boolean;
  toolSort: "tokens" | "name";
  onToolSort: (sort: "tokens" | "name") => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [assistantFilter, setAssistantFilter] = useState("all");
  const [format, setFormat] = useState<"raw" | "markdown">("raw");
  const entries = searchEntries(request?.entries ?? [], query, assistantFilter);
  return (
    <Panel className="ci-card ci-browser">
      <h3>{t("contextInsights.browser")}</h3>
      <div className="ci-controls">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("contextInsights.searchContext")}
          placeholder={t("contextInsights.searchContext")}
        />
        <Select
          value={assistantFilter}
          onChange={(event) => setAssistantFilter(event.target.value)}
          aria-label={t("contextInsights.filterAssistant")}
        >
          {["all", "thinking", "calls", "answer"].map((value) => (
            <option key={value} value={value}>
              {t(`contextInsights.${value}`)}
            </option>
          ))}
        </Select>
        <SegmentedControl
          label={t("contextInsights.rendering")}
          value={format}
          onChange={setFormat}
          options={[
            { value: "raw", label: t("contextInsights.raw") },
            { value: "markdown", label: t("contextInsights.markdown") },
          ]}
        />
      </div>
      {loading ? (
        <p role="status">{t("contextInsights.contentLoading")}</p>
      ) : !request ? (
        <p className="ci-muted">{t("contextInsights.contentMissing")}</p>
      ) : (
        <>
          <p className="ci-note">{t("contextInsights.projectionNote")}</p>
          {request.providerPayload ? (
            <details className="ci-category">
              <summary>
                <strong>{t("contextInsights.providerPayload")}</strong>
              </summary>
              <p className="ci-muted">{t("contextInsights.payloadNote")}</p>
              {request.providerPayload.truncated && (
                <p className="ci-muted">{t("contextInsights.truncated")}</p>
              )}
              {format === "markdown" ? (
                <div className="prose-chat ci-content">
                  <Markdown source={request.providerPayload.content} renderDiagrams={false} />
                </div>
              ) : (
                <pre className="ci-content">{request.providerPayload.content}</pre>
              )}
            </details>
          ) : (
            <p className="ci-muted">{t("contextInsights.noProviderPayload")}</p>
          )}
          {request.contentTruncated && <p className="ci-note">{t("contextInsights.truncated")}</p>}
          {!entries.length && <p className="ci-muted">{t("contextInsights.noMatches")}</p>}
          {categories.map((category) => {
            const rows = entries.filter((entry) => entry.category === category);
            if (
              !rows.length &&
              (query.trim() ||
                !baselineRequest?.entries.some((entry) => entry.category === category))
            )
              return null;
            if (category === "tools")
              rows.sort((a, b) =>
                toolSort === "name"
                  ? a.label.localeCompare(b.label)
                  : b.estimatedTokens - a.estimatedTokens,
              );
            const categoryRows =
              request?.entries.filter((entry) => entry.category === category) ?? [];
            const before =
              baselineRequest?.entries.filter((entry) => entry.category === category) ?? [];
            const tokenDelta =
              categoryRows.reduce((sum, row) => sum + row.estimatedTokens, 0) -
              before.reduce((sum, row) => sum + row.estimatedTokens, 0);
            const itemDelta = categoryRows.length - before.length;
            return (
              <details
                key={category}
                className="ci-category"
                open={query.trim() ? true : undefined}
              >
                <summary>
                  <i data-category={category} />
                  <strong>{t(`contextInsights.${category}`)}</strong>
                  <span>
                    {rows.length} · ≈
                    {count(rows.reduce((sum, row) => sum + row.estimatedTokens, 0))}
                  </span>
                  {baselineRequest && (
                    <span>
                      {t("contextInsights.categoryDelta", {
                        tokens: `${tokenDelta >= 0 ? "+" : ""}${count(tokenDelta)}`,
                        items: `${itemDelta >= 0 ? "+" : ""}${itemDelta}`,
                      })}
                    </span>
                  )}
                </summary>
                {category === "tools" && (
                  <Select
                    value={toolSort}
                    onChange={(event) =>
                      onToolSort(event.target.value === "name" ? "name" : "tokens")
                    }
                    aria-label={t("contextInsights.toolSort")}
                  >
                    <option value="tokens">{t("contextInsights.tokens")}</option>
                    <option value="name">{t("contextInsights.name")}</option>
                  </Select>
                )}
                {rows.map((entry) => (
                  <details
                    key={entry.id}
                    className="ci-entry"
                    open={query.trim() ? true : undefined}
                  >
                    <summary>
                      <span>{entry.label}</span>
                      {category === "tools" && (
                        <span>
                          {t(
                            /^(Read|Write|Edit|Glob|Grep|Bash|Task|AskTool|SubmitPlan|new_context)$/i.test(
                              entry.label,
                            )
                              ? "contextInsights.sourceBuiltin"
                              : /^mcp[_:.-]/i.test(entry.label)
                                ? "contextInsights.sourceMcp"
                                : /^plugin[_:.-]/i.test(entry.label)
                                  ? "contextInsights.sourcePlugin"
                                  : "contextInsights.sourceUnknown",
                          )}
                        </span>
                      )}
                      <span>
                        {t("contextInsights.estimatedEntry", {
                          tokens: count(entry.estimatedTokens),
                        })}
                      </span>
                    </summary>
                    {entry.truncated && (
                      <p className="ci-muted">{t("contextInsights.truncated")}</p>
                    )}
                    {entry.contentOmitted ? (
                      <p className="ci-muted">{t("contextInsights.omitted")}</p>
                    ) : format === "markdown" ? (
                      <div className="prose-chat ci-content">
                        <Markdown source={entry.content} renderDiagrams={false} />
                      </div>
                    ) : (
                      <pre className="ci-content">{entry.content}</pre>
                    )}
                    {entry.images?.length ? (
                      <p className="ci-muted">
                        {t("contextInsights.imageMetadata", { count: entry.images.length })} ·{" "}
                        {entry.images
                          .map((image) => `${image.mimeType} ${count(image.encodedBytes)} B`)
                          .join(", ")}
                      </p>
                    ) : null}
                  </details>
                ))}
              </details>
            );
          })}
        </>
      )}
    </Panel>
  );
}
