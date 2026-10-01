export const MAX_APPROVED_TITLE_INPUT_CODE_POINTS = 6_000;
export const SESSION_TITLE_FALLBACK_CODE_POINTS = 48;

/** Terminal execution state is valid; only identity change or explicit cancellation makes it stale. */
export function isSameTitleExecution(
  checkpoint: { executionId?: string; scheduleState?: string } | undefined,
  executionId: string,
): boolean {
  return checkpoint?.executionId === executionId &&
    checkpoint.scheduleState !== "cancelled";
}

function truncateCodePoints(value: string, limit: number): string {
  let output = "";
  let count = 0;
  for (const point of value) {
    if (count++ >= limit) break;
    output += point;
  }
  return output;
}

export function approvedExecutionTitleInput(
  proposalTitle: string,
  proposalQuestion?: string,
): string {
  const parts = [`Approved task title: ${proposalTitle.trim()}`];
  const question = proposalQuestion?.trim();
  if (question) parts.push(`Approved task question: ${question}`);
  return truncateCodePoints(parts.join("\n\n"), MAX_APPROVED_TITLE_INPUT_CODE_POINTS);
}

export function approvedExecutionFallbackTitle(
  proposalTitle: string,
): string {
  return truncateCodePoints(
    proposalTitle.trim().replace(/\s+/g, " "),
    SESSION_TITLE_FALLBACK_CODE_POINTS,
  );
}

export function canReplaceAutomaticSessionTitle(
  currentTitle: string | null | undefined,
  fallbackTitles: string | readonly string[],
  lastAutoTitle?: string,
  isDefaultTitle = false,
): boolean {
  if (isDefaultTitle) return true;
  const current = currentTitle?.trim();
  const fallbacks = typeof fallbackTitles === "string" ? [fallbackTitles] : fallbackTitles;
  return Boolean(
    current &&
      (fallbacks.includes(current) || (lastAutoTitle && current === lastAutoTitle)),
  );
}
