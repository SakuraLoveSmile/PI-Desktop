# PI-REL-01522: Publish the 0.15.22 unsigned macOS release

- Project: `fork-pi-desktop`; task ID: `PI-REL-01522`; tier: T2 (release);
  status: 已验收 (published; the user accepted it on 2026-11-26 and asked for this
  record to land).
- Created: 2026-11-23 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: on 2026-11-23, while PR #102 (PI-UI-1124) was open, the user
  wrote `合并吧 推送新版本`. That covers the merge of PR #102 and the
  publication of a new version; the chain recorded below ran under that word.
  Only the user grants `已验收`. Installer packages are built only on
  GitHub-hosted runners (AGENTS.md), and the assets below come from that run.
- Baseline: `5c3745c09ce3221b541c0c411eb2d339b9dee63c` (merge of PR #102 into
  remote `main`, 2026-11-23T06:02:23Z).
- Branch: `chore/20261123-pi-rel-01522-release-prep` (merged; the local branch
  is deleted, the remote branch is kept).
- Worktree: the preparation worktree, named per R4
  (`20261123-chore-pi-rel-01522-release-prep` under the central worktree
  root); removed after publication.
- Preparation PR: [#103](https://github.com/SakuraLoveSmile/PI-Desktop/pull/103),
  head `1478b340f`, merged with a merge commit as
  `a25659cea625c190b66641290148256623b513a9` on 2026-11-23T06:35:34Z. That
  commit is the release source; its tree (`8ca0ba6a7043`) equals the tree of the
  PR head.
- Release: [v0.15.22](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.22),
  published 2026-11-23T06:50:18Z as Latest from the same source commit. The
  annotated tag peels to the source commit. It was created at 06:36:02Z, which
  is also the API's `created_at` (a tag time, not a draft time); the publish step
  created the draft, verified the assets and published between 06:50:01Z and
  06:50:18Z.
- Release run: [45125223612](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45125223612),
  attempt 1, all seven jobs successful.
- Candidate runs (unpublished, `workflow_dispatch` on the preparation branch):
  [45122249598](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45122249598)
  on `f200bd9f8`, superseded by the second preparation commit and not relied on;
  [45123660532](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45123660532)
  on `1478b340f`, the exact merged tree.
- Target: remote `main`, tag `v0.15.22`, and the cloud release workflow.
- Closeout: this record and the status lines of PI-UI-1119, PI-UI-1121,
  PI-UI-1122 and PI-UI-1124 land in one docs-only (T0) change on
  `docs/20261123-pi-rel-01522-closeout`.

## Scope and frozen decisions

Publish the next patch release after 0.15.21 (tag `v0.15.21` on
`8c6c9a728a0c4c44f5cf02940fdcb32b168a71c1`, published 2026-11-18T09:14:57Z). The
first-parent history from that tag to `v0.15.22` is exactly these five merges
(`git log --first-parent v0.15.21..v0.15.22`):

| PR | Record | Merge commit | What ships |
| --- | --- | --- | --- |
| [#99](https://github.com/SakuraLoveSmile/PI-Desktop/pull/99) | [PI-UI-1119](pi-ui-1119-topbar-toggle-overlap.md) | `64af9ac0d` (2026-11-19) | The conversation title bar's actions stay clear of the work-panel toggle in every animation frame. Renderer CSS, T1. |
| [#100](https://github.com/SakuraLoveSmile/PI-Desktop/pull/100) | [PI-UI-1122](pi-ui-1122-chat-image-copy.md) | `3a709f373` (2026-11-19) | Copy and download chat images from the image itself and from the generated-image viewer. Renderer, no new IPC, T1. |
| [#101](https://github.com/SakuraLoveSmile/PI-Desktop/pull/101) | [PI-UI-1121](pi-ui-1121-activity-rail-sections.md) | `ed162b47d` (2026-11-22) | The activity rail as sections with one hairline and a chosen order, environment, context and changes rows, MCP state rows with Reconnect, and a Servers section. T1, except Batch C (T2): an additive, optional, live-only `address` field on the Host's `backgroundProcesses.list` rows, derived from untrusted process output (ADR `session-activity-server-address`, D647). |
| [#102](https://github.com/SakuraLoveSmile/PI-Desktop/pull/102) | [PI-UI-1124](pi-ui-1124-activity-rail-canvas-details.md) | `5c3745c09` (2026-11-23) | Small activity-rail details aligned with the approved canvas (D650). Renderer, T1. |
| [#103](https://github.com/SakuraLoveSmile/PI-Desktop/pull/103) | this record | `a25659cea` (2026-11-23) | Release preparation: version surfaces, the 0.15.22 notes and the README paragraphs. |

The Host change is additive. Per [PI-UI-1121](pi-ui-1121-activity-rail-sections.md)
protocol 11 and the IPC stay unchanged and the value is never stored. The release
diff changes four Host files (`background_address.rs`, `background_processes.rs`,
`main.rs` and the RPC test file `rpc/background_processes_tests.rs`), no
migration and not `db.rs`, and the version bump touches only the `version` fields
of the manifests, `Cargo.toml` and `Cargo.lock`. PI-UI-1123 (the pinned session
summary, Batch D) and PI-BG-1122 (background server lifetime) are not merged and
are not part of this release.

The unsigned personal-use lane applies: the publish job ran with
`ALLOW_UNSIGNED_MACOS_RELEASE: true` (workflow log), and `release-manifest.json`
records `signedMacos: false` (read on 2026-11-23 before this closeout; not read
again here). Ad-hoc signing only, no notarization.

The 0.15.22 notes carry three highlights in each of the nine shipped locales: the
reorderable activity sections, the Servers section with the smaller panel
details, and image copy and download with the title-bar spacing fix. English and
Simplified Chinese are authored. Under the maintainer rule from 2026-11-23 (only
English and Simplified Chinese are authored), zh-TW, tr, de, es, fr, ko and
pt-BR repeat the English highlights; this exists only to satisfy the release
gate, which needs every locale to list the version with the same number of
highlights (commit `1478b340f`, `chore(release): carry the English 0.15.22 notes
in the locales without a reviewer`). Comparing the nine entries on `main` shows
those seven identical to the English one. `README.md` and `README.zh-CN.md` each
gain a 0.15.22 paragraph above the 0.15.21 one; the release line stays `0.15.x`.
The changelog date 2026-11-23 is the publication date.

## Implementation and acceptance

| Step | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| T1 | Add the 0.15.22 entries to `packages/shared/src/plus-changelog.ts` for every shipped locale with the same version and three highlights each; update `changelog.test.ts` and `plus-changelog.test.ts`; add the README paragraphs. | Shared changelog tests and `node scripts/check-release-docs.mjs 0.15.22` pass. | 完成 |
| T2 | Run `node scripts/release.mjs 0.15.22` to align root/docs/apps versions, the Cargo workspace and lock, and `APP_VERSION`. | Every version surface reports 0.15.22. | 完成 |
| T3 | Commit, push and open the preparation PR; pass all hosted checks. | PR checks green; the head contains the latest `origin/main`. | 完成 |
| T4 | Dispatch `release.yml` on the preparation branch for unpublished candidate bundles. | Run URL, source SHA and every job conclusion recorded. | 完成 |
| T5 | Merge the preparation PR into remote `main` (merge commit). | Merge commit present in remote `main`. | 完成 |
| T6 | Tag `v0.15.22` on the merged commit, push only that tag, and let `.github/workflows/release.yml` build and publish. | Tag resolves to the merged source; all workflow jobs pass; GitHub Release `v0.15.22` publishes the verified assets with `signedMacos: false`. | 完成 |
| T7 | Verify the published release, retire the preparation worktree and local branch, and record the evidence (this record, in the closeout change). | Remote release identity matches the merged source; cleanup reported separately from publication. | 完成 |

`已验收` after installing the published build stays the user's; until then the
release and this record stay at 待体验.

T7 verified the release through the GitHub API (release flags and target, and the
state, size and sha256 digest of each of the seven assets), the annotated tag,
the conclusions of the release and candidate runs, and the publish step. That
step, `scripts/publish-release.mjs`, creates a draft, checks the state, size and
digest of every remote asset against the verified bundle, and only then
publishes; it succeeded. `release-manifest.json` and `SHA256SUMS` were read on
2026-11-23 before this closeout, and the GitHub digests were found equal to
both; the closeout did not download either file again.

| Asset | Size in bytes | GitHub sha256 digest |
| --- | --- | --- |
| `Pi-Desktop-Plus-0.15.22-arm64.dmg` | 138976177 | `eb65053d4ef89c814900e2b2a0a00c883ba9e2f65555c6fe07f4c08b869598ec` |
| `Pi-Desktop-Plus-0.15.22-arm64.dmg.blockmap` | 145940 | `2df18a5201bc951a76fd9476bb6d0d4bbf15940825390802547b11d9d0eb7fd6` |
| `Pi-Desktop-Plus-0.15.22-arm64-mac.zip` | 136558033 | `1d3d1884e3462535c762bc8ee8452eb9a356c449c5f972a3d7c077ce7dae7988` |
| `Pi-Desktop-Plus-0.15.22-arm64-mac.zip.blockmap` | 143776 | `0a58ae4e5cfcf7c9a85d4c353fed83f0c564b745039073cedc70360e3b34a71f` |
| `latest-mac.yml` | 638 | `b6fa5381d434d92b3693f0cc7340ed42ffaaff6c72783cc43422e30379fc2692` |
| `release-manifest.json` | 1264 | `b57379cc5e33cf5c11d5caaa252fc2cb4f7e8f40de32c2b48e442197008ce459` |
| `SHA256SUMS` | 595 | `e29223257782f4bb7e2bba138e7080ee7ed32d69555c3b9af7eb64e7fcb69e6d` |

## Hosted evidence

Read from GitHub on 2026-11-23.

| Revision | Where | Run | Result |
| --- | --- | --- | --- |
| `1478b340f` (PR #103 head) | `pull_request` | PR checks | Five checks `success`: Docs checks; Head contains latest base; Isolated launch / message / approval / restart smoke / fixture; JS build / typecheck / lint / architecture / test; Rust host-core format / lint / test. |
| `f200bd9f8` | `workflow_dispatch` candidate | [45122249598](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45122249598) (06:09:33Z to 06:21:33Z) | The six verification and build jobs `success`; Publish skipped. Superseded; not relied on. |
| `1478b340f` | `workflow_dispatch` candidate | [45123660532](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45123660532) (06:22:29Z to 06:34:32Z) | Validate source, version and signing requirements; Rust host-core; JS build; isolated launch smoke; Build macOS arm64; Verify macOS arm64 installer bundle all `success`; Publish skipped. |
| `a25659cea` (tag `v0.15.22`) | `push` | Release run [45125223612](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/45125223612), attempt 1 (06:36:19Z to 06:50:21Z) | The same seven jobs, with Publish verified GitHub Release `success`. |
| `a25659cea` | `push` to `main` | CI and Docs check | Both `success`. |

Preparation checks run locally by the preparation session, as recorded in the
PR #103 description: `node scripts/check-release-docs.mjs 0.15.22` aligned
(re-run after the English-fallback commit); `changelog.test.ts` and
`plus-changelog.test.ts` 28 passed; `tsc -p packages/shared/tsconfig.json
--noEmit` clean; `node scripts/check-pr-base-main.mjs` found `origin/main` an
ancestor. NOT RUN locally by that session: `pnpm typecheck` and `pnpm lint`
(pnpm is never run in an overlay worktree; hosted CI runs both) and Electron E2E
(the preparation changes no code path).

## NOT checked for this release

- Nobody installed the ZIP or the DMG, so the packaged app was not launched on a
  real Mac and an in-app update from an installed 0.15.21 was not tried.
- The published bundle bytes were not downloaded again or hashed locally; only
  the GitHub digests above and the hosted verification stand for them.
- No hosted E2E suite ran on the release: the only runs on `a25659cea` are the
  tag's Release run and the `push` runs of CI and Docs check on `main`, so no
  `e2e-run.yml` family was dispatched. The isolated launch / message / approval /
  restart smoke inside CI and the release run is the only end-to-end style check.
- No run against a real model or provider.
- Each feature's own NOT RUN list stays in its record
  ([PI-UI-1121](pi-ui-1121-activity-rail-sections.md),
  [PI-UI-1124](pi-ui-1124-activity-rail-canvas-details.md),
  [PI-UI-1119](pi-ui-1119-topbar-toggle-overlap.md),
  [PI-UI-1122](pi-ui-1122-chat-image-copy.md)); the Servers section in
  particular was not run end to end with a production Host and a real dev server.

## Residual risks

- The unsigned lane stays unqualified for Gatekeeper and notarization, as
  recorded since 0.15.14.
- GitHub's own `immutable` flag is false on this release (it is also false on
  v0.15.19 and v0.15.21). The runbook's "immutable release" means the workflow
  never overwrites published assets: `scripts/publish-release.mjs` refuses to
  touch a published release, and the runbook's recovery section (4.4, Recover a
  failed publication) covers only a publish job that failed after creating a
  draft or uploading assets. Do not replace uploads or move the tag.
- A bundle run from the release uses the same data directory
  (`~/.pi-desktop-plus`) as an installed app, so quit the installed app first.
  This release changes no schema or migration.

## Runtime resources

Nothing here needs a local process; the runs live on GitHub. Cleanup, checked on
2026-11-23: the preparation worktree and the local branch
`chore/20261123-pi-rel-01522-release-prep` are removed (`git worktree list` and
`git branch --list` show neither); primary `main` is at `a25659cea`, equal to
`origin/main`. The remote branches `chore/20261123-pi-rel-01522-release-prep`,
`feat/20261121-pi-ui-1121-activity-rail-sections` and
`fix/20261123-pi-ui-1124-activity-rail-canvas-details` are kept; deleting remote
branches is outside this record.
