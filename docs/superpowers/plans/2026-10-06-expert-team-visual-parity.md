# Expert Team Visual Parity Plan

Status: locally validated; awaiting user acceptance. Revision: `team-visual-v1`, 2026-10-06, Asia/Taipei.

## Integration baseline — 2026-10-06

- Base: `origin/main` = `97388c1713aa5453de0b4b8012ac08dec3367038`.
- Plan branch: `docs/expert-team-visual-parity-plan` (this file + reference images only).
- Reference images (2x retina captures supplied by the user):
  `docs/superpowers/plans/assets/expert-team-visual-parity/references/reference-01.png` … `reference-06.png`.
- Related plan: `2026-09-30-expert-team-ux-reliability.md` (`team-ux-v3`). Relationship: §1.4.
- Implementation branch: `feat/expert-team-visual-parity`, worktree
  `../PI-Desktop-worktrees/expert-team-visual-parity` (relative to the primary checkout), created from `origin/main`.

---

## 0. How to use this plan (read before touching code)

### 0.1 Roles

| Role | Owns | Never does |
| --- | --- | --- |
| Integrator | worktree, WP order, deviation log, final E2E, report to the user | push / PR / merge without an explicit user request |
| Executor | exactly one WP at a time, one commit per WP, executor report (§0.7) | edit files outside the WP's allowed list, start the next WP, touch other worktrees |
| Reviewer | checks each WP commit against its "Done when" list, diff rules and §3 | approve with an open STOP or an unlogged deviation |

Reviewer fixes are applied by the executor with `git commit --amend` while the commit is still private and unpushed. WPs run sequentially in the single task worktree; never run two executors in the same worktree.

### 0.2 Precedence

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/spec/**`, except the sections this plan rewrites (§7)
4. this plan
5. kept parts of `team-ux-v3` (§1.4)
6. reference images

If an image conflicts with accessibility or a higher-precedence source, follow the higher source and log a deviation (S7).

### 0.3 Interpretation

- Symbols (component, function, class, testid, i18n key, test name) are authoritative. Line numbers (`L123`) are hints from baseline `97388c171` only; re-locate by symbol.
- Measurements are CSS px at 1x. Reference images are 2x; divide image pixels by 2. `≈` means ±2 CSS px.
- MUST = required. SHOULD = required unless a deviation is logged with evidence. MAY = optional.
- Strings in `code` that are class names, testids, i18n keys/values, commit subjects or CSS declarations are used verbatim.
- A file that is not in the WP's "Allowed files" MUST NOT be modified (S1). No drive-by cleanup, formatting churn, renames or dependency changes.
- When the plan says "keep", the existing code/markup/test stays byte-for-byte unless the WP explicitly lists the change.

### 0.4 STOP rules

On a STOP: stop editing, do not commit the WP, report evidence (command output, `file:line`) to the integrator. The integrator resolves it or asks the user.

| Rule | Trigger |
| --- | --- |
| S1 | A change would touch a file outside the WP's allowed list |
| S2 | A symbol, token, prop, key, testid or file the plan names is missing or has a different shape |
| S3 | The work would need an IPC, `packages/shared` contract, Rust, agent-runtime, Plugin SDK or schema change |
| S4 | A test unrelated to the WP turns red, or a test listed as "must stay green without edits" fails |
| S5 | A guard (`check-style-tokens`, `check-architecture`, lint, i18n parity) would need loosening |
| S6 | A ratchet budget in §3.2 would be exceeded |
| S7 | A reference image conflicts with accessibility, an existing spec or another WP |
| S8 | `origin/main` changed a file the current WP edits since the WP started |
| S9 | An E2E failure that is not the known flake in §6.3 |
| S10 | The change would delete an i18n key, test, `data-*` attribute or testid not explicitly listed |
| S11 | The change would alter persisted state, settings, or the meaning of stored data |

### 0.5 Deviation log

Every SHOULD not met and every approved STOP resolution goes into the execution record (Appendix H):

| WP | Plan item | What changed | Why | Evidence | Approved by |
| --- | --- | --- | --- | --- | --- |

### 0.6 Pre-flight (integrator, once)

1. Create the worktree:

   ```bash
   git fetch origin main
   git worktree add -b feat/expert-team-visual-parity ../PI-Desktop-worktrees/expert-team-visual-parity origin/main
   ```

2. If this plan file is not on `origin/main`, cherry-pick the plan commit from `docs/expert-team-visual-parity-plan` as the first commit of the task branch.
3. Overlap check, read-only. Run `git worktree list`. For the worktrees named `goal-progress-expert-dispatch`, `team-planning`, `local-mcp-control-toggle`, `plus-mcp-control-f` and `sidebar-composer-skill-discovery` (if present), run `git -C <path> status --short` and `git -C <path> log --oneline origin/main..HEAD`. Compare their touched files with Appendix I. At baseline, `team-planning` touches `TeamDispatchCard.tsx`, `team-dispatch.css` and adds `team.tasksCreated`; `goal-progress-expert-dispatch` has about 25 uncommitted files. Never modify these worktrees. If an overlapping branch has an open PR, ask the user (U2). Default: proceed, and S8 governs refreshes.
4. E2E environment (AGENTS.md "E2E environment reuse"):
   - Reuse the primary checkout's toolchain through a per-worktree `node_modules` overlay. The overlay holds symlinks to the primary's dependencies, with `@pi-desktop/*` links pointing at this worktree's own `packages/*`.
   - Never run `pnpm` or `npm` in the task worktree. Run scripts through the commands they resolve to in the root `package.json`, executed with `node` or `node_modules/.bin/*`. Example: `check:pr-base` → `node scripts/check-pr-base-main.mjs`.
   - To remove the overlay, delete only the symlinks you created, then check that every `.bin` shim in the primary checkout still resolves.
   - Build the host binary from the task worktree with an isolated `CARGO_TARGET_DIR` under `/tmp` (reused across WPs) and pass it with `PI_DESKTOP_HOST_BIN`.
   - Unset `ANTHROPIC_*` and `CLAUDECODE` for E2E. Use temporary profiles only; never `~/.pi-desktop-plus`, real providers or the user's running app.
   - Never stage `.review-evidence` or other E2E artifacts.

### 0.7 Executor report (one per WP)

```text
WP:
Commit: <sha> <subject>
Files: <git show --stat summary>
Checks: <command> -> <result>   (one line each, exact commands)
Evidence: <screenshots/measurements/E2E lines, or NONE>
Deviations: <rows for §0.5, or NONE>
STOPs: <rule + evidence, or NONE>
Questions: <or NONE>
```

### 0.8 Order and commits

`A → B → C → D → E1 → E2 → F1 → F2 → F3 → G`, then an optional `docs(plan): mark expert team visual parity delivered`. One commit per WP, Conventional Commits, subject + blank line + why-body wrapped at about 72 columns, no `Co-Authored-By` or `Signed-off-by`. Stage by explicit path and run `git status` before every commit.

---

## 1. Scope

### 1.1 Goal

Make Expert Team ("专家团") mode match reference-01..06 across six surfaces, while keeping architecture, contracts, data and accessibility intact:

- composer label
- chat dispatch cards and the "expert joining" row
- Work Panel Overview (进展 / 产物 / 引用)
- Team panorama tab
- live task tabs
- live member tabs

### 1.2 Reference inventory (CSS px at 1x)

| Image | Surface | Binding facts |
| --- | --- | --- |
| 01 | Composer | `+`, users icon, label `专家团` with chevron |
| 02 | Dispatch card + joining row | **Card:** outer height ≈61.5, border `--ds-border-default`, fill `--ds-tile`, radius ≈8, padding-inline 12.<br>**Row 1:** avatar 16 at inset 12; identity `调研员 Alex` 13px secondary; status `等待中` 13px muted, right-aligned at inset ≈12. Row-1 centre ≈19.5 below the inner top.<br>**Row 2:** L-connector whose vertical stroke sits under the avatar centre (≈20 from the inner left); title 14px semibold primary starting ≈34.5 from the inner left. Row-2 centre ≈42.5.<br>**Joining row:** flag 16 at the card's outer left edge; `新专家加入中…` 13px muted; its centre is ≈23 below the card bottom. |
| 03 | Card group | 3 cards stacked, gap ≈12 |
| 04 | Overview | **Section headers:** 48 tall, 14px normal secondary, separated by 1px dashed `--ds-border-default`, right-hand 16px chevron, left inset 12.<br>**`进展` header:** link `在专家团全景图查看` 13px secondary + arrow 16, then a 1px divider, then the chevron.<br>**Group:** `Ad-hocs 3 ⌄` in 13px muted.<br>**Task row:** 50 tall. 16px state glyph, then the title at x+28 (`Ad-hoc: <subject>`, 14px secondary). Identity row (avatar 12 + `调研员` 13px muted) under the title, 22 below it.<br>**Empty copy:** `暂无产物` 13px muted. |
| 05 | Panorama tab | **Tab:** `专家团全景图`, users icon.<br>**Toolbar** (top-right): zoom out, `82%`, zoom in, divider, fit, reset.<br>**Canvas:** dotted.<br>**Nodes:** 276×86 with a 32 avatar; root `Lead Agent` / `协调专家任务`, loader glyph, green `进行中`. Root→child gap 64, row gap 96, column gap ≈42, 2 columns. |
| 06 | Task tab | **Header:** ≈60 tall, 1px bottom border `--ds-border-default`. Row 1: identity 13px secondary, status `进行中` primary with a muted loader glyph. Row 2: L-connector + title ≈15px semibold primary.<br>**Body:** inset 16; thinking row `深度思考 · 2s`, answer text, tool rows.<br>**Tab strip:** overview / terminal / copy are icon-only; the panorama tab has users icon + label; the active task tab has a message-circle icon + `Ad-hoc: …`. |

### 1.3 Defects found at baseline

| ID | Defect (baseline evidence) |
| --- | --- |
| D1 | **Stale card state.** `TeamDispatchCard` shows `card.task.status` parsed from tool calls, so it never reflects later status changes. Its identity format also differs from Overview/panorama. |
| D2 | **Two click targets.** The card has an expert button and a title button (reference: one target). |
| D3 | **No joining feedback.** Nothing shows while `spawn_teammate` is running. |
| D4 | **Overview chrome.** Overview sections use solid dividers, bold 13px summaries and native markers; team progress shows a `.team-progress-count` disclosure and a numbered list. |
| D5 | **Panorama look.** Panorama nodes are 304×140 in up to 3 columns; the toolbar uses text buttons; the running colour is accent. |
| D6 | **Panorama placement.** The panorama renders inside `TeamPanel` rather than as its own tab. Every team target reuses tab id `team:<id>`, so a card click repurposes the aggregate tab. |
| D7 | **Wrong first frame.** `TeamPanel` `useState(() => requestedView(initialTaskId, initialView))` passes `initialView` into the `initialMemberSessionId` slot. |
| D8 | **Wrong tab tooltip.** The team tab hover title shows `tab.resource` (a session id). |
| D9 | **Member transcript gaps.**<ul><li>drops role `"tool"` rows and thinking</li><li>no live refresh</li><li>unbounded `api.getSession(id)` read</li><li>renders `ReviewChangeCard`, whose rollback targets `state.activeSessionId` (the lead), not the member</li></ul> |
| D10 | **Copy gaps.** `team.memberDetail`, `team.taskDetail`, `team.back`, `team.transcript` and `team.openInMain` are English placeholders in 7 locales; `team.lead` is "Lead". |
| D11 | **Inconsistent product name.** zh copy says `专家团队`; the reference says `专家团`. |
| D12 | **Wrong focus task.** Panorama child focus task falls back to `memberTasks[0]` and ignores name-only ownership. |

### 1.4 Relation to `team-ux-v3`

- Superseded by this plan:
  - C3 Lead copy
  - C4 rows "Team Overview" and "Panorama"
  - C5.6 (member detail inside `TeamPanel` as the primary member surface)
- Kept:
  - C1, C2
  - C5.1–C5.5
  - C6, C7
  - C4 rows Queue / Board / Sidebar / Overview metadata

Executors do not reopen `team-ux-v3` items.

---

## 2. Decisions

### 2.1 Binding decisions

- **V1 Renderer-only.** No IPC, `packages/shared` contract, Rust, agent-runtime, Plugin SDK or schema change, so no ADR.
- **V2 Snapshot wins.** The team snapshot is the source of truth for status/identity. `card.task` is only a fallback.
- **V3 Tab ids.** Team tab ids are built only by `teamWorkPanelTabId`. Code routes by `tab.teamTarget` and never parses tab ids.
- **V4 One card target.** A dispatch card has one target, which opens the task tab.
- **V5 Shared state vocabulary.** Status text comes from `taskStateLabelKey`; state icons come from `TaskStateGlyph`.
- **V6 Panorama grid.** The panorama uses a 2-column 276×86 grid. Fit/reset/zoom math is unchanged.
- **V7 Tokens only.** Use existing tokens; correct in light and dark themes.
- **V8 Accessibility first.** Keep focus rings, accessible names, and targets ≥ 24×24.
- **V9 Shared panorama.** `AgentPanorama` is shared, so the subagent panorama gets the same restyle.
- **V10 Member transcripts.** Read-only, bounded (200 messages / 64 KiB content), event-driven, no composer.
- **V11 Copy.** Copy follows §4.6 exactly.

### 2.2 Intentional behaviour changes (must appear in spec + PR description)

1. Card status and identity are live from the snapshot.
2. A card has a single target that opens the task tab; the card's member link is removed.
3. An "expert joining" row appears while `spawn_teammate` runs on the active turn.
4. Overview chrome restyle, for every session:
   - dashed dividers, right-hand chevrons, typography;
   - team progress header and rows restyled;
   - `.team-progress-count` removed;
   - team sessions show status/proposals inside 进展 instead of a separate `panel.overview.progress` section.
5. Panorama: 2-column compact nodes and an icon toolbar, shared with the subagent panorama.
6. The panorama "running" label colour changes from accent to success.
7. Panorama, task and member views open as separate tabs:
   - the in-panel panorama is removed;
   - aggregate progress rows open task tabs.
8. The team tab hover title equals its label.
9. Member transcripts:
   - show tool and thinking rows;
   - refresh live;
   - are bounded, with a truncation notice;
   - no longer render `ReviewChangeCard`.
10. Copy changes (§4.6) and `memberFocusTask` selection.

### 2.3 Accepted deviations from the images

- The Overview metadata header stays (U1).
- Focus rings, aria names and ≥24px targets are added where the image shows none.
- WorkPanel tab chrome is unchanged except team tab icon/label/title.
- Token colours approximate the reference palette.
- Loader glyphs are static (no spin).
- Card status is plain text, not an uppercase badge.
- The task-tab status label is primary.
- With ≥3 members, edges to row-2 children may pass behind opaque row-1 nodes (the reference shows ≤3 members).

### 2.4 Non-goals

- Team runtime or task semantics.
- Composer picker changes beyond copy.
- Per-task transcript filtering.
- A composer in tabs.
- CompactTeamBoard/board chrome (beyond splitting the shared rows rule).
- `SubagentTranscriptTab`.
- Theme tokens.
- A tab-strip redesign.
- Nested delegate grouping in member transcripts.
- Removing `TeamPanel` `initialTaskId` / `initialMemberSessionId`.
- Localising member-tab labels (label = display name).

### 2.5 Open user decisions (defaults apply unless the user says otherwise)

| ID | Question | Default |
| --- | --- | --- |
| U1 | Keep the Overview metadata header that the reference does not show? | Keep |
| U2 | Proceed while `team-planning` has uncommitted overlapping work? | Proceed; S8 on refresh |
| U3 | Also rename `team.title` to 专家团 (not only `chat.profileTeam`)? | Rename both |
| U4 | Remove the card's separate member link (single target)? | Yes |
| U5 | One PR, or split A–B / C–D / E1–F3 / G? | One PR |

---

## 3. Shared rules for every WP

### 3.1 Architecture

- Renderer only.
- Data comes from the existing `useTeamSnapshot`, `api.getSession`, `api.onAgentEvent`, `api.onHostStatus` and `openWorkPanelTabForSession`.
- No new IPC.
- No edits to `apps/desktop/electron/**`, `packages/shared/**` (except changelog data in §6.4), `crates/**` or `packages/agent-*`.

### 3.2 Ratchets and size

| File | Budget |
| --- | --- |
| `apps/desktop/src/components/workpanel/WorkPanel.tsx` (1107 lines) | wiring only, net ≤ +5 lines over the whole plan |
| `apps/desktop/src/components/workpanel/TeamPanel.tsx` (859 lines) | never grows in any WP; ends below 859 |
| `apps/desktop/src/features/chat/transcript/AssistantTurn.tsx` | net ≤ +4 lines |
| `app-store.ts`, `ChatTranscript.tsx`, `Composer.tsx`, `electron/main/index.ts` | untouched |
| new TS/TSX modules | < 500 lines each |

Run `node scripts/check-architecture.mjs --base origin/main` after each commit.

### 3.3 UI primitives

- No new raw `<button>`.
- Use `TooltipButton` (renders a `<button>` with exactly the given `className`) when the plan gives exact CSS. Use `Button` only where the plan says so.
- Button content is phrasing only (`span`, `svg`, `img`); never `div`, `p` or `section`.
- Decorative icons get `aria-hidden`.
- Icons come only from `apps/desktop/src/components/icons.tsx`.

### 3.4 Style guard

`node scripts/check-style-tokens.mjs` must pass with no guard edit:

- `font-size`, `font-weight`, `line-height`, `letter-spacing` and `border-radius` use `var(--…)` (or `0`, `inherit`, `none`, …).
- No literal surface colours.
- No `rounded-[…]`, `text-[…]`, `leading-[…]`, `tracking-[…]` or `font-[…]` in TSX.
- Circles use `var(--radius-round)`, never `50%`.
- `image-rendering: pixelated` only where it already is.

Tokens this plan names (all verified at baseline):

- Text colours: `--ds-text-primary`, `--ds-text-secondary`, `--ds-text-muted`.
- Borders: `--ds-border-default`, `--ds-border-subtle`, `--ds-border-strong`.
- Surfaces: `--ds-tile`, `--ds-bg-hover`, `--ds-bg-secondary`, `--ds-bg-elevated-opaque`, `--ds-shadow-dialog`.
- Status colours: `--ds-success`, `--ds-error`, `--ds-warning`.
- Radii: `--radius-3xs`, `--radius-2xs`, `--radius-xs`, `--radius-md`, `--radius-round`.
- Font sizes: `--text-sm`, `--text-sm-plus`, `--text-md`, `--text-base`, `--text-base-plus`.
- Font weights: `--font-weight-normal`, `--font-weight-semibold`.
- Line heights: `--leading-tight`, `--leading-normal`.
- Motion: `--motion-duration-fast`, `--motion-ease-out`.

A token not in this list → S2.

### 3.5 i18n

- Every new key goes into all 9 locales (`packages/i18n/src/locales/{en,zh-CN,zh-TW,de,es,fr,ko,pt-BR,tr}/index.ts`), in the same WP, inside the existing `team` block, following each file's quoting style.
- Ellipsis is U+2026 (`…`).
- After editing locales, run the i18n tests and rebuild the dist (§3.7) before any E2E.

### 3.6 Behaviour hygiene

- Never assume state is unchanged across `await`.
- Every listener, timer and subscription is disposed on unmount and on prop change.
- Respect `prefers-reduced-motion`.

### 3.7 Commands

```bash
node --test apps/desktop/test/<file>.test.mjs
node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit
node scripts/check-style-tokens.mjs
node_modules/.bin/biome lint <changed paths>
git diff --check
node scripts/check-architecture.mjs --base origin/main
```

- i18n tests: run `node_modules/.bin/vitest run` inside `packages/i18n`.
- i18n dist: `node_modules/.bin/tsc -p packages/i18n/tsconfig.json`.
- Run `check-architecture` after committing the WP.

---

## 4. Shared contracts

### 4.1 Team tab ids (WP-E2)

| `teamTarget.kind` | Tab id | `label` |
| --- | --- | --- |
| none / `aggregate` / `board` | `team:<teamSessionId>` | none |
| `panorama` | `team:<teamSessionId>:panorama` | none |
| `task` | `team:<teamSessionId>:task:<taskId>` | task subject |
| `member` | `team:<teamSessionId>:member:<memberSessionId>` | member display name |

- `teamWorkPanelTab(teamSessionId, teamTarget?, label?)` keeps `resource = teamSessionId` and the `teamNavigationSeq` increment.
- Tabs are in-memory only, and `isKnownWorkPanelTab` checks kind only, so no migration is needed.

### 4.2 `taskStateLabelKey(state: TaskVisualState): string` (WP-A, `lib/team-presentation.ts`)

- `blocked` → `team.waitingForDependencies`
- any other state → `` `team.taskStatus.${state}` ``

### 4.3 `TaskStateGlyph` (WP-C, `components/workpanel/team/TaskStateGlyph.tsx`)

`<span className="team-task-glyph" data-state={state} aria-hidden="true"><Glyph size={size} /></span>`, with `size?: 12 | 16` (default 16):

| state | Glyph | Colour |
| --- | --- | --- |
| `in_progress` | `IconCircleArrowRight` | `--ds-text-primary` |
| `pending` | `IconCircle` | `--ds-text-muted` |
| `blocked` | `IconCircleDashed` | `--ds-text-muted` |
| `completed` | `IconCircleCheck` | `--ds-success` |
| `failed` | `IconCircleX` | `--ds-error` |
| `cancelled` | `IconCircleSlash` | `--ds-text-muted` |

### 4.4 `memberFocusTask(member, tasks)` (WP-E2, `lib/team-presentation.ts`)

1. Ownership is strict, like `buildTeamTaskRows`: if `task.ownerSessionId` is set, it must equal `member.memberSessionId`; otherwise `task.ownerMemberName` must equal `member.name`.
2. Exclude deleted tasks and sort with the existing creation order (`createdAt`, then `taskId`).
3. Return the first `in_progress` task; else the first `pending`; else the task with the latest `updatedAt`; else `undefined`.

### 4.5 `localizedTeamSnapshotError(error, translate: (key: string) => string): string` (WP-E2, `lib/team-presentation.ts`)

- Move the existing inline `TEAM_DISSOLVED` / `TEAM_SCOPE_MISMATCH` mapping verbatim from `TeamPanel.tsx` and `OverviewTab.tsx`.
- If the two inline copies differ → S2.

### 4.6 i18n tables

New keys:

| Key | WP | en | zh-CN | zh-TW | de | es | fr | ko | pt-BR | tr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `team.expertJoining` | B | New expert joining… | 新专家加入中… | 新專家加入中… | Neuer Experte tritt bei… | Se está uniendo un nuevo experto… | Un nouvel expert rejoint l'équipe… | 새 전문가 합류 중… | Novo especialista entrando… | Yeni uzman katılıyor… |
| `team.adHocTaskTitle` | C | Ad-hoc: {{subject}} | Ad-hoc: {{subject}} | Ad-hoc: {{subject}} | Ad-hoc: {{subject}} | Ad hoc: {{subject}} | Ad hoc : {{subject}} | Ad-hoc: {{subject}} | Ad hoc: {{subject}} | Ad-hoc: {{subject}} |
| `team.adHocGroup` | C | Ad-hocs | Ad-hocs | Ad-hocs | Ad-hoc-Aufgaben | Tareas ad hoc | Tâches ad hoc | Ad-hoc 작업 | Tarefas ad hoc | Ad-hoc görevler |
| `team.teamPanoramaTitle` | E2 | Team panorama | 专家团全景图 | 專家團全景圖 | Team-Panorama | Panorama del equipo | Panorama de l'équipe | 팀 파노라마 | Panorama da equipe | Ekip panoraması |

`team.transcriptTruncated` (WP-F3) copies each locale's `scheduled.transcriptTruncated` value:

| Locale | Value |
| --- | --- |
| en | Earlier messages are hidden. Open the conversation to read the full transcript. |
| zh-CN | 较早的消息未显示，打开会话可查看完整转写。 |
| zh-TW | 較早的訊息未顯示，開啟對話可查看完整逐字稿。 |
| de | Ältere Nachrichten sind ausgeblendet. Öffne den Chat für das vollständige Transkript. |
| es | Los mensajes anteriores están ocultos. Abre la conversación para ver la transcripción completa. |
| fr | Les messages plus anciens sont masqués. Ouvrez la conversation pour la transcription complète. |
| ko | 이전 메시지는 표시되지 않습니다. 대화를 열면 전체 기록을 볼 수 있습니다. |
| pt-BR | As mensagens anteriores estão ocultas. Abra a conversa para ver a transcrição completa. |
| tr | Daha eski mesajlar gizli. Tam döküm için konuşmayı açın. |

If a locale's `scheduled.transcriptTruncated` differs from this table, copy the locale file's value and log it.

Placeholder translations (WP-F3). Replace a value only if it currently equals the en value; otherwise keep it and report:

| Locale | `team.memberDetail` | `team.taskDetail` | `team.back` | `team.transcript` | `team.openInMain` |
| --- | --- | --- | --- | --- | --- |
| zh-TW | 成員詳情 | 任務詳情 | 返回 | 成員對話記錄 | 在主視窗開啟 |
| de | Mitgliedsdetails | Aufgabendetails | Zurück | Transkript des Teammitglieds | Im Hauptfenster öffnen |
| es | Detalles del miembro | Detalles de la tarea | Volver | Transcripción del compañero de equipo | Abrir en la ventana principal |
| fr | Détails du membre | Détails de la tâche | Retour | Transcription du coéquipier | Ouvrir dans la fenêtre principale |
| ko | 팀원 세부 정보 | 작업 세부 정보 | 뒤로 | 팀원 대화 기록 | 메인 창에서 열기 |
| pt-BR | Detalhes do membro | Detalhes da tarefa | Voltar | Transcrição do colega de equipe | Abrir na janela principal |
| tr | Üye ayrıntıları | Görev ayrıntıları | Geri | Ekip arkadaşı dökümü | Ana pencerede aç |

Changed values:

| Key | WP | zh-CN (old → new) | zh-TW (new) | Other locales |
| --- | --- | --- | --- | --- |
| `team.taskStatus.pending` | A | 待处理 → 等待中 | 等待中 | unchanged |
| `team.taskProgress` | C | 任务进度 → 进展 | 進展 | unchanged |
| `panel.overview.noArtifacts` | C | 当前会话暂无产物 → 暂无产物 | unchanged | unchanged |
| `team.lead` | D | 主导 → Lead Agent | Lead Agent | `Lead Agent` in all 9 locales |
| `team.coordinatingExperts` | D | 正在协调专家任务 → 协调专家任务 | 協調專家任務 | unchanged |
| `team.phase.running` | D | 运行中 → 进行中 | 進行中 | unchanged |
| `chat.profileTeam` | G | 专家团队 → 专家团 | 專家團 | unchanged |
| `team.title` | G (U3) | 专家团队 → 专家团 | 專家團 | unchanged |

Untouched:

- `chat.taskProgress`
- `panel.overview.teamSection`
- `panel.tabs.team`
- zh-TW `panel.overview.noArtifacts`
- `team.panoramaTitle`
- `team.viewMemberDetail` / `team.memberDetailUnavailable` (they become unused by the card but are kept; S10)

If an "old" value differs from this table → S2.

### 4.7 CSS ownership

| Styles | File |
| --- | --- |
| dispatch card, joining row | `apps/desktop/src/styles/team-dispatch.css` |
| Overview chrome | `apps/desktop/src/styles/work-panel.css` |
| `TaskStateGlyph`, `TeamTaskProgress` | the `team-panel.css` imported by `TeamPanel.tsx` |
| panorama | `apps/desktop/src/styles/agent-panorama.css` |
| task/member tabs | `apps/desktop/src/styles/team-work-tab.css` (new; imported by `TeamWorkPanelSurface.tsx`) |

---

## 5. Work packages

Paths are relative to the repository root. Abbreviations:

| Short | Path |
| --- | --- |
| `WP/` | `apps/desktop/src/components/workpanel/` |
| `TEAM/` | `apps/desktop/src/components/workpanel/team/` |
| `CHAT/` | `apps/desktop/src/features/chat/transcript/` |
| `LIB/` | `apps/desktop/src/lib/` |
| `STY/` | `apps/desktop/src/styles/` |
| `TEST/` | `apps/desktop/test/` |
| `LOC/` | `packages/i18n/src/locales/*/index.ts` |

### WP-A — Dispatch card parity (fixes D1, D2)

**Depends on:** none.

**Allowed files:**

- `CHAT/TeamDispatchCard.tsx`
- `STY/team-dispatch.css`
- `LIB/team-dispatch.ts`
- `LIB/team-presentation.ts`
- `TEAM/PixelAvatar.tsx`
- `TEST/team-dispatch.test.mjs`
- `TEST/team-presentation.test.mjs`
- `scripts/e2e/goal-team-renderer-ui.tsx`
- zh-CN and zh-TW `LOC/`
- `docs/spec/04-ux/08-component-spec.md` (§10B.5)
- `docs/spec/06-delivery/04-e2e-test-plan.md`

**Steps:**

1. In `LIB/team-presentation.ts`, add `export function taskStateLabelKey` per §4.2.
2. In `LIB/team-dispatch.ts`, add `export function dispatchFallbackState(status: string | undefined): TaskVisualState`. It returns the status when it is one of `pending | in_progress | completed | failed | cancelled`; otherwise `pending`. Type-only import of `TaskVisualState`.
3. In `PixelAvatar.tsx`, widen `size` to `12 | 16 | 20 | 24 | 32 | 48`. Nothing else changes.
4. Rewrite `TeamDispatchCard` to this structure (logic is normative; formatting is free):

   ```tsx
   const liveRow = useMemo(() => snapshot
     ? buildTeamTaskRows(snapshot.tasks, snapshot.members, snapshot.readiness, snapshot.paused)
         .find((row) => row.task.taskId === card.taskId)
     : undefined, [snapshot, card.taskId]);
   const subject = liveRow?.task.subject || card.task.subject || t("team.untitledTask", "Untitled task");
   const state = liveRow?.state ?? dispatchFallbackState(card.task.status);
   const statusLabel = t(taskStateLabelKey(state));
   const owner = liveRow?.owner;
   const identity = owner
     ? `${t(`team.roles.${owner.role}`)} ${owner.displayName}`
     : card.task.ownerMemberName || t("team.unassigned", "Unassigned");
   const avatarSeed = owner?.sessionId || card.task.ownerSessionId || card.task.ownerMemberName || card.taskId;
   // one handler: stopPropagation, session = activeSessionId || teamSessionId,
   // openWorkPanelTabForSession(session, teamWorkPanelTab(teamSessionId, { kind: "task", taskId: card.taskId }))
   return (
     <article className="team-dispatch-card" data-task-id={card.taskId}
       data-team-session-id={teamSessionId} data-state={state} aria-label={subject}>
       <TooltipButton type="button" className="team-dispatch-card-open" tooltip={subject}
         ariaLabel={t("team.openTaskWithStatus", { subject, status: statusLabel })} onClick={handleOpen}>
         <span className="team-dispatch-card-row">
           <PixelAvatar seed={avatarSeed} size={16} />
           <span className="team-dispatch-identity">{identity}</span>
           <span className="team-dispatch-status">{statusLabel}</span>
         </span>
         <span className="team-dispatch-card-row">
           <span className="team-dispatch-connector" aria-hidden="true" />
           <span className="team-dispatch-title">{subject}</span>
         </span>
       </TooltipButton>
     </article>
   );
   ```

   - Keep `TeamDispatchCardsGroup` unchanged in this WP.
   - Remove the member button, the svg connector and the status badge.
   - Keep the keys `team.viewMemberDetail` / `team.memberDetailUnavailable` in the locales.
5. Replace `STY/team-dispatch.css` card rules with Appendix C.1 (the joining rules come in WP-B).
6. Change the locale values per §4.6 (row A).
7. Tests:
   - `taskStateLabelKey`: all 6 states.
   - `dispatchFallbackState`: known, unknown and undefined inputs.
   - A source assertion that `TeamDispatchCard.tsx` contains `buildTeamTaskRows(` and `team-dispatch-card-open`, and does not match `team-dispatch-card-expert|team-dispatch-task-title-btn`.
8. Harness (Appendix F, part A): add the live task fixture, the state/text assertions, the single-click assertion and the height window.
9. Spec:
   - Rewrite §10B.5 to describe the new card: single target, live status, identity format, geometry, states.
   - Add the scenario `E2E-TEAM-dispatch-card-live-status-and-joining` (card part) to the e2e test plan.

**E2E:** `node scripts/e2e-goal-team-renderer-ui.mjs`, `test:e2e:team`.

**Commit:** `feat(chat): align team dispatch card with expert team reference`

**Done when:**

- [ ] One focusable control per card.
- [ ] Status follows the snapshot (the harness proves `pending` → `In progress`).
- [ ] Measured card height is in [58, 66].
- [ ] Identity string equals `MemberIdentity` text for the same member.
- [ ] Style guard is clean.
- [ ] All listed tests pass.

### WP-B — Expert joining row (fixes D3)

**Depends on:** A.

**Allowed files:**

- `LIB/team-dispatch.ts`
- `CHAT/TeamDispatchCard.tsx`
- `CHAT/AssistantTurn.tsx`
- `STY/team-dispatch.css`
- `apps/desktop/src/components/icons.tsx`
- `TEST/team-dispatch.test.mjs`
- `scripts/e2e/goal-team-renderer-ui.tsx`
- all 9 `LOC/`
- `docs/spec/04-ux/08-component-spec.md`
- `docs/spec/06-delivery/04-e2e-test-plan.md`

**Steps:**

1. Add the joining helper:

   ```ts
   export function isTeammateJoining(
     tools: readonly Pick<UiMessage, "toolName" | "toolStatus">[],
   ): boolean {
     return tools.some((tool) => tool.toolName === "spawn_teammate" && tool.toolStatus === "running");
   }
   ```

2. In `icons.tsx`, add `export const IconFlag = icon(Flag);`, importing `Flag` from `lucide-react` in the existing import list.
3. Give `TeamDispatchCardsGroup` the signature `{ cards, joining = false }: { cards: TeamDispatchCardItem[]; joining?: boolean }`:
   - It returns `null` when `cards.length === 0 && !joining`.
   - After the cards it renders:

     ```tsx
     {joining ? (
       <div className="team-dispatch-joining" role="status">
         <IconFlag size={16} aria-hidden />
         <span className="team-dispatch-joining-label">{t("team.expertJoining")}</span>
       </div>
     ) : null}
     ```

4. In `AssistantTurn.tsx`, add `const teammateJoining = isActive && isTeammateJoining(tools);` and replace the existing group render with:

   ```tsx
   {turnDispatchCards.length > 0 || teammateJoining ? (
     <TeamDispatchCardsGroup cards={turnDispatchCards} joining={teammateJoining} />
   ) : null}
   ```

   `isActive` is the existing prop (live tail turn). If it is not available → S2.
5. CSS: Appendix C.2.
6. i18n: add `team.expertJoining` (§4.6).
7. Tests (`isTeammateJoining`):
   - true for a running `spawn_teammate`;
   - false for `success`, `error`, other tools, and an empty list;
   - a source assertion that `AssistantTurn.tsx` contains `isActive && isTeammateJoining(tools)`.
8. Harness (Appendix F, part B).
9. Spec: add the joining part of `E2E-TEAM-dispatch-card-live-status-and-joining`, and a joining paragraph in §10B.5.

**E2E:** `node scripts/e2e-goal-team-renderer-ui.mjs`.

**Commit:** `feat(chat): show expert joining row while teammates spawn`

**Done when:**

- [ ] The row appears only on the live turn while `spawn_teammate` runs.
- [ ] It disappears when the tool finishes.
- [ ] No animation under reduced motion.

### WP-C — Overview sections and team progress (fixes D4)

**Depends on:** A.

**Allowed files:**

- `WP/OverviewTab.tsx`
- `TEAM/TeamTaskProgress.tsx`
- `TEAM/TaskStateGlyph.tsx` (new)
- `apps/desktop/src/components/icons.tsx`
- `STY/work-panel.css`
- `team-panel.css`
- `TEST/team-presentation.test.mjs`
- `TEST/overview-and-team-drilldown.test.mjs` (only if an assertion needs the new markup)
- the `test:e2e:team` script file
- all 9 `LOC/`
- `docs/spec/04-ux/08-component-spec.md` (§10C overview subsections)
- `docs/spec/06-delivery/04-e2e-test-plan.md`

**Steps:**

1. Icons: add `IconCircle` (`Circle`), `IconCircleDashed` (`CircleDashed`), `IconCircleX` (`CircleX`), `IconCircleSlash` (`CircleSlash`) and `IconCircleArrowRight` (`CircleArrowRight`). Reuse the existing `IconCircleCheck`, `IconArrowUpRight` and `IconChevronDown`.
2. Create `TaskStateGlyph` per §4.3; its CSS goes in `team-panel.css` (Appendix B.3).
3. `MemberIdentity` gets an optional `avatarSize?: 12 | 16 | 20` (default `20`) passed to `PixelAvatar`. Its markup is otherwise unchanged.
4. Rewrite `TeamTaskProgress` to Appendix B.2:
   - The props gain `extra?: ReactNode`; everything else stays.
   - The rows' `aria-label` uses `taskStateLabelKey`.
   - Remove the local `TaskStateIcon`.
   - Remove `.team-progress-count`.
   - Leave the `.team-task-state*` CSS unless `git grep` shows no remaining user.
5. CSS:
   - In `team-panel.css`, split the shared `.team-progress-rows, .team-board-rows` rule so board rows keep their exact current declarations.
   - Add Appendix B.3.
6. `OverviewTab`:
   - Every `<details>` summary in the overview becomes `<span className="work-panel-overview-summary-label">…</span>` plus `<IconChevronDown size={16} className="work-panel-overview-chevron" aria-hidden />`. The subagents summary keeps its existing panorama button between the label and the chevron.
   - For team sessions, do not render the separate `panel.overview.progress` `<details>`. Pass its status row and proposals/`noPlans` content as `extra` to `TeamTaskProgress`.
   - Pass `teamData.paused` as the 4th argument of `buildTeamTaskRows`.
   - Keep the strings `resolvePlanArtifactPath(item.proposal)`, `fileWorkPanelTab(resolved.path)` and `showToast(` unchanged.
7. `work-panel.css`: apply Appendix B.1 (overview chrome for all sessions).
8. i18n:
   - add `team.adHocTaskTitle` and `team.adHocGroup`;
   - change zh `team.taskProgress` and zh-CN `panel.overview.noArtifacts` (§4.6).
9. e2e-team (Appendix D, rows C).
10. Spec: update the §10C subsections for Overview sections and team progress (header layout, row layout, group, `extra`, dashed dividers).

**E2E:** `test:e2e:team`, `test:e2e:plan-ui`.

**Commit:** `feat(workpanel): restyle overview sections and team progress`

**Done when:**

- [ ] Header 48 tall; row 50 tall (±2).
- [ ] Dashed dividers; chevrons rotate.
- [ ] `section.team-progress` has `data-completed` and `data-total`.
- [ ] Board rows look unchanged.
- [ ] Non-team Overview still shows `panel.overview.progress`.

### WP-D — Panorama nodes and toolbar (fixes D5, D12 copy part)

**Depends on:** none (runs after C).

**Allowed files:**

- `WP/AgentPanorama.tsx`
- `agent-panorama-viewport.ts`
- `STY/agent-panorama.css`
- `apps/desktop/src/components/icons.tsx`
- `TEST/agent-panorama-viewport.test.mjs`
- `TEST/subagent-progress-panorama.test.mjs`
- the `test:e2e:team` script file (only for selector migrations in step 6)
- all 9 `LOC/`
- `docs/spec/04-ux/08-component-spec.md` (§10C panorama subsection)

**Steps:**

1. Icons: add `IconMap` (`Map as MapIcon`), `IconLoader` (`Loader`), `IconZoomIn` (`ZoomIn`), `IconZoomOut` (`ZoomOut`), `IconScan` (`Scan`), `IconRefreshCw` (`icon(RefreshCw)`; the import exists) and `IconCirclePause` (`CirclePause`).
2. Geometry in `agent-panorama-viewport.ts`, per Appendix A:
   - Set node width 276, node height 86, gap-x 42, root-child gap 64, row gap 96.
   - Add `export const PANORAMA_MAX_COLUMNS = 2`; columns = `Math.min(childIds.length, PANORAMA_MAX_COLUMNS)`.
   - Add `export const PANORAMA_EDGE_BEND = 46` and `export function panoramaEdgePath(rcx, rby, ccx, cty)` returning `` `M ${rcx} ${rby} C ${rcx} ${rby + PANORAMA_EDGE_BEND}, ${ccx} ${cty - PANORAMA_EDGE_BEND}, ${ccx} ${cty}` ``.
   - In `AgentPanorama.tsx`, replace the inline edge path with `panoramaEdgePath(`.
   - Do not change fit/reset/zoom/pan math or the zoom limits 0.5–1.5.
3. Nodes:
   - Inner `div`s of nodes become `span`s (nodes may be buttons).
   - Keep every class name, `data-*` attribute, both literal `renderStatusBadge(` calls and `statusLabel ?? statusLabels[status]`. No new node-body helper.
   - Update `renderStatusBadge` to render glyph + label per Appendix A.3, keeping `agent-panorama-status-badge status-${status}`.
4. Toolbar, in this order:
   - with `onBack` only: an icon-only Back (`IconChevronLeft` 16, tooltip/aria `team.back`, `icon-btn icon-btn-square`), then a divider;
   - `IconZoomOut` 16;
   - `span.agent-panorama-zoom-label`;
   - `IconZoomIn` 16;
   - `span.agent-panorama-toolbar-divider aria-hidden`;
   - `IconScan` (`onClick={fit}`, tooltip/aria `team.zoomFit`);
   - `IconRefreshCw` (`onClick={reset}`, tooltip/aria `team.zoomReset`).

   All are `TooltipButton` with `icon-btn icon-btn-square`; keep the disabled rules. The error-state retry becomes `Button size="sm"` and keeps `className="agent-panorama-btn"`.
5. CSS: Appendix A.2 (nodes, edges, toolbar, canvas, status colours). Remove `.agent-panorama-text-btn` only after step 6 proves no remaining user.
6. Before removing the Fit/Reset text, run `git grep -n -e agent-panorama-text-btn -e zoomFit -e zoomReset -- scripts apps/desktop/test` and migrate any E2E selector to the button's aria-label. Report each migration.
7. i18n: `team.lead` → `Lead Agent` (9 locales); zh `team.coordinatingExperts` and `team.phase.running` (§4.6).
8. Tests: Appendix E rows D.
9. Spec: update the §10C panorama subsection with the geometry, toolbar, status colours and the shared subagent restyle.

**E2E:** `test:e2e:team`. Optional: `test:e2e:theme-surfaces`.

**Commit:** `feat(workpanel): compact panorama nodes and toolbar`

**Done when:**

- [ ] The Appendix A layouts/edges are asserted by the unit test.
- [ ] Nodes are 276×86.
- [ ] The toolbar is icon-only with labels in tooltips/aria.
- [ ] The subagent panorama still has Back.

### WP-E1 — Correct initial `TeamPanel` view (fixes D7)

**Depends on:** none.

**Allowed files:**

- `LIB/team-panel-view.ts` (new)
- `WP/TeamPanel.tsx`
- `TEST/team-panel-view.test.mjs` (new)

**Steps:**

1. Create `LIB/team-panel-view.ts` with no imports. Export `TeamDetailView` (moved verbatim from `TeamPanel.tsx`) and:

   ```ts
   export function requestedView(input: {
     taskId?: string;
     memberSessionId?: string;
     view?: "aggregate" | "board" | "task" | "panorama";
   }): TeamDetailView
   ```

   Order of checks:
   - `taskId` → `{ kind: "task", taskId }`
   - `memberSessionId` → `{ kind: "member", memberSessionId }`
   - `view === "task"` → `{ kind: "aggregate" }`
   - otherwise `{ kind: view ?? "aggregate" }`
2. `TeamPanel.tsx`:
   - Delete the local `requestedView` and `TeamDetailView` and import them.
   - Both the `useState` initialiser and the reset effect call `requestedView({ taskId: initialTaskId, memberSessionId: initialMemberSessionId, view: initialView })`.
3. Test (direct `.ts` import):
   - panorama, board, task id, member id, `view: "task"` and empty input;
   - the regression case `{ view: "panorama" }` must not produce a member view;
   - a source assertion that `TeamPanel.tsx` matches `requestedView\(\{` twice.

**E2E:** none (covered by E2).

**Commit:** `fix(team): seed the initial team panel view from the right props`

**Done when:**

- [ ] The first render equals the requested view.
- [ ] `TeamPanel.tsx` line count did not grow.

### WP-E2 — Panorama, task and member tabs (fixes D6, D8, D12)

**Depends on:** C, D, E1.

**Allowed files:**

- `LIB/work-panel-tabs.ts`
- `LIB/team-panel-view.ts`
- `LIB/team-presentation.ts`
- `TEAM/team-work-panel-tab.ts` (new)
- `TEAM/TeamWorkPanelSurface.tsx` (new)
- `TEAM/TeamPanoramaTab.tsx` (new)
- `WP/TeamPanel.tsx`
- `WP/WorkPanel.tsx`
- `WP/OverviewTab.tsx`
- `TEAM/TeamTaskProgress.tsx`
- `CHAT/TeamDispatchCard.tsx`
- `apps/desktop/src/components/icons.tsx`
- tests: `TEST/work-panel-tabs.test.mjs`, `TEST/team-work-panel-tab.test.mjs` (new), `TEST/team-presentation.test.mjs`, `TEST/team-panel-view.test.mjs`, `TEST/team-panel.test.mjs`, `TEST/subagent-progress-panorama.test.mjs`, `TEST/work-panel.test.mjs` (only `overview: IconInfo` → `overview: IconMap` if asserted)
- `scripts/e2e/goal-team-renderer-ui.tsx`
- the `test:e2e:team` script file
- all 9 `LOC/`
- both spec docs

**Steps:**

1. `LIB/work-panel-tabs.ts`:
   - Add `export function teamWorkPanelTabId(teamSessionId: string, target?: TeamWorkPanelTarget): string` per §4.1.
   - Change `teamWorkPanelTab(teamSessionId, teamTarget?, label?)` to use it, and to set `label` only when provided.
2. `LIB/team-presentation.ts`: add `memberFocusTask` (§4.4) and `localizedTeamSnapshotError` (§4.5).
3. `TEAM/team-work-panel-tab.ts`:
   - `teamTabLabel(tab, t: (key: string, options?: Record<string, unknown>) => string)` by `tab.teamTarget?.kind`:
     - `panorama` → `t("team.teamPanoramaTitle")`
     - `task` → `tab.label ? t("team.adHocTaskTitle", { subject: tab.label }) : t("panel.tabs.team")`
     - `member` → `tab.label ?? t("panel.tabs.team")`
     - otherwise → `t("panel.tabs.team")`
   - `teamTabIcon(tab)` → `IconMessageCircle` (add `MessageCircle` to icons) for `task`/`member`, else `IconUsers`.
4. `WorkPanel.tsx`, wiring only (net ≤ +5):
   - The `TeamPanel` import becomes `TeamWorkPanelSurface` from `./team/TeamWorkPanelSurface`. Add `import { teamTabIcon, teamTabLabel } from "./team/team-work-panel-tab";`.
   - Replace `IconInfo` with `IconMap` in the icon import and in `TAB_ICONS.overview`.
   - `tabLabel`:
     - its `t` parameter type becomes `(key: string, options?: Record<string, unknown>) => string`;
     - add `if (tab.kind === "team") return teamTabLabel(tab, t);` before the generic non-file branch;
     - keep the line `if (tab.kind === "subagent") return tab.label ?? t("panel.tabs.subagent");` byte-identical.
   - Tab icon: `tab.kind === "team" ? teamTabIcon(tab) : TAB_ICONS[tab.kind]`, inside the existing plugin conditional.
   - Tab `title`: `tab.kind === "subagent" || tab.kind === "team" ? label : tab.resource ?? label`.
   - Team mount: `<TeamWorkPanelSurface tab={activeTab} fallbackTeamSessionId={activeSessionId ?? ""} onSelectSession={(sessionId: string) => void selectSession(sessionId)} />` inside the existing tabpanel `div`.
   - Never add `IconChevronLeft` or `work-panel-subagent-back`.
   - Keep the strings `subagent: IconBot`, `subagentTabsInOrder`, `subagentTabDisplayLabels(` and `{activeTab?.kind === "subagent" && (`.
5. `TeamWorkPanelSurface`:
   - `teamSessionId = tab.resource ?? fallbackTeamSessionId`.
   - It opens tabs with `useAppStore` `openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamSessionId, target, label))`.
   - Routing by `tab.teamTarget?.kind`:
     - `panorama` → `TeamPanoramaTab`
     - `task` → interim `TeamPanel` with `initialTaskId` (replaced in F3)
     - `member` → interim `TeamPanel` with `initialMemberSessionId` (replaced in F3)
     - otherwise → `TeamPanel` with `initialView={tab.teamTarget?.kind === "board" ? "board" : "aggregate"}`
   - Always pass `navigationSeq={tab.teamNavigationSeq}`, `onSelectSession`, `onOpenPanorama` and `onOpenTask`.
6. `TeamPanoramaTab`:
   - Move the panorama node building, `panoramaScopeKey` and the saved-viewport/save logic verbatim from `TeamPanel`. The scope key is unchanged.
   - The child focus task is `memberFocusTask(member, tasks)`; `task: focus?.subject ?? member.description ?? t("team.noCurrentTask")`.
   - The root keeps `team.lead`, `team.coordinatingExperts` and the `waitingForMembers` label logic.
   - `title={t("team.panoramaTitle")}`; no `onBack`; keep loading/error/staleError/onRetry.
   - Child click opens the focus-task tab (label = subject) when there is a focus task, else the member tab (label = display name). The root is not clickable.
7. `TeamPanel.tsx`:
   - Remove the panorama branch, the panorama imports/state and `"panorama"` from `TeamDetailView`/`requestedView`. `initialView?: "aggregate" | "board"`.
   - New required props: `onOpenPanorama: () => void` and `onOpenTask: (taskId: string, subject: string) => void`.
   - The aggregate header panorama button and `TeamTaskProgress.onOpenPanorama` call `onOpenPanorama()`. Aggregate progress rows call `onOpenTask`.
   - Board, roster, view-all and the task-detail owner stay in-panel.
   - Use `localizedTeamSnapshotError`.
8. `TeamTaskProgress`: `onOpenTask(taskId, subject)`. `OverviewTab` passes the subject as the tab label and uses `localizedTeamSnapshotError`. `TeamDispatchCard` passes the subject as the label.
9. i18n: add `team.teamPanoramaTitle`.
10. Tests: Appendix E rows E2.
11. Harness (Appendix F, part E2). e2e-team (Appendix D, rows E2).
12. Spec:
    - Document the tab ids, labels, icons, the tab title rule and panorama-as-tab.
    - Add `E2E-TEAM-panorama-and-member-tabs`.
    - Update steps 5–6 and Automation of `E2E-TEAM-live-overview-board-panorama-and-coexistence`.

**E2E:** `test:e2e:team`, `node scripts/e2e-goal-team-renderer-ui.mjs`, `test:e2e:work-panel-reorder`.

**Commit:** `feat(workpanel): open team panorama, task and member tabs`

**Done when:**

- [ ] Card click, overview row and panorama child each open their own tab without replacing `team:<id>`.
- [ ] Re-clicking activates the existing tab.
- [ ] The tab tooltip equals its label.
- [ ] `TeamPanel` no longer imports `AgentPanorama`.
- [ ] The `WorkPanel.tsx` net delta is ≤ +5.

### WP-F1 — Extract member transcript and task brief (pure refactor)

**Depends on:** E2.

**Allowed files:**

- `WP/TeamPanel.tsx`
- `TEAM/TeamMemberTranscript.tsx` (new)
- `TEAM/TeamTaskBrief.tsx` (new)
- `TEST/overview-and-team-drilldown.test.mjs`
- `TEST/team-panel.test.mjs`

**Steps:**

1. Move the transcript fetch + rendering of `TeamMemberDetail` (including `ReviewChangeCard`, the `loadSeqRef` guard and every class name) into `TeamMemberTranscript({ memberSessionId })`. Behaviour and DOM stay identical.
2. Move the `TeamTaskDetail` fields `section.team-section` (owner button `team-owner-btn`, blockedBy, scopes, overlaps) into `TeamTaskBrief`. Props are exactly the values it reads, plus `onSelectMember`. The DOM stays identical.
3. Point the `api\.getSession` source assertion at `TeamMemberTranscript.tsx`.

**E2E:** none (F3 runs it).

**Commit:** `refactor(team): extract member transcript and task brief`

**Done when:**

- [ ] Zero behaviour/DOM change.
- [ ] `TeamPanel.tsx` is smaller.
- [ ] All existing tests pass.

### WP-F2 — Tool and reasoning rows in teammate transcripts (fixes D9 rows + rollback hazard)

**Depends on:** F1.

**Allowed files:**

- `LIB/team-member-transcript.ts` (new)
- `TEAM/TeamMemberTranscript.tsx`
- `TEST/team-member-transcript.test.mjs` (new)
- `team-panel.css`

**Steps:**

1. `LIB/team-member-transcript.ts` exports:
   - `TeamMemberTranscriptRow = { kind: "user"; message: UiMessage } | SubagentRunItem`, reusing `SubagentRunItem` from `LIB/subagent-transcript.ts`;
   - `buildTeamMemberTranscriptRows(messages: readonly UiMessage[]): TeamMemberTranscriptRow[]`.

   Mapping:

   | Source message | Row |
   | --- | --- |
   | role `user` | user row |
   | role `tool`, or assistant with `toolName` | tool item |
   | assistant thinking | thinking item |
   | assistant content | text item |
   | assistant error-only | error item |
   | system rows | skipped |

   No `parentToolCallId` filtering. Reuse the existing subagent builder only if it can be called without filtering; otherwise map locally to `SubagentRunItem`. Never edit `subagent-transcript.ts` (S1).
2. Render rows like `SubagentTranscriptTab` does (same `ToolRow`, `ThinkingRow`, `Markdown`, `AssistantErrorMessage` usage):
   - `ThinkingRow` `streaming={false}` unless the member is running and the message is streaming.
   - Remove `ReviewChangeCard`.
   - Do not modify `ToolRow`.
3. Tests:
   - the mapping table above, including a role-`tool` row and a thinking row;
   - a source assertion that `TeamMemberTranscript.tsx` does not match `ReviewChangeCard`.

**E2E:** none (F3 runs it).

**Commit:** `fix(team): render tool and reasoning rows in teammate transcripts`

**Done when:**

- [ ] Persisted tool rows and thinking show in member transcripts.
- [ ] No rollback control appears in member transcripts.

### WP-F3 — Live task and member tabs (fixes D9 refresh/bounds, D10)

**Depends on:** F2, E2.

**Allowed files:**

- `apps/desktop/src/stores/runtime/team-member-transcript-runtime.ts` (new)
- `apps/desktop/src/hooks/useTeamMemberTranscript.ts` (new)
- `TEAM/TeamTaskTab.tsx` (new)
- `TEAM/TeamMemberTab.tsx` (new)
- `STY/team-work-tab.css` (new)
- `TEAM/TeamWorkPanelSurface.tsx`
- `TEAM/TeamMemberTranscript.tsx`
- `TEAM/TeamTaskBrief.tsx`
- `TEST/team-member-transcript-runtime.test.mjs` (new)
- `TEST/overview-and-team-drilldown.test.mjs`
- `TEST/team-panel.test.mjs`
- the `test:e2e:team` script file
- all 9 `LOC/`
- both spec docs

**Steps:**

1. Controller: Appendix G.
2. Hook `useTeamMemberTranscript(memberSessionId, { snapshotRevision })`, modelled on `useTeamSnapshot`:
   - `useMemo` controller per id;
   - `useEffect(() => controller.start(), [controller])`;
   - `useSyncExternalStore`;
   - `invalidate()` when `snapshotRevision` changes.
   - Real deps:

     | Dep | Value |
     | --- | --- |
     | `getSession` | `api.getSession` |
     | `readOptions` | `{ messageLimit: 200, contentLimit: SESSION_TRANSCRIPT_CONTENT_LIMIT }` |
     | `subscribeAgentEvent` | `api.onAgentEvent` |
     | `subscribeHostRestart` | `api.onHostStatus` filtered to `ok && restarted` |
     | `addFocusListener` | `window` `focus` |

   - Import `SESSION_TRANSCRIPT_CONTENT_LIMIT` if it is already exported. Otherwise define `const TEAM_MEMBER_TRANSCRIPT_CONTENT_LIMIT = 64 * 1024` in the hook with a comment; never export from `app-store.ts`.
3. `TeamMemberTranscript` uses the hook:
   - shows `team.transcriptTruncated` when `truncated`;
   - keeps loading/error/empty copy;
   - reads `snapshotRevision` from `useTeamSnapshot`.
4. `TeamTaskTab({ teamSessionId, taskId, onOpenMember, onSelectSession })` and `TeamMemberTab({ teamSessionId, memberSessionId, onOpenTask, onSelectSession })` per Appendix C.3:
   - testids `team-task-tab` / `team-member-tab`, root class `team-work-tab`;
   - region `aria-label` `team.taskDetail` / `team.memberDetail`;
   - transcript `role="log"` with `aria-label` `team.transcript`.
   - Task with no owner: header identity `team.unassigned`, the brief open by default, body `team.noTranscript`.
   - Task missing from the snapshot or deleted: header uses `tab.label` and the body shows `team.noCurrentTask`.
   - Follow-scroll: SHOULD reuse the mechanism `SubagentTranscriptTab` uses without modifying it; otherwise log a deviation.
5. Surface routes `task` → `TeamTaskTab` and `member` → `TeamMemberTab`, and imports `team-work-tab.css`.
6. i18n: add `team.transcriptTruncated`; translate the 7-locale placeholders (§4.6).
7. Tests:
   - controller (Appendix G cases);
   - the `api\.getSession` assertion moves to `hooks/useTeamMemberTranscript.ts`;
   - `team-panel.test` source assertions per Appendix E.
8. e2e-team (Appendix D, rows F3). Spec: task/member tab layout; `E2E-TEAM-horizontal-overflow` gains the task tab surface.

**E2E:** `test:e2e:team`, `test:e2e:work-panel-reorder`. Optional: `node scripts/e2e-team-review-ui.mjs`, `test:e2e:layout`.

**Commit:** `feat(workpanel): add live team task and member tabs`

**Done when:**

- [ ] Task/member tabs update without reopening.
- [ ] No reads happen after unmount (test).
- [ ] Reads are bounded.
- [ ] Header ≈60 tall.
- [ ] No composer in the tabs.

### WP-G — Composer label 专家团 (fixes D11)

**Depends on:** none.

**Allowed files:**

- zh-CN and zh-TW `LOC/`
- `scripts/e2e/composer-mode-menus.tsx`
- `scripts/e2e-composer-mode-menus.mjs`
- `docs/spec/06-delivery/04-e2e-test-plan.md`
- `docs/spec/04-ux/08-component-spec.md` (only if it quotes 专家团队)

**Steps:**

1. Change `chat.profileTeam` and `team.title` (U3) per §4.6.
2. Replace `专家团队` with `专家团` at harness L13, mjs L77/L79 and e2e plan L2421.
3. Run `git grep -n 专家团队` and report every remaining hit. Hits inside `panel.overview.teamSection` stay.

**E2E:** `test:e2e:composer-mode-menus`.

**Commit:** `feat(i18n): rename the composer team profile to 专家团`

**Done when:**

- [ ] Composer menu shows `专家团`.
- [ ] Remaining `专家团队` hits are reported and justified.

---

## 6. Integration and E2E

### 6.1 Refresh

After WP-G:

```bash
git fetch origin main
git rebase origin/main
```

This is a private branch, so the rebase is allowed. Resolve conflicts in the task worktree only (S8 rules), then re-run every WP's unit/static checks.

### 6.2 Task-candidate E2E

Rebuild in this order:

1. changed package dists (i18n first);
2. the desktop app with `electron-vite build`;
3. the host binary (§0.6).

Required suites:

- `test:e2e:team`
- `node scripts/e2e-goal-team-renderer-ui.mjs`
- `test:e2e:work-panel-reorder`
- `test:e2e:plan-ui`
- `test:e2e:composer-mode-menus`

Optional: `test:e2e:theme-surfaces`, `node scripts/e2e-team-review-ui.mjs`, `test:e2e:layout`. Never run `verify:ui:*`.

Record:

```text
Task candidate:
Base main:
E2E suites:
Result:
Environment:
```

### 6.3 Known flake

`test:e2e:plan-ui` has a known REVISION CDP timeout (fix in an unmerged PR) and a heavy-load reload flake. On failure, rerun that suite once in isolation and record both runs. A second failure → S9.

### 6.4 Changelog and PR

- Changelog data lives in `packages/shared/src/changelog-*.ts`. If an upcoming/unreleased entry exists, add one bullet per locale following its format. If none exists, do not create a version; list it under remaining user decisions.
- Run `node scripts/check-pr-base-main.mjs` before any PR.
- Push, PR and merge only on an explicit user request (U5 decides the PR split).

---

## 7. Spec updates (owned by the WPs above)

| Document | Section | WP |
| --- | --- | --- |
| `docs/spec/04-ux/08-component-spec.md` | §10B.5 dispatch card (rewrite; it already mismatches baseline code) | A, B |
| same | §10C Overview sections + team progress | C |
| same | §10C panorama | D |
| same | §10C/§11 team tabs (ids, labels, icons, tooltip, panorama tab) | E2 |
| same | §10C task/member tabs and transcripts | F3 |
| same | §13.1, only if it quotes 专家团队 | G |
| `docs/spec/06-delivery/04-e2e-test-plan.md` | new `E2E-TEAM-dispatch-card-live-status-and-joining` | A, B |
| same | `E2E-TEAM-live-overview-board-panorama-and-coexistence` steps 5–6 + Automation | E2 |
| same | new `E2E-TEAM-panorama-and-member-tabs` | E2 |
| same | `E2E-TEAM-horizontal-overflow` (task tab surface) | F3 |
| same | `E2E-COMPOSER-narrow-controls` copy | G |

---

## Appendix A — Panorama geometry

### A.1 Layout

- Root at `y = 40`, centred over the content width.
- Rows of up to `PANORAMA_MAX_COLUMNS = 2` children; a partial last row is centred.
- Bottom margin 40.
- Edges run from the root bottom-centre to each child top-centre via `panoramaEdgePath`.

| Children | Content size | Root (x, y) | Children (x, y) |
| --- | --- | --- | --- |
| 0 | 276×166 | (0, 40) | — |
| 1 | 276×316 | (0, 40) | (0, 190) |
| 2 | 594×316 | (159, 40) | (0, 190), (318, 190) |
| 3 | 594×498 | (159, 40) | (0, 190), (318, 190), (159, 372) |
| 4 | 594×498 | (159, 40) | (0, 190), (318, 190), (0, 372), (318, 372) |

Edges (3 children): `M 297 126 C 297 172, 138 144, 138 190`; `M 297 126 C 297 172, 456 144, 456 190`; `M 297 126 C 297 172, 297 326, 297 372`.

Edges (4 children, row 2): `M 297 126 C 297 172, 138 326, 138 372`; `M 297 126 C 297 172, 456 326, 456 372`.

### A.2 CSS (`agent-panorama.css`; merge into existing selectors and keep positioning declarations)

```css
.agent-panorama-node {
  display: flex;
  flex-direction: column;
  width: 276px;
  height: 86px;
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--radius-xs);
  background: var(--ds-bg-secondary);
  box-shadow: none;
}
.agent-panorama-node-header {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-height: 0;
  padding: 9px 12px;
}
.agent-panorama-node-avatar {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-2xs);
  overflow: hidden;
}
.agent-panorama-node-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.agent-panorama-node-title {
  overflow: hidden;
  color: var(--ds-text-secondary);
  font-size: var(--text-sm-plus);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panorama-node-task {
  overflow: hidden;
  color: var(--ds-text-primary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panorama-node-status {
  display: flex;
  flex: none;
  align-items: center;
  height: 32px;
  padding-inline: 12px;
  border-top: 1px solid var(--ds-border-subtle);
}
.agent-panorama-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: none;
  color: var(--ds-text-muted);
  font-size: var(--text-sm);
}
.agent-panorama-edge {
  fill: none;
  stroke: var(--ds-border-strong);
  stroke-width: 1.5;
}
.agent-panorama-toolbar {
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--radius-md);
  background: var(--ds-bg-elevated-opaque);
  box-shadow: var(--ds-shadow-dialog);
}
.agent-panorama-zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}
.agent-panorama-zoom-label {
  min-width: 40px;
  color: var(--ds-text-secondary);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.agent-panorama-toolbar-divider {
  flex: none;
  width: 1px;
  height: 20px;
  margin-inline: 3px;
  background: var(--ds-border-default);
}
```

- Remove declarations in the old rules that contradict these (old widths/heights, padding, shadows, accent backgrounds).
- If `.agent-panorama` has no dot pattern, add `background-image: radial-gradient(var(--ds-border-default) 1px, transparent 1px); background-size: 16px 16px;`.

### A.3 Status glyphs and colours (`renderStatusBadge`, glyph size 12, `aria-hidden`)

| Status | Glyph | Glyph colour | Label colour |
| --- | --- | --- | --- |
| running | `IconLoader` (static) | muted | `--ds-success` |
| completed | `IconCircleCheck` | `--ds-success` | `--ds-success` |
| failed | `IconCircleX` | `--ds-error` | `--ds-error` |
| paused | `IconCirclePause` | `--ds-warning` | `--ds-warning` |
| idle / todo / other | `IconCircle` | muted | muted |
| blocked | `IconCircleDashed` | muted | muted |

Implement the colours with `.agent-panorama-status-badge.status-<status>` (label) and `.agent-panorama-status-badge.status-<status> svg` (glyph).

## Appendix B — Overview

### B.1 `work-panel.css` (overview chrome, all sessions)

```css
.work-panel-overview-scroll { padding: 4px 12px 24px; }
.work-panel-overview-section { border-bottom: 1px dashed var(--ds-border-default); }
.work-panel-overview-section summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0;
  color: var(--ds-text-secondary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-normal);
  list-style: none;
  cursor: pointer;
}
.work-panel-overview-section summary::-webkit-details-marker { display: none; }
.work-panel-overview-summary-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.work-panel-overview-chevron {
  flex: none;
  margin-inline-start: auto;
  color: var(--ds-text-muted);
  transition: transform var(--motion-duration-fast) var(--motion-ease-out);
}
.work-panel-overview-section:not([open]) > summary .work-panel-overview-chevron { transform: rotate(-90deg); }
.work-panel-overview-section-body { padding: 0 0 12px; }
.work-panel-overview-empty-copy { margin: 0; padding: 0; font-size: var(--text-md); }
@media (prefers-reduced-motion: reduce) {
  .work-panel-overview-chevron { transition: none; }
}
```

Edit the existing rules in place (do not duplicate selectors). The muted colour of `.work-panel-overview-empty` / `-empty-copy` stays.

### B.2 `TeamTaskProgress` markup

```tsx
<section className="team-progress" aria-label={t("team.taskProgress")}
  data-completed={completed} data-total={total}>
  <header className="team-progress-header">
    <h3 className="team-progress-title">{t("team.taskProgress")}</h3>
    <TooltipButton className="team-progress-panorama" tooltip={t("team.viewInPanorama")}
      ariaLabel={t("team.viewInPanorama")} onClick={onOpenPanorama}>
      <span>{t("team.viewInPanorama")}</span>
      <IconArrowUpRight size={16} aria-hidden />
    </TooltipButton>
    <span className="team-progress-divider" aria-hidden="true" />
    <TooltipButton className="team-progress-toggle" tooltip={t("team.taskProgress")}
      ariaLabel={t("team.taskProgress")} aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
      <IconChevronDown size={16} aria-hidden />
    </TooltipButton>
  </header>
  <div id={bodyId} className="team-progress-body" hidden={!expanded}>
    {total > 0 ? (
      <>
        <TooltipButton className="team-progress-group-toggle" tooltip={t("team.adHocGroup")}
          ariaLabel={t("team.adHocGroup")} aria-expanded={groupOpen} aria-controls={groupId}
          onClick={() => setGroupOpen((open) => !open)}>
          <span>{t("team.adHocGroup")}</span>
          <span className="team-progress-group-count">{total}</span>
          <IconChevronDown size={14} aria-hidden />
        </TooltipButton>
        <ol id={groupId} className="team-progress-rows" hidden={!groupOpen}>
          {rows.map(({ task, state, owner }) => (
            <li key={task.taskId}>
              <TooltipButton className="team-progress-row" tooltip={task.subject}
                ariaLabel={t("team.openTaskWithStatus", { subject: task.subject, status: t(taskStateLabelKey(state)) })}
                onClick={() => onOpenTask(task.taskId)}>
                <TaskStateGlyph state={state} />
                <span className="team-progress-task">{t("team.adHocTaskTitle", { subject: task.subject })}</span>
                {owner ? <MemberIdentity member={owner} avatarSize={12} />
                  : <span className="team-person">{t("team.unassigned")}</span>}
              </TooltipButton>
            </li>
          ))}
        </ol>
        {total > rows.length ? (
          <Button variant="ghost" size="sm" className="team-progress-view-all" onClick={onOpenBoard}>
            {t("team.viewAllTasks", { count: total })}
          </Button>
        ) : null}
      </>
    ) : <p className="team-empty-copy">{t("team.noTasks")}</p>}
    {extra}
  </div>
</section>
```

- `groupOpen` is local state, default `true`.
- `bodyId`/`groupId` come from `useId()`.
- E2 changes `onOpenTask(task.taskId)` to `onOpenTask(task.taskId, task.subject)`.

### B.3 `team-panel.css`

```css
.team-task-glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; color: var(--ds-text-muted); }
.team-task-glyph[data-state="in_progress"] { color: var(--ds-text-primary); }
.team-task-glyph[data-state="completed"] { color: var(--ds-success); }
.team-task-glyph[data-state="failed"] { color: var(--ds-error); }
.team-progress { display: flex; flex-direction: column; }
.team-progress-header { display: flex; align-items: center; gap: 8px; min-height: 48px; }
.team-progress-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ds-text-secondary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-progress-panorama {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  border-radius: var(--radius-3xs);
  color: var(--ds-text-secondary);
  font-size: var(--text-md);
}
.team-progress-panorama:hover { color: var(--ds-text-primary); }
.team-progress-divider { flex: none; width: 1px; height: 12px; background: var(--ds-border-default); }
.team-progress-toggle,
.team-progress-group-toggle { border-radius: var(--radius-3xs); color: var(--ds-text-muted); }
.team-progress-toggle { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.team-progress-toggle:hover { background: var(--ds-bg-hover); color: var(--ds-text-primary); }
.team-progress-toggle svg,
.team-progress-group-toggle svg { transition: transform var(--motion-duration-fast) var(--motion-ease-out); }
.team-progress-toggle[aria-expanded="false"] svg,
.team-progress-group-toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
.team-progress-group-toggle {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  font-size: var(--text-md);
}
.team-progress-rows { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.team-progress-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  row-gap: 4px;
  width: 100%;
  min-height: 50px;
  padding: 4px 0;
  border-radius: var(--radius-3xs);
  line-height: var(--leading-normal);
  text-align: left;
}
.team-progress-row .team-task-glyph { grid-column: 1; grid-row: 1; }
.team-progress-task {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ds-text-secondary);
  font-size: var(--text-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-progress-row:hover .team-progress-task { color: var(--ds-text-primary); }
.team-progress-row .team-person {
  display: inline-flex;
  grid-column: 2;
  grid-row: 2;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--ds-text-muted);
  font-size: var(--text-md);
}
@media (prefers-reduced-motion: reduce) {
  .team-progress-toggle svg,
  .team-progress-group-toggle svg { transition: none; }
}
```

Replace the old `.team-progress-*` rules that these supersede. Keep `.team-board-rows` declarations exactly as they were.

## Appendix C — Card, joining row and tab geometry

### C.1 Dispatch card (`team-dispatch.css`)

```css
.team-dispatch-cards-group { display: flex; flex-direction: column; gap: 12px; width: 100%; margin-block: 8px; }
.team-dispatch-card {
  border: 1px solid var(--ds-border-default);
  border-radius: var(--radius-xs);
  background: var(--ds-tile);
  transition: border-color var(--motion-duration-fast) var(--motion-ease-out);
}
.team-dispatch-card:hover { border-color: var(--ds-border-strong); }
.team-dispatch-card-open {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 10px 12px 8px;
  border-radius: inherit;
  line-height: var(--leading-normal);
  text-align: left;
}
.team-dispatch-card-row { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.team-dispatch-identity {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ds-text-secondary);
  font-size: var(--text-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-dispatch-status { flex: none; color: var(--ds-text-muted); font-size: var(--text-md); }
.team-dispatch-card[data-state="in_progress"] .team-dispatch-status { color: var(--ds-text-secondary); }
.team-dispatch-card[data-state="completed"] .team-dispatch-status { color: var(--ds-success); }
.team-dispatch-card[data-state="failed"] .team-dispatch-status { color: var(--ds-error); }
.team-dispatch-connector {
  flex: none;
  align-self: flex-start;
  width: 8px;
  height: 10px;
  margin-inline-start: 7px;
  border-bottom: 1px solid var(--ds-border-strong);
  border-left: 1px solid var(--ds-border-strong);
  border-bottom-left-radius: var(--radius-3xs);
}
.team-dispatch-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ds-text-primary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .team-dispatch-card { transition: none; }
}
```

Check against the reference:

- Height = 10 + 18.2 + 4 + 19.6 + 8 + 2 borders ≈ 61.8.
- Row-1 centre ≈ 19.1; row-2 centre ≈ 42.
- Connector stroke at ≈19.5 from the inner left.
- Title start = 12 + 7 + 8 + 8 = 35.

### C.2 Joining row (`team-dispatch.css`)

```css
.team-dispatch-joining {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  color: var(--ds-text-muted);
  font-size: var(--text-md);
}
.team-dispatch-joining-label { animation: team-dispatch-joining-pulse 1.4s ease-in-out infinite alternate; }
@keyframes team-dispatch-joining-pulse { from { opacity: 1; } to { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .team-dispatch-joining-label { animation: none; }
}
```

### C.3 Task/member tabs (`team-work-tab.css`)

Structure:

```tsx
<section className="team-work-tab" data-testid="team-task-tab" aria-label={t("team.taskDetail")}>
  <header className="team-work-tab-header">
    <div className="team-work-tab-row">
      {/* owner: TooltipButton.team-work-tab-identity (PixelAvatar 16 + identity text) -> member tab */}
      <span className="team-work-tab-status">{/* in_progress: IconLoader 12 static; else TaskStateGlyph 12 */}
        <span>{t(taskStateLabelKey(state))}</span></span>
    </div>
    <div className="team-work-tab-row">
      <span className="team-work-tab-connector" aria-hidden="true" />
      <h2 className="team-work-tab-title">{subject}</h2>
      <div className="team-work-tab-actions">
        {/* TooltipButton.team-work-tab-action IconExternal 16, team.openInMain (disabled when no owner) */}
        {/* TooltipButton.team-work-tab-action IconInfo 16, tooltip team.taskDetail, aria-expanded -> brief */}
      </div>
    </div>
  </header>
  {briefOpen ? <div className="team-work-tab-brief">{/* description + TeamTaskBrief */}</div> : null}
  <div className="team-work-tab-body" role="log" aria-label={t("team.transcript")}>{/* TeamMemberTranscript */}</div>
</section>
```

The member tab is identical except:

- testid `team-member-tab`;
- the status shows the phase (`team.phase.<phase>`, with the glyph per Appendix A.3, running = static loader);
- the title is the focus task subject (`memberFocusTask`) or `team.noCurrentTask`;
- the only action is `openInMain`.

```css
.team-work-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.team-work-tab-header {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--ds-border-default);
  line-height: var(--leading-tight);
}
.team-work-tab-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.team-work-tab-identity {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-radius: var(--radius-3xs);
  color: var(--ds-text-secondary);
  font-size: var(--text-md);
  text-align: left;
}
.team-work-tab-status { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--ds-text-primary); font-size: var(--text-md); }
.team-work-tab-status svg { color: var(--ds-text-muted); }
.team-work-tab-connector {
  flex: none;
  align-self: flex-start;
  width: 8px;
  height: 10px;
  margin-inline-start: 7px;
  border-bottom: 1px solid var(--ds-border-strong);
  border-left: 1px solid var(--ds-border-strong);
  border-bottom-left-radius: var(--radius-3xs);
}
.team-work-tab-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ds-text-primary);
  font-size: var(--text-base-plus);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-work-tab-actions { display: flex; flex: none; gap: 2px; margin-block: -3px; }
.team-work-tab-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-3xs);
  color: var(--ds-text-muted);
}
.team-work-tab-action:hover { background: var(--ds-bg-hover); color: var(--ds-text-primary); }
.team-work-tab-brief { padding: 12px 16px; border-bottom: 1px solid var(--ds-border-default); }
.team-work-tab-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px; }
```

Header height = 20 + 16.25 + 4 + 18.75 + 1 ≈ 60.

## Appendix D — `test:e2e:team` migration (re-locate by content; line numbers are hints)

| WP | Location | Change |
| --- | --- | --- |
| C | L863 / L868 `.team-progress-count` `'0/6'` / `'1/6'` | read `section.team-progress` `dataset.completed` / `dataset.total` and assert `0`/`6`, `1`/`6` |
| C | L1039 `任务进度` | `进展` |
| C | L653 `.team-progress-row`, L655/L875 view-all `/view all\|查看全部/i`, L872 five rows | must pass unchanged |
| E2 | `openTeamPanel` helper (L410–432) | active tab id regex `/^team:[^:]+$/` (L414); drop `[data-panorama-canvas]` from its ready selector (L420); back control is `.team-back-btn` only (L422) |
| E2 | layout matrix (L646–688) | add `.team-work-tab` to the surface selector; add a `taskTab` surface opened from an overview row |
| E2 | L815 open panorama | click the control with aria-label `/view panorama/i`; assert the active tab id is `team:<leadId>:panorama` and the tab text is `Team panorama` |
| E2 | L826 panorama child click | assert the active tab id matches `^team:<leadId>:(task\|member):` and the interim detail view is visible |
| E2 | L827 return to panorama | click `[data-work-panel-tab-id="team:<leadId>:panorama"] .work-panel-tab-button`, then wait for `[data-panorama-canvas]` |
| F3 | L826 | assert `[data-testid="team-task-tab"]` or `[data-testid="team-member-tab"]` |

## Appendix E — Unit-test migrations

| WP | Test file | Change |
| --- | --- | --- |
| A | `team-presentation.test.mjs`, `team-dispatch.test.mjs` | new cases (WP-A step 7) |
| B | `team-dispatch.test.mjs` | `isTeammateJoining` cases |
| D | `subagent-progress-panorama.test.mjs` | L54 → match `PANORAMA_MAX_COLUMNS = 2` and `Math\.min\(childIds\.length, PANORAMA_MAX_COLUMNS\)`; L55 → `PANORAMA_NODE_WIDTH = 276`; L56 → `PANORAMA_ROOT_CHILD_GAP = 64`; L59 → `export function panoramaEdgePath` in `agent-panorama-viewport.ts` and `panoramaEdgePath\(` in `AgentPanorama.tsx`; L93 → `width:\s*276px;` |
| D | `agent-panorama-viewport.test.mjs` | test 1 renamed `panorama geometry matches the 276 by 86 two-column grid and edge anchors`, asserting every Appendix A.1 row and edge; the L94–107 assertions stay |
| E1 | `team-panel-view.test.mjs` (new) | WP-E1 step 3 |
| E2 | `work-panel-tabs.test.mjs` | `teamWorkPanelTabId` for all 5 targets; label only when passed; seq increments |
| E2 | `team-work-panel-tab.test.mjs` (new, vite `createServer` + `ssrLoadModule` like `agent-panorama-viewport.test.mjs`) | `teamTabLabel` and `teamTabIcon` for every kind |
| E2 | `team-presentation.test.mjs` | `memberFocusTask` (in_progress first, pending next, latest `updatedAt`, strict ownership, deleted excluded); `localizedTeamSnapshotError` |
| E2 | `team-panel-view.test.mjs` | drop the panorama case |
| E2 | `team-panel.test.mjs` | L86 → `initialView\?: "aggregate" \| "board"`; L117 `<TeamPanel` → `<TeamWorkPanelSurface`; keep L41–48 and L83 |
| E2 | `subagent-progress-panorama.test.mjs` L78–85 | read `TEAM/TeamPanoramaTab.tsx`; assert `AgentPanorama`, `team\.lead`, `memberFocusTask`, `teamWorkPanelTab\(`; doesNotMatch `onBack=`. `TeamPanel.tsx` doesNotMatch `AgentPanorama` and `view\.kind === "panorama"`, and still matches `roster\.map`, `navigate\(\{ kind: "member", memberSessionId \}\)`, `setView\(next \?\? \{ kind: "aggregate" \}\)` |
| F1 | `overview-and-team-drilldown.test.mjs` | `api\.getSession` assertion → `TEAM/TeamMemberTranscript.tsx` |
| F2 | `team-member-transcript.test.mjs` (new, registers `helpers/ts-import-hooks.mjs` like `team-dispatch.test.mjs`) | WP-F2 step 3 |
| F3 | `team-member-transcript-runtime.test.mjs` (new) | Appendix G cases |
| F3 | `overview-and-team-drilldown.test.mjs` | `api\.getSession` assertion → `hooks/useTeamMemberTranscript.ts` |

Must stay green without edits (S4): `renderer-branding` (L106), `composer-pickers` (L41–46), the existing `work-panel-tabs` cases (L31–49), `plan-artifact-resolution`, `work-panel.test.mjs` L268–269, `subagent-panel.test.mjs` L68–72, `sidebar-navigation` L65–68.

## Appendix F — `scripts/e2e/goal-team-renderer-ui.tsx` migration

**Part A (WP-A):**

1. If the harness does not import the stylesheet that defines the global `button` reset and `box-sizing` (find with `git grep -l "box-sizing: border-box" apps/desktop/src/styles`), import it next to `tokens.css`.
2. In the `getTeamSnapshot` mock, replace `tasks: []` / `readiness: []` with:

   ```ts
   tasks: [{ teamSessionId: "team-session", taskId: "task-real", revision: 2, subject: "Review change", status: "in_progress", ownerSessionId: "member-session", ownerMemberName: "researcher", blockedBy: [], writeScopes: [], deleted: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z" }],
   readiness: [{ taskId: "task-real", isReady: true, unresolvedBlockedBy: [] }],
   ```

   The card fixture keeps `status: "pending"` to prove the snapshot wins.
3. Assert:
   - the article has `data-state="in_progress"` and its text contains `In progress`;
   - exactly one `button` inside `.team-dispatch-card`;
   - one click on `.team-dispatch-card-open` pushes exactly 1 tab, for session `lead-session`, with `teamTarget` `{ kind: "task", taskId: "task-real" }`;
   - the card's `getBoundingClientRect().height` is within [58, 66].
4. Rename the scenario `member detail and task navigation` to `single task navigation`.

**Part B (WP-B):** render `TeamDispatchCardsGroup` with `joining: true, cards: []` and assert `.team-dispatch-joining[role="status"]` contains `New expert joining…`. With `joining: false, cards: []`, assert nothing renders.

**Part E2:** assert the pushed tab id is `team:team-session:task:task-real` and `label` is `Review change`.

## Appendix G — Member transcript controller (`stores/runtime/team-member-transcript-runtime.ts`, type-only imports)

```ts
export type TeamMemberTranscriptState = {
  messages: UiMessage[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  lastSuccessAt: number | null;
};
export type TeamMemberTranscriptDeps = {
  getSession: (id: string, options: SessionHistoryReadOptions) => Promise<{ session: SessionDetail | null }>;
  readOptions: SessionHistoryReadOptions;
  subscribeAgentEvent: (listener: (envelope: AgentEventEnvelope) => void) => () => void;
  subscribeHostRestart: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  now?: () => number;
};
export function createTeamMemberTranscriptController(
  memberSessionId: string,
  deps: TeamMemberTranscriptDeps,
): {
  getState(): TeamMemberTranscriptState;
  subscribe(listener: () => void): () => void;
  start(): () => void;
  invalidate(): void;
  refresh(): Promise<void>;
};
```

- Align the `getSession` dep type with the real `api.getSession` signature in `lib/api.ts`. If the shapes differ → adapt the dep type, not the API; if the history flag `hasMoreBefore` is not reachable → S2.
- `start()`:
  - subscribes to agent events, host restart and focus **before** the first read;
  - triggers the first read;
  - returns a disposer that unsubscribes everything and marks the controller disposed.
- Agent events: only `envelope.sessionId === memberSessionId`, and only event types `message_end`, `tool_start`, `tool_end`, `user_message_persisted`, `agent_end` → `invalidate()`.
- Coalescing: one read in flight at a time. `invalidate()` during a read sets `dirty`, which triggers exactly one follow-up read.
- After dispose, results are ignored.
- Errors keep the previous `messages` and set `error`.
- `truncated = hasMoreBefore === true`.
- `readOptions` is passed verbatim.
- No timers by default; an optional 5 s poll while the member is running is a deviation that must be logged.

Required test cases:

1. Subscriptions happen before the first `getSession` call.
2. Two `invalidate()` calls during an in-flight read → exactly one follow-up read.
3. Events for other sessions and other event types are ignored.
4. A late result after dispose does not change state or notify.
5. `truncated` follows `hasMoreBefore`.
6. An error keeps the previous messages.
7. `readOptions` reaches `getSession` unchanged.
8. Host restart and focus each trigger a read.

## Appendix H — Execution record (2026-10-06, Asia/Taipei)

All ten work packages are implemented and independently reviewed. Local
validation is complete; user acceptance is pending. No push, PR, merge,
installation, or release was performed. The primary checkout, its four
untracked release directories, and other tasks' dirty worktrees were preserved.

### Candidate and environment

- Task candidate: `400ea2339abbdf9cd1a660f9d4e8c52c0a8e7d6c`.
- Base main: `97388c1713aa5453de0b4b8012ac08dec3367038`.
- Final refresh: `git fetch origin main` and `git rebase origin/main`;
  branch already current. `node scripts/check-pr-base-main.mjs` passed.
- Request branch: `feat/expert-team-visual-parity`.
- Worktree: `../PI-Desktop-worktrees/expert-team-visual-parity`.
- Dependencies: symlink overlays reuse the primary installation, with workspace
  package links pointing to this worktree. No dependencies were installed.
- Workspace dists were built using the installed TypeScript executable.
  The initial RACP build-order failure was resolved by building agent-host first.
- Host: `CARGO_TARGET_DIR=/tmp/pi-expert-team-visual-parity-target cargo build
  -p host-core --locked`, successful; that binary was passed through
  `PI_DESKTOP_HOST_BIN`.
- Real Electron/Main/Host used temporary profiles and deterministic local model
  fixtures. The runner removed `ANTHROPIC_*`, `CLAUDECODE`, and optional live-model
  test variables. The user's running application and real providers were not used.
- Final logs and selected screenshots are in the ignored local directory
  `.review-evidence/expert-team-visual-parity-400ea2339/`. They are not committed.
- The integrator personally inspected the card, overview, panorama, and task-tab
  screenshots. These are actual Electron captures with synthetic fixture data.

### Work packages

| WP | Commit | Executor report | Independent review | Local checks | Actual UI coverage |
| --- | --- | --- | --- | --- | --- |
| A | `50954cc55` | OK | OK | 17 focused + 88 protected tests; types/style/i18n/architecture | Single control, live state, identity, card 61.789px |
| B | `8fbba87b8` | OK | OK | 19 focused + 34 turn tests; types/style/i18n/architecture | Joining appears/disappears; forced reduced-motion has no animation |
| C | `132b78306` | OK | OK | 22 focused tests plus strengthened glyph checks; types/style/i18n/architecture | Header 48px, row 50px, dashed sections, real collapse, ordinary Progress retained |
| D | `df062001a` | OK | OK | 10 tests; types/style/i18n/architecture; viewport code comparison | Nodes 276x86, avatars 32x32, icon toolbar, zoom/pan/refresh/resize |
| E1 | `2e655beaa` | OK | OK | 20 tests; types/architecture; TeamPanel 859 to 843 lines | Covered by E2/final navigation |
| E2 | `e7789f74f` | OK | OK | 78 focused + 38 protected tests; types/style/i18n/architecture | Separate panorama/task/member tabs, repeated-open dedupe, tooltip labels, preserved viewport |
| F1 | `198911637` | OK | OK | 30 tests; types/architecture; normalized extraction comparison | Covered by F3/final; TeamPanel 773 to 616 lines |
| F2 | `25f00d531` | OK | OK | 31 tests; types/style/architecture | Real tools/thinking in F3; no rollback component |
| F3 | `3978f9b8d` | OK | OK | 29 scoped tests; types/style/i18n/architecture | Live final answer without reopening, errors/Retry, actual hit areas, Info/links, state colors |
| G | `400ea2339` | OK | OK | i18n 30 tests/dist; syntax/diff/architecture | Composer profile visible and unclipped with the new copy |

F1 preserved fetch/rendering/brief DOM before F2/F3 changed behavior. All new
TS/TSX modules remain below 500 lines. WorkPanel is 1102 lines (net -5),
TeamPanel 616 (net -243), and AssistantTurn net +1. The other frozen hotspots
were not modified. No IPC, shared contract, Rust, runtime, SDK, or schema changed.

### Final checks on the task candidate

- Scoped renderer tests: **204 passed, 0 failed, 0 skipped**, using `node --test`
  with the following files under `apps/desktop/test/`:
  `team-dispatch`, `team-presentation`, `agent-panorama-viewport`,
  `subagent-progress-panorama`, `team-panel-view`, `work-panel-tabs`,
  `team-work-panel-tab`, `team-panel`, `overview-and-team-drilldown`,
  `team-member-transcript`, `team-member-transcript-runtime`, `renderer-branding`,
  `composer-pickers`, `plan-artifact-resolution`, `work-panel`, `subagent-panel`,
  `sidebar-navigation`, `assistant-turns`, `turn-process`, `subagent-transcript`
  (each with the `.test.mjs` suffix).
- `node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit`: passed.
- `node scripts/check-style-tokens.mjs`: passed.
- `node scripts/check-architecture.mjs --base origin/main`: passed, 17 new TS files.
- `git diff --check origin/main`: passed.
- i18n: `../../node_modules/.bin/vitest run` from `packages/i18n`: **30 passed**;
  `node_modules/.bin/tsc -p packages/i18n/tsconfig.json`: dist rebuilt.
- `../../node_modules/.bin/electron-vite build` from `apps/desktop`: passed.
- Biome changed-path lint processed **zero files** because the existing include
  scope excludes these paths. This is not reported as a passing lint check;
  configuration was not loosened. Types, style guards, tests, and independent
  reviews provide the applicable evidence.

| Required suite (direct command) | Result on `400ea2339` | Saved log |
| --- | --- | --- |
| `node scripts/e2e-team.mjs` | Passed, including both locale/layout matrices | `team.log` |
| `node scripts/e2e-goal-team-renderer-ui.mjs` | Passed, 7 scenarios; card 61.789px | `renderer.log` |
| `node scripts/e2e-work-panel-reorder.mjs` | Passed | `reorder.log` |
| `node scripts/e2e-plan-ui.mjs` | 9 passed, 0 failed; 0 console diagnostics | `plan-ui.log` |
| `node scripts/e2e-composer-mode-menus.mjs` | Passed | `composer.log` |

The optional paid/live-provider Plan case was skipped intentionally. Optional
layout/theme/review suites and `verify:ui:*` were not run. No PR integration
candidate exists because remote delivery was not requested. A later docs-only
execution-record commit does not change this tested executable candidate.

### Approved deviations and STOP resolutions

| WP | Plan item | Resolution | Reason/evidence | Approved by |
| --- | --- | --- | --- | --- |
| A | Allowed files / S1, S9 | Add `scripts/e2e-goal-team-renderer-ui.mjs`; compile bundled CSS with the existing Tailwind compiler | Raw esbuild retained `@theme`, yielding 16px/normal fonts and a 69px card; correct compilation measures 61.789px without changing product CSS or the 58-66 gate | Integrator |
| All applicable | Biome command scope | Preserve include scope and report zero-file limitation | Existing config does not cover changed paths; no guard edits | Integrator |
| C | Appendix B.3 | Add `.team-progress-rows[hidden] { display: none; }` | Author `display:flex` otherwise overrides the browser hidden rule; real collapse checked | Integrator |
| D | E2E selector-only scope | Add node/avatar/toolbar measurements | Needed to prove the prescribed geometry in Electron | Integrator |
| E2 | S2 error-mapping source shape | Extract the same string mapping, retaining caller null guards | Two existing expressions differed syntactically but had the same codes and semantics | Integrator |
| E2 | S9 navigation helper | Unwind the bounded in-panel stack, wait for actual view/tab settlement | One Back reached board rather than aggregate after independent tabs preserved the stack | Integrator |
| E2 | S9 diagnostics/cleanup | Preserve primary errors and always release failed mouse gestures | The second run's resize cleanup masked the primary failure; explicit synchronization and cleanup then passed | Integrator |
| F1 | Source assertion owner | Move both fetch and transcript-label assertions to the extracted component | DOM/fetch/brief normalized comparison remains identical | Integrator |
| F2 | S2 type/prop shapes | Use actual `assistant-turns` export and `answer` kind; optional `isRunning` prop | The named re-export/text/error kinds do not exist; intended rendering is preserved | Integrator |
| F3 | Appendix G type-only imports / allowed files | Reuse pure transcript helpers and add `lib/team-member-transcript-overlay.ts` | Events precede asynchronous persistence, so read-only invalidation can permanently miss final rows | Integrator |
| F3 | Live bounds/lifecycle | Bounded event overlays, semantic acknowledgment, tombstones, generation ownership, restart cleanup | Deterministic tests cover stale reads, replacement, parallel order, errors, disposal/StrictMode, tool metadata and prototype-safe previews | Integrator |
| F3 | C.3 / S7 target geometry | 24px hit areas with local margins; focus-heading clipping removed | Real `elementFromPoint` checks prove upper/lower edges are clickable while headers stay 60/59.25px | Integrator |
| F3 | C.3 / S7 SVG colors | Limit neutral color to direct glyphs and apply member phase colors | Broad descendant rule overrode shared TaskStateGlyph success/error colors; completed colors checked in Electron | Integrator |
| F3 | Error recovery | Retain snapshot error/Retry and last-good transcript in both new tabs | Preserves the previous panel's observable failure behavior; both real read-fault/Retry paths pass | Integrator |
| F3 | Test fault synchronization | Wait for fixture actors to settle before renaming the temporary tasks table | Prevents a read-fault probe from interfering with unrelated active agent execution | Integrator |

Structured live previews preserve tool-result types, paths, exit codes and error
codes; they do not stringify entire result objects. Recent history is bounded to
200 rows and visible text fields to 65,536 characters. Content clipping does not
incorrectly trigger the earlier-history notice. There is no idle polling.

Two E2 Team runs failed and remain documented: the first exposed the single-Back
helper assumption; the second exposed cleanup masking a resize error. The exact
second resize trigger was not recovered after synchronization fixed the run.
Subsequent F3 and final candidate runs passed; it is not classified as the known
Plan UI flake. The final Plan UI run passed first time.

Three mistaken F3 verification invocations are not gate evidence: `pnpm --filter
@pi-desktop/desktop typecheck` was rejected by the symlink task-state protection;
a root-directory Vitest invocation scanned unrelated suites and failed suite
collection; an invented node-test path failed resolution before testing. No
configuration, dependency links or primary files were edited to bypass these
errors. The integrator re-ran the correct package-local Vitest command, and the
normal direct TypeScript checks passed.

### Copy inventory and remaining decisions

Remaining old-name matches are intentional:

- This plan's baseline defect, old-to-new copy table, WP-G instructions and spec
  index retain historical wording.
- `docs/superpowers/plans/assets/expert-team-ux/preview.html`, lines 40/55/60:
  historical related-plan preview.
- `docs/zh-CN/spec/03-runtime/08-error-codes.md`, lines 348/350: architectural
  collaboration prose, not the Composer label.
- `packages/i18n/src/locales/zh-CN/index.ts`, `panel.overview.teamSection`:
  explicitly excluded from this rename.

There are no unresolved implementation STOPs or user decisions blocking local
use. No upcoming/unreleased entry exists in the shipped changelog catalogs;
per §6.4, no version was invented. A localized changelog bullet should be added
when a future release entry/version is selected. Remote publication, merging,
installation and release remain outside this local delivery.

---

## Appendix I — File map

| File | WPs |
| --- | --- |
| `CHAT/TeamDispatchCard.tsx` | A, B, E2 |
| `CHAT/AssistantTurn.tsx` | B |
| `STY/team-dispatch.css` | A, B |
| `LIB/team-dispatch.ts` | A, B |
| `LIB/team-presentation.ts` | A, E2 |
| `LIB/work-panel-tabs.ts` | E2 |
| `LIB/team-panel-view.ts` (new) | E1, E2 |
| `LIB/team-member-transcript.ts` (new) | F2 |
| `TEAM/PixelAvatar.tsx` | A |
| `TEAM/TaskStateGlyph.tsx` (new) | C |
| `TEAM/TeamTaskProgress.tsx` | C, E2 |
| `TEAM/team-work-panel-tab.ts` (new) | E2 |
| `TEAM/TeamWorkPanelSurface.tsx` (new) | E2, F3 |
| `TEAM/TeamPanoramaTab.tsx` (new) | E2 |
| `TEAM/TeamMemberTranscript.tsx` (new) | F1, F2, F3 |
| `TEAM/TeamTaskBrief.tsx` (new) | F1, F3 |
| `TEAM/TeamTaskTab.tsx`, `TEAM/TeamMemberTab.tsx` (new) | F3 |
| `WP/OverviewTab.tsx` | C, E2 |
| `WP/AgentPanorama.tsx`, `agent-panorama-viewport.ts` | D |
| `WP/TeamPanel.tsx` | E1, E2, F1 |
| `WP/WorkPanel.tsx` | E2 |
| `apps/desktop/src/components/icons.tsx` | B, C, D, E2 |
| `STY/work-panel.css` | C |
| `team-panel.css` | C, F2 |
| `STY/agent-panorama.css` | D |
| `STY/team-work-tab.css` (new) | F3 |
| `apps/desktop/src/stores/runtime/team-member-transcript-runtime.ts` (new) | F3 |
| `apps/desktop/src/hooks/useTeamMemberTranscript.ts` (new) | F3 |
| `LOC/` (9 files) | A, B, C, D, E2, F3, G |
| `scripts/e2e/goal-team-renderer-ui.tsx` | A, B, E2 |
| `test:e2e:team` script file | C, D, E2, F3 |
| composer-mode-menus harness + mjs | G |
| `docs/spec/04-ux/08-component-spec.md` | A, B, C, D, E2, F3, G |
| `docs/spec/06-delivery/04-e2e-test-plan.md` | A, B, C, E2, F3, G |
| tests under `TEST/` | per Appendix E |
