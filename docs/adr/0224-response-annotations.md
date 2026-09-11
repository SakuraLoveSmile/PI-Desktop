# ADR 0224: Response Annotations as Prompt Attachments

- Status: Accepted
- Date: 2026-09-11
- Deciders: PI-Desktop runtime and desktop UI maintainers
- Amends: D398 decision 3 (for assistant turns)
- Preserves: D209, D301, D097, D128
- Related: [04-ux/08-component-spec.md](../spec/04-ux/08-component-spec.md) ·
  [04-ux/09-interaction-patterns.md](../spec/04-ux/09-interaction-patterns.md) ·
  [03-runtime/11-provider-model-system.md](../spec/03-runtime/11-provider-model-system.md) ·
  ADR 0223 · E2E-257, E2E-258

## Context

ADR 0223 (D398) made quoting a **draft edit**: the excerpt becomes `> `-prefixed
Markdown text inside the composer, attributed with `chat.quoteSource`. That is
simple and visible, but it copies the model's words into the draft the user is
writing, and it makes "refer to this pass" indistinguishable from "write this
text myself". Reusing several passes mixes excerpts and instructions in one
editable buffer, and a long answer can be quoted only as one block.

The reference implementation (ChatGPT desktop app) solves the same problem with
**annotations**. Selecting text in a response and choosing "Add to chat" attaches
a numbered annotation to that response: the annotated pass gains an inline
numbered marker, the composer shows one annotation attachment, and the next
prompt carries the excerpts in a structured block:

```text
# Response annotations:
Each item contains text selected from an earlier Codex response and may include a user comment. …
<response-annotations>
[{"text":"…","annotation":"…","source":{…}}]
</response-annotations>

## My request:
…the user's own prompt…
```

The user's own words stay the user's own words; the excerpts travel with the
prompt as data, numbered so the model can address `Annotation 1`,
`Annotation 2`, and so on.

## Decision

1. Selecting text inside an **assistant turn** and activating the selection
   overlay's **Add to chat** creates one annotation instead of editing the draft.
   An annotation carries an id, the anchored turn (`messageId`), the excerpt
   (Markdown, capped at 2000 characters with a trailing ellipsis), an empty
   `annotation` comment field, and a creation time.
2. Annotations are **renderer-owned session state**, keyed by session id, in
   capture order. Array order is the numbering: the first annotation is
   `Annotation 1`. Re-annotating an excerpt that is already attached is a no-op,
   so no excerpt is sent twice under two numbers. Annotations are not persisted,
   not sent to the host on their own, and do not survive relaunch.
3. Rendering:
   - The anchored turn draws an inline numbered marker at the end of the
     annotated pass. The marker is produced by the markdown pipeline: the
     excerpt's position is located in the turn's source text, the token
     `:codex-annotation{index="N"}` is injected there, and a remark pass turns
     that token into a numbered marker element whose tooltip is the excerpt. An
     excerpt that does not appear verbatim (a rendered table row, a code fence)
     gets no marker; the attachment chip still lists it. One annotation marks one
     occurrence, never two.
   - The composer shows one annotation attachment chip above the input with the
     count (`chat.annotationChip`) whose tooltip lists `N. excerpt` per
     annotation, plus one control that drops them all
     (`chat.clearAnnotations`). The chip is not a draft chip: it never enters the
     editable text, so D209's smart Stop and D301's per-session draft retention
     are untouched.
4. Sending a prompt while annotations exist composes the prompt as the reference
   does: the `# Response annotations:` heading, the instruction sentence, the
   `<response-annotations>` block with `[{"text", "annotation", "source": {"messageId"}}]`
   in numbering order, then `## My request:` and the user's text. The send
   consumes the annotations. The visible draft, the optimistic row, the sidebar
   title, and the composer's edit seed never contain the block; a stored prompt
   that carries one is displayed through `requestTextWithoutAnnotations`, which
   reduces it back to the request.
5. The instruction sentence omits the reference's inline-directive requirement
   (`:codex-annotation{index="N"}` in the model's answer) because this app does
   not ask the model to cite annotations yet; the token is still the marker
   syntax, so an answer that echoes one renders as a marker instead of raw text.
6. Routing stays explicit per surface: the overlay's **Add to chat** annotates an
   assistant turn and keeps D398's draft quote for any other row; the assistant
   turn's action row annotates (its selection when there is one, the whole answer
   otherwise); a user message's action row and the side chat's **Add to main
   chat** keep quoting into the draft.
7. i18n keys introduced: `chat.annotate`, `chat.annotationMarker`,
   `chat.annotationChip`, `chat.clearAnnotations`. The overlay's other actions
   (`chat.addToChat`, `chat.askInSideChat`, `chat.copy`) are unchanged.
8. Boundaries: no host protocol bump (v11), no storage schema change (v15), no
   new IPC channel, and no new permission. Annotations are a renderer-side
   projection of the reference contract; the prompt that reaches the model is
   ordinary prompt text.

## Preserved behavior

- D398's draft quote is preserved where it is the right model: quoting a **user**
  message, and moving a side chat's newest answer into the main composer. Its
  contract (`> ` blockquote, `chat.quoteSource` attribution, 2000-character cap,
  append-to-draft, focus, no send) is unchanged.
- D209's smart Stop restores the pre-send draft, and D301's per-session draft
  slots are unchanged: annotations are session state beside the draft, so neither
  path has to learn about them.
- The selection overlay's geometry, bounds, follow-on-scroll behavior, actions,
  and read-only-projection exclusion are unchanged (ADR 0223 amendment).

## Consequences

- The model receives each annotated pass as a numbered data item, so "address
  annotation 2" is unambiguous, and the user's prompt stays exactly what the user
  typed.
- A user can annotate several passes of one answer, from any turn in the session,
  and then write one instruction that covers them; the composer shows one
  attachment instead of a growing block of quoted text.
- Annotations are lost on relaunch and after the send that carries them; a user
  who wants a durable record can still quote into the draft or copy the pass.
- A stored prompt is longer than what the user typed (the block is part of it),
  which is why every display surface reduces it back to the request first.

## Alternatives considered

- **Keep writing excerpts into the draft (D398):** rejected for assistant turns.
  It mixes the model's words into the user's own prompt text, and several
  references become one long editable block with no numbering the model can
  address.
- **Annotate through the host (new RPC or message field):** rejected. The prompt
  block is ordinary prompt text, so no protocol, schema, or permission change is
  needed, and the annotations only have to live as long as the send.
- **Draw the marker by wrapping the annotated text in the DOM:** rejected. React
  owns the transcript tree, and text surgery around memoized markdown blocks
  breaks on re-render; injecting a token into the source keeps the marker a
  normal render result.
- **Store the annotations with the message for a persistent list:** rejected for
  now. It would need a storage-schema change and a durable annotation surface;
  the send-scoped attachment matches the reference behavior.
