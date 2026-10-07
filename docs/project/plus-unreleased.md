# Plus unreleased changes

Upstream v0.15.6 → v0.16.1 has been merged.

- Expert Team planning consumes supplementary expert messages before publishing
  the plan, preventing research reports from remaining in the composer queue.
  User-queued requests are retained; structured results need no duplicate report.

- Expert Team now requires actual expert delegation, including simple requests.
  Models cannot choose lead_only or authorize work through old solo approvals;
  experts must actually start before substantive Lead execution. Planning
  automatically launches read-only experts; roster confirmation is required only
  when executing the plan.
  Resuming a Team also restarts ordinary queued requests when no Team mail is pending.

- Expert Team work is easier to follow: queued prompts can be folded, team
  progress and a searchable compact task board show stable member identities,
  live activity refreshes from Host state, and panorama zoom survives updates.
  Member sessions are grouped under their Lead, and approved Plan/Goal runs can
  receive one concise automatic title without changing execution on failure.

- Temporary Goal sessions now own their Host scratch workspace: negotiate,
  approve, and execute Goals without a pre-bound project. Proposals and execution
  outputs remain isolated to the owning session scratch directory and survive age
  sweeps for the lifetime of the session. Persisted origin markers preserve
  artifact resolution even after moving to a project. Failed submissions visibly
  terminate with structured errors rather than reporting false completions.

- Goal Completion Reports stay failed when their session's final transcript
  cannot be persisted. A late draft can no longer replace a ready or failed
  report, and another session's pending transcript does not block publication.

- Skills now discovers installed pi CLI npm skill packages and offers explicit
  import with a source and executable-extension confirmation. Imported packages
  remain managed in Plugins; discovery never enables code automatically.

- One-time Plan/Goal schedules allow up to two minutes of delay while the app
  stays running, including sleep/resume. Longer delays are marked missed and
  require Run now confirmation; restarting the app still never catches up.
