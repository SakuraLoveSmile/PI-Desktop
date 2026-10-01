# Pi-Desktop-Plus macOS Local Network Repair Plan

Revision: 2026-10-01.3. Integrated closeout contract; historical records retained below.
Repository policy requires English repository documents; the user-facing summary is Chinese.

## Current integration and acceptance state — 2026-10-01

The source implementation was merged to `main` in PR #22, now at `12cfb84134fdfac58ba148c023e81f864a2f1e19`. This document preserves the earlier execution records as historical evidence; their unsigned-candidate prompt and HTTP observations do not establish native acceptance for the current integrated source or a final signed artifact. No native macOS permission or LAN acceptance was performed during this documentation integration. Do not mark native acceptance or the repair **已验收** from those historical observations; only explicit user confirmation establishes **已验收**.

Source checks at this base show the timestamp policy helper and per-slice UUID parsing are present. Their existence is not a substitute for the behavioral closeout gates below. Re-run the focused checks against the exact candidate before updating status. The Developer ID/notarization release lane remains a separate qualification.

### Closeout contracts

- **Timestamp policy:** local signing may use `mac.timestamp=none` only when no secure timestamp is required. Require secure timestamps for `PI_MAC_SECURE_TIMESTAMP=1`, effective `mac.notarize=true`, or configured notarization credentials when `mac.notarize` is not explicitly false. Respect effective `-c`/`--config` option precedence, preserve explicit authority URLs, reject a conflicting `timestamp=none` before assembly or packaging, and emit one effective choice. The release workflow must declare secure mode; do not inspect or log credential values. Keep the no-timestamp local default and Windows/Linux behavior.
- **Mach-O identity:** compare every candidate architecture slice with a matching architecture in each required input/reference. Normalize architecture aliases and UUID case; reject missing, malformed, duplicate, or unreadable slices and unverifiable counterpart architectures. A valid primary slice cannot mask a secondary collision. Keep thin packaging supported, preserve existing CLI/exit/report compatibility, and include per-slice identity and architecture in reports. Pre-sign and post-package checks must share the same comparison rules and inspect the actual packaged output; shared library UUIDs remain informational.
- **Native acceptance:** tie evidence to one frozen signed artifact by hash and all main-executable UUIDs. A fresh GUI permission state must exercise Fetch list, the human Allow decision, the named Plus settings entry, HTTP 200 and visible fixture models, then Deny, manual re-enable, and restart persistence. Keep the official app and its data untouched. An unsigned observation, mock, 401, or terminal request cannot satisfy this gate. If the clean GUI state or authorized LAN fixture is unavailable, record T3 as **实现中**; Developer ID/notarization and x64 device evidence remain separately qualified.

The timestamp and per-slice contracts above refine the existing T1 execution history; they do not erase it. Existing T1/T2 source fixes merged by PR #22 remain in the source of truth. Any remaining gap must be established by current source and focused tests, not inferred from older planning text.

## Outcome and execution boundary

T1 qualifies Plus's independent macOS executable identity. T2 triggers Local Network authorization from the existing **Fetch list** action. T3 verifies the signed candidate's native prompt, independent settings entry, and HTTP connectivity. The source implementation is merged by PR #22. The status statements in the 2026-10-01 execution records below describe those historical runs; this revision does not claim native acceptance for the integrated source or a final signed artifact. Overall status remains **实现中** until the closeout contracts above are verified on the applicable candidate. **已验收** requires explicit user confirmation.

This request authorizes saving this plan only. A later implementation instruction authorizes the source changes and isolated local verification described below. It does not automatically authorize committing, pushing, publishing, notarization submissions, replacing `/Applications` apps, creating OS users, changing system privacy settings, using the user's running instance, or accessing a real provider. Obtain only the missing authorization for a concrete dependent operation; continue independent authorized work.

Preserve official PI-Desktop, Plus profiles, Keychain entries, existing provider configuration, updater ownership, and database semantics. No migration or data import is needed. Do not expand into `/v1` normalization, API-key changes, model selection redesign, general request cancellation, or unrelated signing/release repairs.

## Verified baseline and evidence limits

- Primary checkout: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop`. It was clean on `main` before planning. `git fetch origin main` completed during this planning turn.
- Plan worktree: `/Users/sakurasep/.codex/worktrees/macos-local-network-plan/PI-Desktop`, branch `codex/macos-local-network-repair-plan`, surveyed base `aef7aad669bb12357d58d899516aeec5473e40e4` (`origin/main`). Only this document is written. Refresh the base before implementation and preserve any later changes.
- Earlier in this conversation, `/Applications/Pi-Desktop-Plus.app` and the built bundle under `apps/desktop/release/mac-arm64/` were inspected: version `0.15.6`, bundle ID `cn.sakura.pi-desktop`, Apple Development signing identity, valid `codesign --verify --deep --strict`, and `NSLocalNetworkUsageDescription` present. This qualifies signature integrity, not Developer ID distribution or notarization.
- Installed official PI-Desktop `0.15.10` has ID `net.aiuo.pi-desktop`. Both installed main executables report arm64 UUID `4C4C44B6-5555-3144-A187-35A40BAD7A39`.
- Apple TN3178 documents network-subsystem confusion when differently identified applications reuse a main executable UUID. TN3179 states that Local Network identity uses code signing and the main executable UUID. The collision is verified; causality for this incident is not yet proven. No post-fix packet, HTTP, native prompt, or settings evidence exists.
- Historical September 22 evidence concerned official PI-Desktop `0.15.3`: `ERR_ADDRESS_UNREACHABLE` coincided with kernel NECP drops before TCP establishment. That evidence cannot establish the current Plus failure. The recent attempt to read the system log store failed; do not substitute historical logs for a fresh reproduction.
- `apps/desktop/package.json` declares the usage description and Bonjour services. `model-discovery.ts:discoverProviderModels` uses a 10-second HTTP timeout; main-process fetch is installed from Electron `net.fetch` in `network-proxy.ts`. There is no explicit Local Network trigger.
- Existing model-fetch flow: `ProviderSetupDialog` / `VendorAccountDialog` → `useProviderModels` → `api.listProviderModels` → `pi-desktop/providers/listModels` → `provider-ipc.ts`. Ordinary endpoint discovery calls `discoverProviderModels`; OAuth account discovery uses a separate vendor branch.
- The hook automatically fetches after edits (600 ms debounce) and refreshes saved providers. Its `reload()` is the existing manual action. Both currently use the same request shape. `requestSeq` rejects stale renderer results but does not cancel an already-issued main-process request.
- Source inspection is the UI baseline. No native window was opened during planning. No layout or visual design change is requested.

Read before implementation: root `AGENTS.md`; nearest existing scoped rules (`apps/desktop/src/AGENTS.md` for renderer work); root `README.md` and `packages/README.md`; `docs/spec/00-baseline.md`; `docs/spec/03-runtime/11-provider-model-system.md` and `12-provider-config-schema.md`; `docs/spec/06-delivery/{03-ai-development-workflow,04-e2e-test-plan,05-change-checklist}.md`; `docs/adr/0278-canonical-application-id.md`, `0289-signed-macos-github-releases.md`, and `0308-independent-plus-application-identity.md`. Some rule paths advertised by root AGENTS, including Electron and shared scoped files and `apps/desktop/README.md`, do not exist on the surveyed base; use root rules rather than inventing them. ADR 0308 intentionally amends upstream identity decisions for this fork; keep `cn.sakura.pi-desktop`.

External references:

- [Apple TN3178](https://developer.apple.com/documentation/technotes/tn3178-checking-for-and-resolving-build-uuid-problems)
- [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Electron build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn)
- [electron-builder configuration](https://www.electron.build/configuration.html)

## Frozen behavior and shared contract

### Application identity

Keep the Plus bundle ID, product name, independent data roots, update feed, and signing-team configuration. Each supported macOS architecture must have a Plus main executable UUID different from the stock Electron input and official PI-Desktop. The identity change happens in candidate construction before final signing, never in an installed app. The Electron source version stays pinned to the repository's `43.4.1`; changing Electron versions merely to get a different UUID is outside this fix.

The selected supported route is an independently linked Electron main executable supplied through electron-builder `electronDist`. T1 contains a bounded feasibility gate because this repository has neither an independent Electron build nor an established UUID manipulation tool. Do not represent this route as already working. Do not patch `LC_UUID` in installed/signed bundles or introduce ad hoc signing hooks. `afterPack` is before signing and may inspect candidate identity; `afterSign` must not alter binary bytes.

### Manual discovery intent

Add one backward-compatible optional input field to `api.listProviderModels` and the corresponding main handler:

```ts
intent?: "manual-fetch-list";
```

Only `useProviderModels.reload()` sets this field on its live request. Effect/debounce requests, cache hydration, existing string-form IPC calls, and all other callers omit it. Omission keeps existing behavior. Do not use `source: "refresh"` as a manual-action proxy. Keep the IPC channel and `{ models, source, error? }` response unchanged. This transient field is never persisted and does not enter Host RPC, Plugin SDK, or the database. A nonmatching intent must never enable the trigger.

The trigger runs inside the ordinary live discovery branch immediately before `discoverProviderModels`, after its effective base URL has been resolved. Cache and OAuth-account branches bypass it. For manual calls, capture the effective endpoint and operation dependencies before the new `await`; do not reread mutable handler-level host state to select a different provider after that await. Preserve the existing provider-revision/cache guards and renderer sequence checks.

### Local-network trigger

Create a small Electron-main controller with `trigger(baseUrl): Promise<TriggerResult>` and `dispose(): void`. Its internal result distinguishes `skipped`, `attempted`, and `failed`; none means permission was granted. Socket, DNS, proxy, and clock facilities are injectable at their external boundaries for tests. Do not add another renderer permission channel or a system-permission polling framework.

- Only macOS plus exact manual intent can call it. Startup and automatic refresh never call this supplemental trigger. Existing automatic HTTP requests may still cause an OS alert naturally; this plan does not suppress or redesign them.
- Accept only a valid HTTP(S) endpoint. Use its effective port (explicit port, otherwise 80/443). Do not send credentials, HTTP headers, payloads, broadcast, multicast, or Bonjour browse traffic.
- Ask the same Electron default session carrying discovery fetch for its actual proxy route. Only a direct route is eligible. A proxy route, unknown route, route-check failure, or fake-IP address skips the probe without overriding transport configuration. Preserve direct bypass-list behavior. Never create a direct LAN bypass for proxied discovery.
- Reuse `classifyIpLiteral` from `packages/shared/src/public-network.ts`. Eligible literal classes are `private`, `link-local`, `ula`, and `site-local`; exclude loopback, public, unspecified, multicast, documentation, benchmark, reserved, CGNAT, and invalid addresses. Normalize brackets and IPv4-mapped IPv6 consistently with that classifier. Exclude `localhost` and its subdomains before DNS.
- For a direct hostname endpoint, perform one bounded main-process lookup (`all: true`) and inspect the returned addresses. Select the first eligible local unicast address in resolver order, never an arbitrary public or fake-IP address. This covers `.local` and private DNS names. Do not change or pin the subsequent HTTP transport's DNS result: this is a prompt trigger, not an endpoint authorization decision. DNS/proxy uncertainty falls back to normal discovery, not a guessed local destination. Scope-less IPv6 link-local addresses that cannot be connected safely skip with a diagnostic reason.
- Connect one `node:dgram` UDP socket of the matching family to that local address and port; do not call `send()`. Apple describes UDP connect as an implicit alert trigger without network traffic. A callback is only trigger evidence, never an authorization-state API.
- Planning value: 1,500 ms total budget for proxy lookup, hostname resolution, and connect. This bounds the supplemental operation, not the user's response to the native dialog. Ignore late callbacks after settlement; clear timers, remove listeners, and close sockets on success, error, timeout, and disposal. Bounded DNS/proxy promises may finish late but cannot create a socket after the deadline.
- Coalesce concurrent operations for the same normalized endpoint while they are pending. Different endpoints do not await an unrelated destination. Do not memoize permission success or store a permanent granted bit; the user may revoke access in System Settings.
- Controller lifetime belongs to IPC registration in `apps/desktop/electron/main/ipc/register.ts`. Create it once, inject `trigger` into provider IPC, and dispose once on application shutdown with its lifecycle listener removed on disposal. Keep `main/index.ts` stable; do not place network logic there.
- Probe errors produce a sanitized diagnostic (stage and error code; no API key, headers, query, or URL credentials). Continue normal HTTP discovery and retain its response/error and catalog fallback. Controller disposal may cancel its operation; it must not start another request during shutdown.

macOS has no general API to force the prompt, query the privilege, or reset one application's state to undetermined. If denied, do not repeatedly prompt or retry. The user enables Plus in System Settings → Privacy & Security → Local Network. If the first HTTP call fails while the user is answering the alert, the existing Fetch list action is the explicit retry after Allow. Keep the existing 10-second HTTP timeout; no fixed sleep, extra automatic HTTP retry, or invented success toast.

### Visual and compatibility baseline

Keep `ProviderSetupDialog`, `VendorAccountDialog`, and `ModelSelectionPanes` layouts, strings, controls, loading/disabled states, focus behavior, and provider-save flow. Retain the existing `provider-models-reload` button and `canReload` behavior. No new button, startup dialog, Settings page, global token, or component library is needed. Windows/Linux, public endpoints, loopback endpoints, API-style paths, credentials, custom headers, cache/catalog precedence, and provider bindings remain compatible. A later change that introduces user-visible copy must use i18n, but it is not planned here.

## Tasks and ownership

### T1 — Qualify an independently identified signed Plus candidate

Owner: packaging subagent. Exclusive files: new `scripts/macos-executable-identity.mjs` and its focused test under `apps/desktop/test/`; a task-local Electron-build recipe/manifest if the gate passes. Main agent alone owns `apps/desktop/package.json`, release-entry wiring, ADR/spec changes, and this plan. T1 and T2 can run concurrently.

Inputs: baseline evidence above, pinned dependency versions, Apple notes, electron-builder `electronDist`/`afterPack` types, `scripts/release-macos.sh`, `scripts/verify-macos-release.sh`, and existing macOS release tests. The existing verifier requires notarized Developer ID artifacts and must not be weakened to accept Apple Development candidates.

Steps:

1. Reconfirm candidate and official identities using plist inspection, `dwarfdump --uuid`, and `codesign --verify --deep --strict`. Record architecture, main UUID, version, signature category, and team without printing personal certificate labels or credentials. Read installed bundles only.
2. Build a read-only identity verifier for supplied candidate/input paths. It checks each architecture, main executable, usage description, expected Plus ID, and duplicate main UUIDs. Test it with captured/synthetic tool results and failures, including missing UUID, wrong app ID, duplicate UUID, and missing/failed signature results. Original and fixed candidates must respectively fail/pass the collision gate. Libraries sharing UUIDs are not the failure condition.
3. **Bounded feasibility gate:** inspect the host's existing Electron source/toolchain/cache and resource availability. In isolated scratch, follow the version-matched Electron source build instructions and independently link the main executable using the Apple linker's documented `-Wl,-random_uuid` behavior (verify the exact GN/macOS linker invocation before attempting it). Keep all required Electron executable/resource/version relationships intact and preserve matching debug-symbol UUIDs. Supply that compatible distribution with `electronDist`; do not commit vendor source, build outputs, certificates, or a second JS environment. A source-build environment is justified by this identity requirement, not by E2E convenience.
4. Validate a candidate using the existing Apple-issued signing setup, with final signing performed by electron-builder. Prove independent UUID, deep/strict signature integrity, and a clean isolated launch. Local Apple Development is sufficient for local identity qualification; a Developer ID/notarized release is a separate qualification. Do not invoke the notarizing release script just to test local permission.
5. If feasible, main agent wires the independent distribution into all existing macOS package entry points (`pack`, `dist`, `dist:mac`, signed lane) and puts the pre-sign identity gate in their common path. Fail a release build clearly if required input/identity is invalid; no silent stock-Electron fallback. Leave Windows/Linux paths unchanged. Update the independent-install decision's consequences and packaging instructions.

Feasibility success requires a compatible independently linked Electron distribution, a valid final signature, independent UUIDs, matching symbols when produced, and a working isolated candidate. Toolchain absence, an unsupported linker configuration, or inability to preserve signing/runtime compatibility blocks T1's wiring and T3's final acceptance. After two attempts with different evidence for the same blocker, stop and report expected/actual results; do not start a native launcher rewrite, Electron upgrade, binary-patching fallback, or credential workaround. T2 remains independently executable. A temporary stock-Electron test is diagnostic only and does not close T1.

Deliverables: identity checker/tests, reproducible build-input recipe if proven, source-version/architecture metadata, candidate identity report, signature/launch evidence, and any precise gate blocker. Independent source-build feasibility has **not** been demonstrated during planning.

### T2 — Trigger authorization from Fetch list without changing discovery

Owners: permission-service subagent plus main agent. The subagent exclusively owns new `apps/desktop/electron/main/local-network-permission.ts` and `apps/desktop/test/local-network-permission.test.mjs`. Main agent exclusively owns renderer `useProviderModels.ts`, `src/lib/api.ts`, `ipc/provider-ipc.ts`, `ipc/register.ts`, and modifications to existing fixture/tests. T2 depends only on the frozen contract, not T1's candidate.

Required inputs: the frozen contract, source files named above, `public-network.ts`, `network-proxy.ts`, `model-discovery.ts`, `model-discovery-precedence.test.mjs`, and `scripts/e2e/provider-api-style.tsx`.

Steps:

1. Add failing regression coverage before implementation: a real Fetch list interaction must carry manual intent, automatic discovery must omit it, and a direct manual LAN request must invoke the trigger before HTTP discovery. Existing source-regex tests alone cannot establish this flow.
2. Implement the controller and behavior tests against socket/DNS/proxy/clock boundaries. Verify address classes, direct/proxy/bypass behavior, total deadline, late completion, same-endpoint coalescing, next attempt after settlement, and disposal cleanup. A socket-connect error must be observable but cannot replace the HTTP result.
3. Main agent carries the optional input end to end, injects the controller, and adds a handler integration test entering through the registered provider IPC. Mock real external boundaries (Host RPC, HTTP, socket/DNS, OAuth, catalog resource I/O), not the internal permission workflow. Cover legacy request shapes, cache/OAuth/public/loopback/non-macOS skips, manual LAN order, HTTP success and failure, and unchanged result/fallback semantics.
4. Extend the existing real React fixture to click Fetch list, inspect the manual request, change the endpoint while a deferred result is outstanding, and prove stale results do not replace newer rows. Cover the shared hook's OAuth form without authorizing its account branch. Do not remove or relax existing API-format assertions.
5. Run targeted checks and integrate the subagent delivery. Capture baseline failure, fixed results, actual command versions, and the observable-path mapping.

Deliverables: backward-compatible manual intent, integrated controller, regression tests, unchanged UI, and targeted validation evidence. No Host/Rust migration, new IPC channel, network-permission persistence, or Plugin SDK change is expected.

### T3 — Prove native authorization and real connectivity

Owner: main agent. Exclusive files: plan execution record, relevant spec sections, `scripts/e2e/provider-api-style.tsx` integration, and a focused isolated Electron IPC smoke scenario if the existing harness cannot exercise the real main handler. Do not create a general permission-testing platform. T3's final native acceptance depends on both T1 and T2 being integrated and the required environment being authorized/available.

Update `docs/spec/03-runtime/12-provider-config-schema.md` with manual intent/trigger behavior, `docs/spec/06-delivery/04-e2e-test-plan.md` with a uniquely named `E2E-MAC-local-network-manual-discovery` scenario and traceability, `docs/adr/0308-independent-plus-application-identity.md` with qualified executable identity, and relevant user/build documentation. Keep domain rules in one authoritative section. Do not amend frozen process/storage ownership; a new ADR is needed only if implementation would cross those boundaries, which this plan excludes.

Validation sequence:

1. Confirm the task candidate contains latest `origin/main`. Record head/base and diff or artifact hash if the source is uncommitted. Never label an uncommitted tree as a tested commit. Commit only when explicitly requested. Candidate E2E runs in this request worktree, reusing the primary host toolchain/dependencies/cache by reference where compatible; isolate profiles, data, ports, sockets, logs, and output.
2. Run the real React interaction suite and a focused Electron IPC path against a local fixture, without real providers or user data. A loopback fixture can prove request/response wiring and list rendering, but cannot prove Local Network permission. An injected UDP edge can prove trigger order/cleanup, but cannot prove a macOS alert.
3. For native acceptance, use an authorized fresh macOS user or VM snapshot with no prior Plus Local Network choice, the independently identified signed candidate, and an isolated Plus profile. Do not create an account/VM or install/replace applications implicitly. Launch through Finder/LaunchServices in that GUI session, not as a Terminal-spawned command: Apple documents command-line exemptions that can invalidate the test. A different data directory alone does not reset OS privacy state.
4. Use an operator-authorized LAN HTTP fixture with no credentials or paid service. Supply `/v1/models` returning an OpenAI-style list such as `{"data":[{"id":"lan-fixture"}]}` and enter a base URL ending in `/v1`. Record actual fixture IP/port from that environment rather than copying the historical gateway. With the app foregrounded, click Fetch list; capture the native alert naming Plus and the separate System Settings entry. The human responds Allow/Deny. Never synthesize or bypass their consent.
5. On Allow, click Fetch list again if the first request failed before consent. Require a real HTTP response, followed by rendered `lan-fixture` rows for the 200 fixture. A 401 from an authorized gateway proves HTTP reachability only, not successful model discovery. Do not infer either result from UDP callbacks or a terminal curl.
6. Verify Deny in a separate clean snapshot/account if available: no automatic re-prompt/retry loop; the user enables Plus in Local Network settings and retries using the same button. Verify restart retains that choice. The official app's identity, existing permission choice, profile, and data must remain unchanged; record both settings entries when both are present. Avoid launching/modifying the official app as a default test target.
7. Smoke public endpoint, loopback, cache/automatic refresh, proxy/direct bypass, and Windows/Linux skip cases at the automated level. Native x64 qualification requires a matching Mac/runner; arm64 evidence does not prove x64. No universal package is currently promised, but any supplied universal distribution must pass per-slice identity checks.

Deliverable evidence separates source, automated checks, local signing, native prompt/settings, real LAN HTTP, and release publication. T3 remains **实现中** if necessary native checks or T1 feasibility are blocked. Only after applicable validation passes is the repair **待体验**; **已验收** requires explicit user confirmation.

## Commands and verification scope

Run commands from the implementation worktree. The following existing entries were located during planning; they have not been executed as post-fix verification:

```bash
pnpm build:js
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
node --test apps/desktop/test/model-discovery.test.mjs apps/desktop/test/model-discovery-precedence.test.mjs apps/desktop/test/provider-model-config.test.mjs apps/desktop/test/network-proxy.test.mjs apps/desktop/test/auto-update.test.mjs apps/desktop/test/macos-release-lane.test.mjs apps/desktop/test/macos-release-verification.test.mjs
pnpm test:e2e:provider-api-style
node docs/scripts/check-docs.mjs
git diff --check
```

Add the new helper, identity, and provider-IPC behavior test file paths to the direct `node --test` command after creating them. If imported shared exports are changed, run `pnpm --filter @pi-desktop/shared test` and build/typecheck the affected consumers. Use the fixture's own explicit completion/deferred promises and controlled clock, not arbitrary sleeps. The existing desktop `test` script expands `test/*.test.mjs`; appending a filename to that pnpm script does not reliably narrow it, so use direct Node file selection for targeted checks.

Run a relevant task-candidate Electron IPC/renderer smoke scenario as described in T3, rather than the whole E2E matrix. Native permission acceptance is additional and cannot be replaced by it. Do not run `verify:ui:*`; this planning request does not authorize those commands. No Rust changes are planned, so Cargo tests/clippy are not applicable unless implementation actually expands into Rust (which requires an evidenced reason).

Read-only candidate checks, with operator-supplied paths, are:

```bash
dwarfdump --uuid "$TASK_CANDIDATE_APP/Contents/MacOS/Pi-Desktop-Plus"
codesign --verify --deep --strict --verbose=2 "$TASK_CANDIDATE_APP"
```

Use a plist reader and sanitized signature parser for identity metadata; do not paste raw signing-authority emails into the report. The existing `scripts/verify-macos-release.sh` additionally requires Developer ID, notarization, and stapled artifacts; record it as not applicable to a local Development-signed candidate, not as passed. Notarization/update-delivery qualification stays outside this local repair until explicitly requested.

## Dependencies, remaining decisions, and stop rules

- No product/visual decision remains. The contextual Fetch list choice is preserved from the earlier user-selected scope.
- T1's independent Electron distribution is a technical feasibility dependency, not an already proven implementation. The packaging owner/main agent resolves it under the bounded gate. If it is unavailable, deliver T2 and the exact blocker without calling the full repair complete or silently substituting a binary patch.
- Native clean-state environment, a real LAN fixture, GUI launch, and human Allow/Deny responses are execution dependencies. If unavailable, keep those checks explicitly not run; isolated automated work continues. A new OS account/VM and any access to the user's existing real provider require concrete authorization.
- Follow root `AGENTS.md` over delivery-document workflow drift: no primary-checkout development, no temporary local-main integration, no implicit commit, no `verify:ui:*`, no production-instance testing. Report contradictory delivery checklist wording rather than applying it.
- Before any authorized PR work, fetch, incorporate latest `origin/main` in this task worktree, prove ancestry, and run `pnpm check:pr-base`; validate the PR integration candidate separately. None of commit/push/PR/merge/publish is authorized by this planning request.
- Do not modify TCC/network privacy databases, run a global privacy reset, rewrite installed Mach-O UUIDs, disable security boundaries, share official/Plus data roots, or retry unchanged failures blindly. Rollback is a source/candidate build rollback; replacing installed apps is a separate action. Preserve this plan and update its execution record under the same T1/T2/T3 IDs.

## Planning delivery record

Completed in this turn: skill/full handoff reads, clean-workspace and fetched-base checks, isolated plan branch/worktree creation, parallel read-only packaging and permission-path investigations, and this saved plan. The file was read back in full. `node docs/scripts/check-docs.mjs` passed (527 pages; existing optional ADR-section notes only). `git diff --check` reported no tracked-diff errors; the plan itself is untracked. Earlier bundle/signature/UUID and Apple documentation inspection in this conversation supplied the baseline. No business source, application bundle, profile, database, privacy setting, or dependency environment was changed. No build, automated regression suite, native UI, real LAN request, signing, notarization, commit, or publication was performed for this repair.

## Implementation execution record (2026-09-30, T1–T3)

Worktree: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktrees/macos-local-network-repair-t1-t3`,
branch `codex/macos-local-network-repair-t1-t3`, created from refreshed `origin/main`
(`aef7aad669bb12357d58d899516aeec5473e40e4`). The primary checkout stayed on `main`.
Environment: Node v22.23.2, pnpm 10.34.5. The fresh worktree had no `node_modules`, so
dependencies were installed from the existing pnpm store
(`pnpm install --offline --frozen-lockfile`, 6 s, no network fetch) and the Electron
43.6.0 darwin-arm64 binary was extracted from the existing download cache
(`node apps/desktop/node_modules/electron/install.js`, under 1 s). No second dependency
environment was created.

### T1 — 实现中

Delivered: `scripts/macos-executable-identity.mjs` (read-only verifier),
`apps/desktop/test/macos-executable-identity.test.mjs` (27 tests, all pass), and
`2026-09-30-macos-local-network-repair-t1-feasibility-probe.md` (**BLOCKED**). The
probe's precise blocker: no Electron/Chromium source checkout exists on this host and
the GN/Ninja toolchain is absent (`gn --version` cannot run); the packaging half
additionally needs an `electronDist` entry this fork does not declare. Disk (114 GiB
free) and `codesign`/`dwarfdump` are not blockers. No Electron source build was
attempted, no bundle was modified, no packaging entry point changed.

### T2 — 实现中

Delivered: `apps/desktop/electron/main/local-network-permission.ts` (controller),
`apps/desktop/test/local-network-permission.test.mjs` (19 tests), the optional
`intent?: "manual-fetch-list"` field end to end (`src/lib/api.ts`,
`useProviderModels.reload()` only, the `ipc/provider-ipc.ts` handler), one controller
created in `ipc/register.ts` and disposed on application shutdown,
`apps/desktop/test/provider-manual-intent-handler.test.mjs` (9 tests), and the
`provider-api-style` fixture scenarios `en:`/`zh-CN:fetch-list-manual-intent-lan-fixture`.
`main/index.ts` has no diff. No `packages/shared` export, Rust/Host RPC, Plugin SDK,
database or migration change.

### T3 — 实现中

Automated layer delivered: `scripts/e2e/local-network-manual-discovery.ts` plus
`scripts/e2e-local-network-manual-discovery.mjs` and the
`test:e2e:local-network-manual-discovery` script — a real Electron main process with
the real registered provider IPC handler, a real loopback HTTP `/v1/models` fixture, a
real `ipcMain`/`ipcRenderer` round trip and the real default-session proxy route, with
only the UDP socket and the address lookup injected. Observed: manual intent → route
query → trigger verdict → HTTP discovery in that order; automatic, `refresh`, legacy
string and cache shapes never query a route or open a socket; loopback skips as
`address-not-local`; this host's real route for a ULA literal skips as `proxied-route`
with no socket; an injected direct route connects once, removes its listener and closes
its socket before the fetch; diagnostics carry stage/reason/code only; a disposed
controller starts nothing while discovery still answers. Recorded in
`docs/spec/06-delivery/04-e2e-test-plan.md` as `E2E-MAC-local-network-manual-discovery`
with traceability, in `docs/spec/03-runtime/12-provider-config-schema.md` §12, and in
ADR 0308.

#### T3 native items that are NOT run (no authorization, no clean environment)

Every item below is **not run** in this turn, and none may be inferred from a UDP
callback, a terminal `curl`, historical logs or an older build:

1. the native macOS alert naming Pi-Desktop-Plus;
2. the separate System Settings → Privacy & Security → Local Network entry;
3. a real LAN HTTP `/v1/models` response;
4. rendered `lan-fixture` rows from that real response;
5. the Deny path and its no-re-prompt behavior;
6. retention of the choice across restart.

Reason: this task has no authorization to create an isolated macOS account or a VM
snapshot, and no clean GUI session with no prior Local Network choice for this
application was made available. Prerequisites for a later run: a clean environment with
no prior choice for Plus, the independently identified signed candidate from T1's route,
an isolated Plus profile, a Finder/LaunchServices frontmost launch, a human answering
Allow/Deny, and an operator-authorized LAN fixture whose `/v1/models` returns an
OpenAI-style list. `scripts/verify-macos-release.sh` is **not applicable** to a local
Development candidate; it was not run and must not be recorded as passing.

### Commands actually run in this turn

```text
git fetch origin main                              -> origin/main aef7aad669bb12357d58d899516aeec5473e40e4
pnpm install --offline --frozen-lockfile           -> done in 6s (store reuse)
pnpm build:js                                      -> passed
pnpm --filter @pi-desktop/desktop typecheck         -> passed, no diagnostics
pnpm lint                                           -> passed (biome + style tokens)
node --test <7 existing + 3 new test files>         -> 115 pass, 0 fail
node --test test/*.test.mjs (whole desktop suite)   -> 2959 tests, 2958 pass, 1 skipped, 0 fail
pnpm test:e2e:provider-api-style                    -> {"ok":true}, 24 scenarios
pnpm test:e2e:local-network-manual-discovery        -> {"ok":true}
node docs/scripts/check-docs.mjs                    -> 528 pages verified
git diff --check                                    -> no errors
```

`pnpm --filter @pi-desktop/shared test` was not required: `packages/shared` has no diff.

### Regression baseline and mapping

`apps/desktop/test/provider-manual-intent-handler.test.mjs` was written first against the
frozen contract and failed on the pre-fix tree (5 pass / 4 fail: the manual request did
not reach the trigger and no diagnostic was emitted), then passed 9/9 after the
implementation. Observable path → test: the renderer Fetch list control → the
`provider-api-style` fixture scenarios; manual intent → the handler test and the shared
hook; trigger order, cleanup and disposal → the Electron IPC smoke and the controller
test; address/proxy/budget/coalescing policy → the controller test; identity
qualification → the verifier test; the native alert and real LAN HTTP → not run.

## Implementation execution record (2026-10-01: T1 completed by relinking the main executable)

Status: T1 **实现中 → 已达成身份目标** (the identity gate passes on a built candidate), T2 **实现中** unchanged, T3 native evidence **obtained**. The repair moves to **待体验**: the applicable validation ran and passed on this machine. **已验收** still needs the operator's explicit confirmation.

### What changed since the 2026-09-30 record

The source-build route stayed blocked here (no Electron checkout; the Chromium infrastructure
measured about 2 B/s from this host), so the operator authorized the offline route: link the main
executable ourselves and reuse everything else from the pinned official distribution.

- `apps/desktop/build/electron-main-stub.c` reproduces upstream `main()` for the macOS browser
  process at tag `v43.6.0` (`ElectronMain`, the `ELECTRON_RUN_AS_NODE` path, `FixStdioStreams`) and
  documents its two deliberate deviations from upstream.
- `scripts/assemble-electron-dist.mjs` compiles that stub against the pinned official framework,
  refuses to continue when the linked UUID still equals the official one, and assembles a
  distribution whose every other file stays verbatim (`version` still 43.6.0).
- `scripts/macos-identity-gate.mjs` is the `afterPack` gate: it fails the build on a shared main
  executable UUID, on a wrong application id or usage description, and on a missing host sidecar.
- `scripts/package-macos-identity.mjs` is the macOS lanes' packaging entry: it assembles (or takes
  `PI_ELECTRON_DIST`), passes `-c.electronDist` and `-c.afterPack`, drops the `--` separator pnpm
  forwards, and re-verifies the packaged bundles afterwards.
- Wired into `pack`, `dist:mac`, the macOS branch of `build-desktop-release.mjs` (so `dist` is
  covered) and `release-macos.sh` (which now requires a distribution). Windows and Linux lanes are
  untouched; `window-menu.test.mjs` recognizes the new packaging entry.
- ADR 0308 and `docs/spec/06-delivery/06-release-runbook.md` record the decision, the measurements
  and the packaging instructions.

### Measured evidence

Controlled comparison on one machine with the same unsigned packaging lane, so the main executable
UUID is the only changed variable:

| Observation | Shared UUID (before) | Relinked UUID (after) |
| --- | --- | --- |
| Local Network prompt | never shown | shown, and the operator granted it |
| System Settings → Local Network | `PI-Desktop` only | `Pi-Desktop-Plus` present |
| LAN request to the local gateway | 29 of 29 `net::ERR_ADDRESS_UNREACHABLE` | real HTTP response (`401`: reachable, not discovery success) |

Two packaging hazards were found here and are now guarded:

1. electron-builder only warns when an `extraResources` source does not exist and still finishes,
   which shipped a `host unavailable` build. The gate fails such a build.
2. A bare `--` forwarded by `pnpm run <script> -- <args>` made electron-builder ignore every flag
   after it, silently packaging the stock distribution. The wrapper drops it and re-verifies the
   packaged UUIDs.

### Validation run in this turn

```text
node --test apps/desktop/test/window-menu.test.mjs        -> 10 pass, 0 fail
node --test test/*.test.mjs (whole desktop suite)         -> 2959 tests, 2958 pass, 1 skipped, 0 fail
node --test <the 10 required files>                       -> 115 pass, 0 fail
pnpm lint                                                  -> passed
node docs/scripts/check-docs.mjs                           -> 528 pages verified
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @pi-desktop/desktop dist:mac -- --arm64
  -> exit 0; "using custom unpacked Electron distribution";
     [identity-gate] candidate main executable UUID independent of input; host sidecar present;
     [package-macos] verified 2 packaged bundle(s) carry an independent main executable UUID
```

Not run: the Developer ID + notarized release lane (no certificate on this host, and
`verify-macos-release.sh` requires Developer ID and stapling) and the x64 slice (arm64 host). The
Apple Development lane is intermittently unusable here: three of four attempts failed inside code
signing with `A timestamp was expected but was not found` at a different nested file each time,
while signing that same file in isolation succeeds and carries a timestamp — a timestamp-authority
throttling condition of this machine, not of the change. One signed build did complete, and it is
the one that exposed the silent `--` fallback; the corrected lane was therefore validated unsigned.

### Signing unblocked (2026-10-01, same day)

The Apple Development lane had been unusable here (four of five builds aborted inside code signing).
Two independent causes were found and fixed; both are recorded in ADR 0308.

1. `codesign --timestamp` loses its token mid-build on this host. Measured directly: twenty-five
   consecutive signings of the same file with the same flags produced one failure, at request 24,
   while isolated signings always succeed and carry a real timestamp. Local lanes now pass
   `-c.mac.timestamp=none`; the release lane keeps the secure timestamp because notarization
   requires it, and `PI_MAC_SECURE_TIMESTAMP=1` restores it on demand.
2. The assembler copied the official distribution with `fs.cpSync`, which rewrote the framework's
   relative symlinks (`Electron Framework -> Versions/Current/Electron Framework`) into absolute
   links pointing back into the package store. codesign then refused the bundle with
   `unsealed contents present in the bundle root`. The copy now uses `ditto` and asserts that the
   root links stay relative.

With both fixed the signed lane completes in about 46 seconds and the candidate passes the identity
gate outright:

```text
candidate  qualified-independent  cn.sakura.pi-desktop  AFD9AFCA-8E20-4B0E-837B-6B9A54A02EF6  apple-development (verified)
qualified independent identity: yes        (verifier exit 0)
```

Artifact: `apps/desktop/release/Pi-Desktop-Plus-0.15.6-arm64.dmg`, checksum verified, host sidecar
present, sha256 `737f281831ce22ad447c7293923db2106c90d56d8cd9a3ccb5deff60dd103ef6`. It is signed
Apple Development **without** a secure timestamp, so it is not a notarization candidate; the release
lane and CI own notarized publication.

Validation in this turn: the new `macos-identity-packaging.test.mjs` (7 pass), the whole desktop
suite (2966 tests, 2965 pass, 1 skipped, 0 fail), `pnpm lint`, and `check-docs` (528 pages).

Note for a future build: each assembly links a new main executable, so every build carries a fresh
UUID. macOS therefore treats each successive build as a new identity and asks for Local Network
access again — expected behaviour, not a regression.
