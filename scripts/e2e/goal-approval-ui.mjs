/** Open the current Goal's measured permission menu before choosing Auto. */
export async function approveGoalAuto({ sessionId, label, run, waitFor, click }) {
  const pane = `[data-session-pane="${sessionId}"][data-visible="true"]`;
  const trigger = `${pane} [data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-approve-menu:not(:disabled)`;
  const auto = '.plan-approval-menu.is-open [data-approval-mode="auto"]:not(:disabled)';
  const clickElement = click ?? (selector => run(selector => document.querySelector(selector).click(), selector));
  await waitFor(selector => Boolean(document.querySelector(selector)), trigger, `${label} approval menu`);
  const scope = await run(({ trigger, sessionId }) => {
    const target = document.querySelector(trigger);
    const first = document.querySelector('.plan-approval-approve-menu:not(:disabled)');
    const scope = first !== target ? {
      intended: sessionId,
      firstGlobal: first?.closest('[data-session-pane]')?.getAttribute('data-session-pane'),
      firstGlobalVisible: first?.closest('[data-session-pane]')?.getAttribute('data-visible'),
    } : null;
    target.scrollIntoView({ block: 'center' });
    return scope;
  }, { trigger, sessionId });
  if (scope) console.log("TEAM_APPROVAL_SCOPE", JSON.stringify(scope));
  await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await clickElement(trigger);
  await waitFor(({ trigger, auto }) =>
    document.querySelector(trigger)?.getAttribute('aria-expanded') === 'true'
      && Boolean(document.querySelector(auto)), { trigger, auto }, `${label} Auto permission`).catch(async error => {
    const state = await run(trigger => {
      const target = document.querySelector(trigger);
      return {
        expanded: target?.getAttribute('aria-expanded'), target: target?.getBoundingClientRect().toJSON(),
        triggers: Array.from(document.querySelectorAll('.plan-approval-approve-menu')).map(node => ({
          session: node.closest('[data-session-pane]')?.getAttribute('data-session-pane'),
          visible: node.closest('[data-session-pane]')?.getAttribute('data-visible'), disabled: node.disabled,
          rect: node.getBoundingClientRect().toJSON(),
        })),
        menus: Array.from(document.querySelectorAll('.plan-approval-menu')).map(node => ({ className: node.className, text: node.innerText })),
      };
    }, trigger);
    throw new Error(`${error.message}; approval=${JSON.stringify(state)}`, { cause: error });
  });
  await clickElement(auto);
}
