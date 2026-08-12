# 11. asktool Question Card

The asktool card is an inline composer approval surface, not a permission
dialog. It is mounted in the same dock area as the Plan and Goal approval card,
immediately above the composer input, so a paused question stays available at
the active decision point instead of moving into transcript history.

It uses the existing message width, border, background, typography, and button
tokens so that a paused question remains visually part of the conversation.

The header identifies the prompt and shows progress. Small clickable indicators
encode answered, unanswered, skipped, and current state without competing with
the question text. Choice controls use radio semantics for single-select and
checkbox semantics for multi-select. Every question includes a visible custom
input choice. The action row contains Skip and Next/Submit, with Decline all as
a quiet secondary action in the header.

The card has no countdown or expiration copy. On narrow screens options remain
full-width and actions may share the row; question text and custom input may
wrap naturally without clipping.
