# PI-BG-1122: background servers keep running past the 60-second default

Status: 待体验 (committed on the branch, rebased onto `origin/main` `786179c99`, pushed as a draft PR; merge waits for the user). Project: `fork-pi-desktop`. Created: 2026-11-22 (Asia/Taipei).
Tier: T2 (changes how long a process runs under one approval and how it uses shared shell capacity; ADR background-server-adoption and D648 come first).
Baseline: `origin/main @ 786179c99` (the branch was rebased onto it on 2026-11-26; Batch C, PR 101, is merged, so no Batch C hunk remains in this diff).
Branch: `feat/20261122-pi-bg-1122-background-server-lifetime`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261122-feat-pi-bg-1122-background-server-lifetime`.
Commit, push, merge and release wait for the user's explicit word.

## Request and source

After PI-UI-1121 Batch C (the rail's Servers section) the user asked whether
background dev servers should be exempt from the 60-second default timeout. A
plan with seven decisions and their defaults was given in chat and the user
answered "按默认值开始执行". The defaults bind this change:

| # | Decision | Default |
| --- | --- | --- |
| D1 | Lifetime after adoption | 6 hours (`MAX_BASH_TIMEOUT_MS`), counted from the moment the address is first seen |
| D2 | Eligibility | background launch, no model `timeout`, not a Team service, prints a loopback URL; foreground is never adopted |
| D3 | Slots | 2 per session and 2 per Host; with no free slot the command keeps 60 seconds and says so |
| D4 | Permit and approval | shell permit held until the process tree ends; no new approval path |
| D5 | Model-visible text | one added sentence in the Bash description; every "default 60 seconds" sentence stays |
| D6 | UI | unchanged; no setting, no countdown |
| D7 | False positives | as D647: URL form only, first URL only; the Servers row shows and can stop it |

## Behavior change

- A background `Bash` command launched without a `timeout` is adopted when the
  Host's local-address detector first reports an address for it: its deadline
  becomes 21,600 seconds from that moment (once). Everything that does not print
  an address still ends at 60 seconds. An explicit `timeout` (any value), a
  foreground command and a Team service are unchanged.
- At most 2 adopted servers per session and 2 per Host. A slot is returned when
  the process tree is gone. With no free slot the command is not adopted and its
  end message names the cap.
- End messages: an adopted server stopped by its extended lifetime reports
  `timeoutMs` 21,600,000, `timeoutIsDefault: false` and a server-limit message.
  The default and explicit messages are unchanged byte for byte.
- The terminal audit row gains `serverAdoption` (`adopted` or `cap_reached`) when
  it applies. The Bash tool description gains one sentence.
- Unchanged: the 60-second default, the `timeout` range 1 to 21,600 seconds,
  Team services and their caps, the shell budget and its FIFO queue, the process
  list, the rail, every Host RPC, field and protocol version, storage.

## Baseline note

PI-UI-1121 Batch C (the loopback-address detector, D647) was built and uncommitted
when this task started, and adoption needs it. Batch C was committed as `e8edcb5c7`,
merged as pull request 101 (`ed162b47d`) and is part of `origin/main`, so the rebase of
this branch carries no Batch C hunk at all: the diff here is adoption only. The rebase
resolved two things: three adjacent hunks in `background_processes.rs` (this branch's
side, which is Batch C plus adoption, was kept) and the D648 row placement in both
decisions logs (D648 now sits after D647 and before D650).

## Implementation notes

- New module `crates/host-core/src/tools/server_adoption.rs`: the slot ledger
  (`AdoptionLedger`, one `Arc` in `AppState`), the RAII `AdoptionGrant`, the
  per-command `ServerAdoption` state and its outcome.
- `BackgroundOutput` (already shared with the execution loop) carries the
  per-command state, so `BashExecutionOptions` and its seven literal constructors
  stay untouched. `start()` arms it only for an eligible job.
- `tool_bash` asks after every processed output chunk and once more when its
  deadline fires; an adoption resets the pinned deadline and keeps the grant in a
  local until the function returns, which is after the process tree is gone.
- The end message is rewritten by a separate `annotate_outcome` that runs after
  the unchanged `annotate_timeout`, and only on a `TOOL_TIMEOUT` result.
- Tests call `background_processes::start` directly with a short default so no
  test waits 60 seconds; the 60-second path is covered by the E2E script.

## Validation

Run in this worktree on macOS arm64 with a real local dependency tree (the overlay
`node_modules` was replaced by a clone of the main checkout's tree) and a rebuilt
renderer, on the rebased commit. Every command below was run as written.

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check` | clean |
| `cargo clippy -p host-core --all-targets --all-features --locked --offline` | exit 0; two existing `too_many_arguments` warnings (`plugins/install.rs`, `team/roster.rs`), none from this change |
| `cargo test -p host-core --locked --offline`, whole crate | 1325 passed, 0 failed, 1 ignored in 103.5 s |
| `cargo build -p host-core` (debug, for the E2E) | built |
| agent-runtime `vitest run`, whole package | 202 files, 1927 tests passed |
| `check-test-quality`, `check-agent-policy`, `check-release-docs`, `check-architecture` | passed; no test baseline touched |
| Scenario index (`node scripts/generate-scenario-index.mjs --check`) | passed; the only change is the line number of the edited script's PASS line |
| docs `check-locales`, `check-docs` | 662 documentation pages, no problem |
| `scripts/e2e-background-bash-limit.mjs` against the debug Host binary of this worktree (isolated data dir, no provider calls) | PASS in 68 s: the 60-second default still times out, and a server that printed `http://localhost:5173/` is still running after it, listed with its address, then stops on request |
| `node scripts/check-pr-base-main.mjs` | head contains `origin/main` |

One environment caveat: this shell exports `NODE_USE_ENV_PROXY` plus `http(s)_proxy`
and `ALL_PROXY`. With them set, two unrelated `src/node-proxy.test.ts` cases fail (`route`
comes back `environment-proxy` instead of `direct`); the whole package passes with those
variables unset, and nothing in this change touches the proxy layer.

Adoption is covered at three levels: ledger and state-machine unit tests
(`tools/server_adoption.rs`), real-shell tests through `background_processes::start`
(`rpc/background_adoption_tests.rs`: adoption, no address, explicit timeout, late
address, session cap, Host cap, slot freed before the deadline, foreground), and the
production Host plus sidecar E2E script for the real 60-second default.

## NOT RUN and risks

NOT RUN:

- Electron E2E and `verify:ui:*`: no renderer, preload or UI file changed.
- A model-started real dev server (Vite, Next, `python -m http.server`) through the
  desktop app. The E2E script uses a Node one-liner that prints a URL; the detector
  itself is covered by the Batch C tests.
- Windows and Linux. The real-shell tests are `cfg(not(windows))`; only macOS ran
  locally, so the cloud gates are the first run elsewhere.
- `cargo clippy --workspace` and `cargo test -p update-helper`; only `host-core` was
  linted and tested, and no other crate is touched.
- A negative control of the E2E on a Host without adoption. The contrast is carried
  by the real-shell tests: the same serving command is stopped at an explicit
  `timeout` and kept running under the default.
- Release packages (GitHub-hosted runners only).

Risks and decisions left to the user:

- Shell capacity. An adopted server keeps its shell permit for up to 6 hours, so two
  of them hold half of the Host's four shell slots; with two Team services running as
  well all four are held, and any other shell command waits in the existing FIFO
  queue (30 seconds, then `HOST_OVERLOADED`). The 2 per session and 2 per Host caps
  bound it. A third server in a session is not adopted and ends at the default with
  a message naming the cap.
- False positives. A command that prints a loopback URL without serving (an `echo`, or
  a tool that prints a URL and then runs a long job) lives up to 6 hours. It shows in
  the rail's Servers section and can be stopped there; only 2 slots exist.
- Slow starters. A server that prints its URL only after the 60-second default is
  stopped as before; the end message still tells the model to pass `timeout`.
- Approval. The approval preview shows the call's arguments, not an implicit
  lifetime; the ADR records this. Adoption adds no approval path.
- Merge order. PI-UI-1121 Batch C is merged (PR 101), this branch is rebased onto
  `origin/main` `786179c99`, and D648 sits after D645 to D647 there. Nothing else waits
  in front of it.

Compatibility: protocol version, RPC methods, event and result fields, storage and
migrations are unchanged; only the `run_in_background` description text and the end
message of an adopted or cap-limited command change.
