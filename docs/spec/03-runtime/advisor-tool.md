# Advisor tool

The Advisor tool lets a main session ask a second, configured model for
guidance during a task. The executor calls `Advisor` with no parameters. The
runtime sends the conversation so far to the advisor model and returns its
reply as the tool result. The advisor has no tools, so its reply cannot act on
the host. The reply is advisory: the tool result tells the executor to verify
it before acting.

## Scope

- Main sessions only, in Agent, Plan and Goal modes (ADR 0319). Team roles and
  subagent runs never receive the tool, and Electron launch does not resolve
  the pin for team profiles.
- In Plan and Goal the consult stays read-only: it writes nothing, and the
  advisor model gets no tools. The call runs inside the runtime and never
  reaches Host, so no permission rule classifies it and no approval prompt
  appears in any permission mode. The pin in Settings is the consent.
- Off until the user picks a model. There is no built-in advisor.

## Settings

- `advisorProviderId` and `advisorModelId` are `AppSettings` fields. Absent or
  `null` means off.
- Settings → AI has an Advisor card after Prompt enhancement. Its row uses the
  shared model picker (`ModelPinMenu`) over the models the Composer offers. The
  menu's first row, `Off`, clears the pin.
- Clearing writes `null` for both ids. `settings.set` merges into the stored
  object, so a deleted key would keep the old pin. An empty provider id would
  name no provider, which config sync refuses (see Config sync).
- A pin the picker cannot list (provider removed or disabled, or model not
  offered) is kept. The row shows it with an `Unavailable` note.

## Launch

- `resolveAdvisorProvider` resolves the pin with the subagent binding rules
  (`bindProviderModel`). An API-key provider needs its stored key. A
  vendor-account (OAuth) provider needs the signed-in catalog binding, which
  the Electron main process supplies. A headless host reports such a pin as
  unavailable.
- The result is off, ready (one provider binding passed to the sidecar), or
  unavailable. Unavailable is logged as `advisor model unavailable` with the
  reason, and the session starts without the tool. A stale pin never blocks a
  session.
- The runtime's configuration match includes the advisor binding. Changing or
  clearing the pin retires an idle runtime.

## Tool contract

- Name `Advisor`. No parameters. Sequential execution.
- At most 5 calls per user turn (`ADVISOR_MAX_CALLS_PER_TURN`). The count
  resets when the next turn starts. A call over the cap returns
  `Advisor failed: the limit of 5 advisor calls for this turn was reached`
  without a provider request.
- The advisor request is one completion with the built-in review system prompt,
  and the transcript in a `<transcript>` block. Thinking level is `medium`. The
  output cap is 8,192 tokens. The system prompt asks for a reply under 400
  words.
- Success returns text that begins `Advisor guidance (advisory output from
  another model; verify it before acting):`, with `details.ok` true.
- Failure returns `Advisor failed: <reason>` with `details.ok` false, and the
  turn continues. Reasons include a provider error, an empty reply
  (`ADVISOR_EMPTY_REPLY`), and a transcript that does not fit.
- An abort from the session is rethrown, so the agent loop stops. It is never
  turned into a tool result.

## Transcript

- The advisor reads the conversation the executor's next request carries,
  serialized as plain text. Private reasoning is removed. So are tool calls
  that have no result yet, including the `Advisor` call that asked for the
  review.
- If the transcript is larger than the advisor model's input limit (its
  context hard limit minus 1,024 tokens reserved for the advisor's own prompt),
  long tool results are shortened with the reducer compaction uses. If it still
  does not fit, the call fails before any provider request with
  `the conversation is larger than the advisor model's input window`.

## Privacy

- A call sends the transcript to the chosen advisor provider, which can differ
  from the session's provider. The setting is off by default. The card's
  description says that the conversation goes to the provider the user picks.
- Thinking blocks are not sent.

## Config sync

- Both advisor fields are portable application fields. A non-null
  `advisorProviderId` that names no provider is a deferred config-sync
  dependency (`CONFIG_SYNC_DEPENDENCY`). A `null` pin has no dependency.

## Out of scope

- No per-call card. A call renders as an ordinary tool row named `Advisor`.
- The model cannot choose the advisor at call time. The pin is the only
  advisor.
- No tool for subagents or team roles.

## Verification

- The scenarios `E2E-ADVISOR-off-until-a-model-is-picked`,
  `E2E-ADVISOR-clear-row-returns-to-off`, and
  `E2E-ADVISOR-stale-pin-keeps-the-session-running` are automated in
  `scripts/e2e-advisor.mjs` (`pnpm test:e2e:advisor`, nightly tier), as the
  [E2E test plan](../06-delivery/04-e2e-test-plan.md) records. The run is
  full-app Electron on a loopback fixture: the session provider and the advisor
  pin are two endpoints on one server. It asserts that a session's requests
  declare `Read` but never `Advisor` when no model is picked or the picked one
  is unavailable, that no chat request reaches the advisor endpoint in any
  scenario, that clearing the pin stores explicit `null`s that survive a
  restart, and that the app log records `advisor model unavailable`.
- Unit and integration coverage: `advisor-tool.test.ts`,
  `advisor-provider.test.ts`, and `fixed-tool-runtime.test.ts` in
  `packages/agent-runtime`; the configuration match in
  `runtime-configuration.test.ts`; the launch resolver in
  `packages/host-runtime`; the config sync engine in `crates/host-core`; and
  `advisor-pin.test.mjs` and `advisor-card.test.mjs` in `apps/desktop/test`.
