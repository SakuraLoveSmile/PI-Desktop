# 11. asktool Question Card

The asktool card is an inline composer approval surface, not a permission
dialog. It is mounted in the same dock area as the Plan and Goal approval card,
immediately above the composer input, so a paused question stays available at
the active decision point instead of moving into transcript history.

It uses the existing message width, border, background, and button tokens so
that a paused question remains visually part of the conversation. The question
text matches the chat body size (`--text-base`, 14 px) at medium weight, so it
reads as the card's primary focal point without out-sizing the surrounding
transcript. Options and the custom input use the same body size, keeping the
card's content aligned with the conversation scale.

The header identifies the prompt and shows progress. Small clickable indicators
encode answered, unanswered, skipped, and current state without competing with
the question text. Choice controls use radio semantics for single-select and
checkbox semantics for multi-select. Every question includes a visible custom
input choice. The action row contains Skip and Next/Submit, with Decline all as
a quiet secondary action in the header.

The card has no countdown or expiration copy. On narrow screens options remain
full-width and actions may share the row; question text and custom input may
wrap naturally without clipping.

## Typography hierarchy

The card uses a clear four-level type ramp to avoid the visual noise of
too many similar sizes:

| Element              | Token              | Size    | Weight     | Notes                       |
|----------------------|--------------------|---------|------------|-----------------------------|
| Card title           | `--text-xs`        | 11 px   | medium     | Uppercase, wide tracking    |
| Question number      | `--text-xs`        | 11 px   | medium     | Wide tracking, eyebrow role |
| Progress             | `--text-2xs`       | 10.5 px | —          | Faint, most subtle          |
| Question text        | `--text-base`      | 14 px   | medium     | Primary focal point         |
| Option text          | `--text-base`      | 14 px   | —          | Matches chat body           |
| Option mark          | `--text-xs-plus`   | 11.5 px | —          | Proportional to option text |
| Custom input text    | `--text-base`      | 14 px   | —          | Matches option text         |
| Decline button       | `--text-xs`        | 11 px   | —          | Quiet secondary action      |
