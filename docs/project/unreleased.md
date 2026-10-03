# Unreleased changes

- Expert Team work is easier to follow: queued prompts can be folded, team
  progress and a searchable compact task board show stable member identities,
  live activity refreshes from Host state, and panorama zoom survives updates.
  Member sessions are grouped under their Lead, and approved Plan/Goal runs can
  receive one concise automatic title without changing execution on failure.

- Claude models on a GitHub Copilot account no longer fail with "missing
  required Authorization header". Their Anthropic Messages requests now
  authenticate with `Authorization: Bearer` instead of sending the Copilot
  token as `X-Api-Key`.

- Google Gemini rows send requests again. A provider row on the native
  generative-AI endpoint no longer hands pi-ai's Google adapter the internal
  response-capture `fetch` it refuses before the request leaves, custom provider
  headers still reach Google, and an adapter refusal now fails the turn instead
  of spending all ten transient retries on it (issue #1072).

- Deleting a provider no longer leaves a dangling image-generation default.
  An image default or marked candidate whose provider row is gone is dropped
  on the next settings read or write, instead of staying stored as a binding
  every generation request rejects as an unavailable model.

- Marketplace plugins now appear in a randomized order instead of
  alphabetically.

- macOS DMG and ZIP packages no longer include the obsolete first-launch helper
  and opening-help files.

- Skills now discovers installed pi CLI npm skill packages and offers explicit
  import with a source and executable-extension confirmation. Imported packages
  remain managed in Plugins; discovery never enables code automatically.

- Subagent topology cards and their live process rows now follow the main
  conversation's responsive width behavior: long descriptions, paths,
  commands, and summaries wrap inside the dock instead of requiring repeated
  divider dragging to read them.

- Resuming a subagent no longer selects another definition's private model
  binding. On-demand delegation permissions are checked again on the next parent
  turn, so revoking automatic delegation takes effect without restarting the runtime.
- Trusted extension cancellation now retires SDK commands, tool updates,
  subprocesses and queued or visible prompts. Late hook payload mutations are
  isolated; legitimate long commands and tools retain their runtime budget.

- Copy individual Markdown tables, download them as CSV, or expand them for
  reading without leaving the conversation.

- A stored hosted web-search record that cannot be replayed no longer fails every
  later request in that conversation: the message continues without search replay,
  so histories written before the contract change stay usable.

- Hosted web search now has a complete replay and estimation contract, including
  tool/Task continuation and restart recovery. Context rebuilding preserves
  system-prefix semantics, and structured local preparation failures no longer
  masquerade as retryable provider failures. Existing search histories need no migration.

- Trusted extension startup, shutdown, and notification handlers now have
  bounded waits. Stop cancels pending hook waits before a model request, and
  disposal ignores late results and runs shutdown once. Deferred event
  registrations now appear in plugin diagnostics.

- The Composer reasoning slider now moves smoothly to clicked or
  keyboard-selected levels, follows dragging immediately, and respects
  reduced-motion settings. Rapid clicks redirect the animation; failed saves
  restore the confirmed selection. Opening the menu no longer leaves a
  press-animation offset that jumps on the first selection.
- The reasoning slider's filled track covers the entire starting dot, so
  its left cap no longer leaves a gray half-dot exposed.
- Hovering a reasoning stop or its label highlights the corresponding label.
  Only unfilled dots brighten and enlarge; filled dots and the current thumb
  keep their appearance.
- OpenAI Codex OAuth models can now opt into provider-hosted native web search.
  The feature remains off by default and search history is replayed only for
  the same Codex model.

- Temporary Goal sessions now own their Host scratch workspace: negotiate,
  approve, and execute Goals without a pre-bound project. Proposals and execution
  outputs remain isolated to the owning session scratch directory and survive age
  sweeps for the lifetime of the session. Persisted origin markers preserve
  artifact resolution even after moving to a project. Failed submissions visibly
  terminate with structured errors rather than reporting false completions.

- Goal Completion Reports stay failed when their session's final transcript
  cannot be persisted. A late draft can no longer replace a ready or failed
  report, and another session's pending transcript does not block publication.
