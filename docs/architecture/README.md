# Architecture budgets

The scripts/check-architecture.mjs checker reports the source-file count, total
physical line count, largest source files, and the >500, >1000, and >2000 LOC
threshold counts for tracked source under apps/, packages/, crates/, and
scripts/. Generated output, dependency trees, and build directories are
excluded.

The checker enforces these limits:

- apps/desktop/electron/main/index.ts is at most 1500 LOC.
- apps/desktop/src/stores/app-store.ts is at most 1000 LOC.
- A newly added ordinary TypeScript or TSX source file is at most 800 LOC,
  unless it has a reasoned entry under typescript in allowlist.json.
- Every Rust source file above 1000 LOC has a reasoned entry under rust in
  allowlist.json.

The Rust entries currently document legacy modules that were outside the
follow-up split scope. New Rust domain files are expected to remain below the
limit. An allowlist entry records an explicit debt boundary; it does not raise
the general limit for future files.

A file that a sync merge brings in byte-identical from vastsa/PI-Desktop counts
as newly added here. If it is over the limit it is listed with that reason
instead of being split, because a split here would conflict with every later
sync; any decomposition lands upstream first.
