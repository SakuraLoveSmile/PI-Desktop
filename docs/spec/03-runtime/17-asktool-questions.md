# 17. asktool Interactive Questions

## 1. Purpose

`asktool` lets the model pause a turn and ask the user one or more bounded
questions. It is available in Agent, Plan, and Goal mode and is separate from
permission approval: it does not authorize an operation and has no validity
deadline.

## 2. Request shape

The tool accepts a non-empty `questions` array. Each question contains:

- `question`: the prompt text;
- `options`: one or more selectable answer labels, each either a string or an
  object with a required `label` and optional `description`;
- `multiSelect`: optional; when true, more than one selectable answer is allowed.

Plain string options remain supported. The card shows an object's description
as secondary text, while selection and the model-facing answer continue to use
only its label. The desktop card always adds one extra `Enter another answer`
option with a text field. The model does not need to add a special free-text
choice to the tool arguments.

## 3. Card interaction

Only one question is shown at a time. A small indicator is rendered for every
question and uses three states: unanswered, answered, and skipped. Selecting an
indicator revisits that question. `Next` records an answer when one exists;
otherwise it records a skip. `Skip` explicitly records a skip and advances.
`Decline all` resolves every question as skipped.

There is no timer, countdown, or automatic expiration. The card remains pending
until the user submits or the turn is stopped. If the turn is stopped while a
card is open, the runtime resolves every remaining question as skipped.

When an ask arrives, the app shows an in-app toast containing the session and
first question, in addition to the existing native notification policy for
background sessions. The ask event plays one soft in-app chime; its toast does
not play a second one.

## 4. Tool output

The response is the normal tool result returned to the model and persisted with
the tool row. For each question, the content is serialized as:

```text
question text：answer label 1、answer label 2
```

Multiple questions are separated by `\n---\n`. A skipped or unanswered
question keeps the question text and uses an empty placeholder:

```text
question text：
```

This format is deterministic, preserves question order, and makes multi-select
answers distinguishable without exposing a renderer-only state object to the
model.
