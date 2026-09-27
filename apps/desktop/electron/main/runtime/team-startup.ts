export async function restoreAgentHostThenDrain(
  agentHost: { start: () => Promise<void> },
  drainPending: () => Promise<void>,
): Promise<void> {
  await agentHost.start();
  await drainPending();
}
