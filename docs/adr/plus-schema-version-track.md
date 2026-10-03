# ADR: Plus schema changes run on their own version track

- Status: Accepted
- Date: 2026-10-02
- Updated: 2026-10-03, by the first upstream sync (shared chain at 21)
- Amends: [Temporary Goal sessions own a persistent scratch workspace](temporary-goal-scratch-workspace.md),
  and the storage notes of the Expert Team and Plan/Goal revision records, which
  count their schema changes as versions 20 to 23 of the shared chain

## Context

`PRAGMA user_version` is the migration chain host-core shares with upstream
PI-Desktop. PI-Desktop-Plus forked when that chain stood at 19 and then spent
the next four numbers on Plus-only structures:

| Version | Plus-only change |
|---|---|
| 20 | `plan_approvals.artifact_workspace_kind`, `goal_reports` |
| 21 | `sessions.execution_profile`, `teams`, `team_members`, `team_tasks` |
| 22 | approved execution model binding, Plan revision intent, `plan_execution_schedules` |
| 23 | `plan_approvals.execution_kind` |

Upstream keeps extending the same chain from 19. From that point one number
names two different schemas, and a database file cannot say which line wrote
it. Merging upstream under that arrangement has no safe outcome:

- Keeping the fork's numbers makes upstream's next steps collide with versions
  the fork already owns; an upstream step would skip or misapply on a database
  that stands at a number the fork used for something else.
- Adopting upstream's numbers makes every released fork database, which
  stands at 23, look newer than the build supports. host-core refuses to open
  it and the user sees the downgrade banner instead of their data.
- Fork builds already wrote 20 to 23 into user databases, and two unreleased
  fork branches used 20 for different shapes, so every Plus step already has to
  tolerate a partly applied shape.

## Decision

Reserve `PRAGMA user_version` for the shared upstream chain and give Plus a
second, independent version track in the same database file.

1. **Shared chain.** `SCHEMA_VERSION` follows upstream: it returned to 19, the
   fork point, when the track was introduced, and moves only when upstream
   migrations are merged (21 once the sync that merged upstream's v20 and v21
   landed). A Plus change never advances it and never edits the shared
   baseline DDL (`SCHEMA_LATEST`, `PLAN_APPROVALS_SCHEMA`).
2. **Plus track.** Plus structures are created by an ordered list of additive,
   idempotent steps in `crates/host-core/src/db/plus_schema.rs`, versioned by
   `PLUS_SCHEMA_VERSION` (currently 4). P1 to P4 are the former fork v20 to
   v23 changes with their effect unchanged; Team DDL lives in
   `team/schema.sql`. A new Plus change appends a step and bumps the constant.
   An applied step is not edited.
3. **State.** `plus_schema_meta` holds one row: `plus_version`, and
   `upstream_version`, the `user_version` the last Plus-aware open left
   behind. The Plus track creates the table itself, so the shared DDL stays
   untouched.
4. **Open sequence.** `Database::open` runs two hooks around the unchanged
   shared dispatch.
   - Before it, `reconcile_before_upstream_chain` refuses a database whose
     `plus_version` is newer than the build (`Plus schema version N is newer
     than supported M`, which boot diagnostics treat as the existing downgrade
     refusal), moves a legacy fork database onto the track, and repairs a
     reconciled database that an older fork build advanced back into 20 to 23.
   - After it, `apply_pending` applies the pending Plus steps. It replays all
     of them, which idempotence allows, when the shared version moved during
     this open or since the meta was written, because an upstream step may have
     rebuilt a table that carries Plus columns. It then records the meta, so at
     rest a meta that disagrees with `user_version` means a foreign build
     changed the file.
5. **Legacy reconciliation.** A database with Plus structures, no meta row,
   and `user_version` 20 to 23 is a legacy fork database. After a verified
   backup `pi.sqlite.legacy-v<N>.bak`, one transaction applies every Plus step,
   writes the meta `(4, 19)`, and sets `user_version = 19`. A failure rolls the
   whole transaction back and leaves the legacy database, which the previous
   build still opens.
6. **Repair.** An older fork build that opens a reconciled database re-runs its
   own idempotent v19 to v23 steps and leaves `user_version` at 20 to 23. The
   next open of this build takes `pi.sqlite.repair-v<N>.bak` and restores the
   `user_version` the meta recorded, so rolling a build back and forward keeps
   the data and shows no downgrade banner. Only numbers above this build's own
   `SCHEMA_VERSION` are repaired; the numbers the shared chain has reached are
   upstream's, so a Plus-track database standing there is migrated by the
   chain like any other.
7. **Other backups and fresh installs.** Applying pending Plus steps to an
   existing database that is behind on the track takes
   `pi.sqlite.plus-v<from>.bak` first. A fresh database runs the shared
   baseline DDL, then the Plus steps without a backup, and is stamped with the
   current track version.

## Consequences

- An upstream merge no longer renumbers or collides with Plus data: upstream
  advances `user_version`, Plus advances `plus_version`. Each track refuses a
  newer database on its own, and the boot banner shows the numbers of whichever
  track refused; no IPC field was added.
- Existing user databases migrate once, on first launch of a build with this
  decision: backup, one transaction, `user_version` 23 to 19. The shared chain
  then sees 19 and applies upstream steps normally once they are merged.
- A fork build that predates the track keeps working on a Plus-track database,
  and the next launch of a newer build undoes that build's `user_version`
  change.
- Known limitation: a database above this build's `SCHEMA_VERSION`, at most 23,
  that already has a meta row is read as advanced by an older fork build and is
  repaired. A database a genuine upstream build advanced from a Plus-track file
  cannot be told apart. The two lines default to separate data directories, so
  this needs both pointed at one directory by hand. The window narrows with
  every sync that raises `SCHEMA_VERSION`: with the shared chain at 21 only 22
  and 23 qualify, and the rule closes at 23, after which
  `restore_recorded_upstream_version` is dead code and is removed. The legacy
  range itself (20 to 23) is released history and does not move with
  `SCHEMA_VERSION`; the numbers upstream has reached inside it, 20 and 21
  today, belong to the shared chain. A legacy fork database at one of those
  numbers still has no meta row, so it is reconciled and not repaired.
- Upstream steps that follow the fork point are guarded by tests, not by
  review. `upstream_steps_above_the_fork_baseline_keep_plus_values` and
  `joint_upstream_v20_v21_steps_and_plus_reconciliation_keep_every_plus_value`
  prove that a Plus-track database keeps every Plus column value through the
  upstream steps merged so far, and `legacy_range_numbers_inside_the_shared_chain_are_migrated_not_repaired`
  covers the numbers the two lines share. The fixtures derive older shapes by
  stripping `UPSTREAM_STEPS`, and a coverage test fails when `SCHEMA_VERSION`
  moves past the last listed step. Each later sync that raises `SCHEMA_VERSION`
  appends its steps there, so the tests exercise the new step, and must keep
  the legacy range where it is. A step that rebuilds a table carrying Plus
  columns is the case to watch (the `sessions` rebuild of the v18 to v19 step
  is the existing pattern): the replay re-adds a dropped column but cannot
  restore its values.
- Future Plus-only structural changes use a Plus step. The shared baseline DDL,
  `SCHEMA_VERSION`, and the `user_version` match arms are for upstream changes
  only.

## Alternatives

- Keep numbering Plus changes on `user_version` and renumber upstream's after
  each merge. This forks upstream's history for good and makes every later sync
  solve the same collision again.
- Adopt upstream's numbers and mark Plus data with a flag only. Released v23
  databases would still need `user_version` lowered, which is the
  reconciliation above, but with no track to carry later Plus changes.
- Put Plus tables in a second SQLite file. Plus tables reference `sessions` and
  `plan_approvals`, and host-core's single-writer, single-transaction ownership
  of one database is a frozen storage contract.
