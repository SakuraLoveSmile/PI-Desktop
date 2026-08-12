# 11. asktool Question Card

The asktool card is an inline transcript surface, not a permission dialog. It
uses the existing message width, border, background, typography, and button
tokens so that a paused question feels like part of the conversation.

The header identifies the prompt and shows progress. Small clickable indicators
encode answered, unanswered, skipped, and current state without competing with
the question text. Choice controls use radio semantics for single-select and
checkbox semantics for multi-select. Every question includes a visible custom
input choice. The action row contains Skip and Next/Submit, with Decline all as
a quiet secondary action in the header.

The card has no countdown or expiration copy. On narrow screens options remain
full-width and actions may share the row; question text and custom input may
wrap naturally without clipping.
