# WP10 Team task dispatch scenarios

These are semantic acceptance IDs. The executable checks use isolated data and a
fake runtime/provider boundary; real paid providers and the user's app are not
default test environments.

| ID | Sequence | Required result | Automated evidence |
| --- | --- | --- | --- |
| E2E-TEAM-busy-member-latest-task-dispatch | Confirm expert, create owned task, keep expert in a controlled 40-minute turn; send two conflicting explicit dispatches; end turn. | Old ledger row retained/canceled; only latest starts after boundary; ordinary unrelated FIFO mail preserved. | Host `team_dispatch_age_tests`, Desktop `team-dispatch-age.test.mjs` |
| E2E-TEAM-completed-task-retires-queued-dispatch | Start task, queue a repeat dispatch, claim completed, successfully settle the owning turn. | Claim stays provisional; terminal success cancels repeat; current running dispatch and expert report/source proof retained. | Host `team_dispatch_age_tests`, Desktop completion/mirror replay |
| E2E-TEAM-dispatch-age-authenticated-framing | Resolve busy-at-send metadata from ledger and prompt member; restore its history. | Same framing and sentAt/task identity; warning says possibly stale; no new user authority. | Host-runtime `session-message-input.test.ts`, runtime collaboration history |
| E2E-TEAM-dispatch-replay-and-validation | Replay retired key; omit/change its association; submit malformed/stale/completed/foreign owner dispatch. | Retired key cannot resurrect work; conflicts and invalid ownership/revision reject without extra queue entries. | Host RPC regression, runtime tool producer regression |

Commands from the request worktree (reuse provisioned dependencies):

```sh
CARGO_TARGET_DIR="$PWD/.review-evidence/cargo-target" cargo test -p host-core --locked team
node --test apps/desktop/test/team-delivery.test.mjs apps/desktop/test/team-dispatch-age.test.mjs
node packages/agent-runtime/node_modules/typescript/bin/tsc -p packages/agent-runtime/tsconfig.json --noEmit
node apps/desktop/node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit
node scripts/check-test-quality.mjs --base 144b28bbb
```

Run package Vitest for runtime `team-dispatch`, `team-tools`, collaboration history,
Host-runtime input resolution and Agent Host queue tests. A fake 40-minute clock
proves boundary behavior, not 40 minutes of real provider reliability. Real-device
acceptance should inspect actual Host session/turn records rather than model
claims. No `verify:ui:*` is required or authorized by this change.
