# ADR 0066: Empty home direct bottom composer

- Status: Accepted for implementation
- Date: 2026-08-07
- Deciders: PI-Desktop core
- Amends: D111

## Context

The empty chat home placed contextual prompt buttons between the hero and the
composer. Those controls added an extra decision before the first task and
made the composer part of the scrollable content stack. Optional onboarding
content could therefore push the primary task-entry surface away from the
bottom of the chat area.

## Decision

1. Remove the empty-home contextual quick-action row and its prompt-prefill
   entry points. The empty state does not render a separate row of task
   templates or project-opening buttons.
2. Keep the hero and optional onboarding checklist inside `.home-scroll`, the
   only vertical overflow surface for empty-home content.
3. Render the home composer in a sibling `.home-composer-wrap` after the
   scroller. The wrapper is flex-fixed at the bottom of `home-main-content`
   with the existing content width and bottom spacing, so the composer remains
   visible while the content region scrolls independently.
4. Preserve the checklist's existing inline actions and dismissal behavior.
   Short windows may scroll the checklist, but the composer must not cover it.

## Consequences

- Empty home has one direct task-entry path and less visual noise.
- The composer remains stable at the bottom in both empty-home and transcript
  states.
- Optional onboarding remains reachable without an overlay or a second scroll
  surface.
- Prompt-template localization keys and the unused quick-action styling are no
  longer part of the renderer bundle.

## Alternatives considered

### Keep the quick-action row and only move the composer

Rejected. The requested surface is direct task entry; retaining the buttons
would preserve the extra decision layer and its unused prompt-prefill path.

### Keep the composer inside the scroller and align it with `margin-top: auto`

Rejected. Optional checklist growth would still move the composer, and a
short-window overflow could make the primary input less predictable.

### Absolute-position the home composer over the scroller

Rejected. A bottom overlay can cover checklist rows unless every content block
reserves and tracks the composer's changing multi-line height.

## References

- `docs/spec/04-ux/01-ui-ia.md`
- `docs/spec/04-ux/07-ui-design-system.md`
- `docs/spec/04-ux/08-component-spec.md`
- `docs/spec/06-delivery/04-e2e-test-plan.md` (E2E-063, US-UI-31, US-UI-64)
- `docs/spec/08-meta/decisions-log.md` (D111, D131, D204)
