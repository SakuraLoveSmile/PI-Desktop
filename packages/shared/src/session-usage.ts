/**
 * Session-wide cumulative usage, aggregated by the host from the turn ledger.
 * The renderer only holds the newest transcript page, so it cannot derive these
 * totals itself without under-reporting a reopened long session.
 */
export type SessionUsageTotals = {
  /** Turn rows for the session: one per user prompt. */
  rounds: number;
  /** Physical model requests across those turns. */
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export function emptySessionUsageTotals(): SessionUsageTotals {
  return {
    rounds: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}