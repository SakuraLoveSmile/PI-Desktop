# PI-Desktop Docs

The current application line is `0.5.6`. The frozen implementation baseline is
`0.4.15`; later additive behavior is recorded in the ADRs and the current
product/runtime specifications. The wire protocol remains v9 and the host
storage schema is v11.

## Guides

- [Plugin development: zero to one](plugin-development.md)
- [Product scope](spec/01-product/01-product-scope.md)
- [UI information architecture](spec/04-ux/01-ui-ia.md)
- [E2E test plan](spec/06-delivery/04-e2e-test-plan.md)

## Spec

Domain-organized specifications.

- Index: `docs/spec/README.md`
- Baseline: `docs/spec/00-baseline.md` (`0.4.15`)
- Current implementation snapshot: [product scope](spec/01-product/01-product-scope.md)

## ADR

Architecture Decision Records.

- Index: `docs/adr/README.md`

## AI Development

Rules for AI-assisted development.

- Workflow: `docs/spec/06-delivery/03-ai-development-workflow.md`
- E2E test plan: `docs/spec/06-delivery/04-e2e-test-plan.md`
- Change checklist: `docs/spec/06-delivery/05-change-checklist.md`
- Agent instructions: `AGENTS.md`

## Decisions

- `docs/spec/08-meta/decisions-log.md`

## Project tracking

- `docs/project/BOARD.md`
- GitHub Issues + Milestones

## Examples

- [`examples/plugins/hello`](../examples/plugins/hello)
