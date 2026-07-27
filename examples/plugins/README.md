# Example Plugins

Sample plugins for specification and future integration tests.

## hello

Minimal example covering:

- `commands`
- `ui.panel`
- `agentTools`
- `skills`
- `settings`
- `permissions`

Related specs:

- `docs/spec/07-plugins/01-plugin-system.md`
- `docs/spec/07-plugins/02-plugin-manifest-schema.md`
- `docs/spec/07-plugins/03-plugin-api.md`
- `docs/spec/07-plugins/05-plugin-lifecycle.md`
- `docs/spec/07-plugins/09-plugin-command-palette.md`

## Planned examples

- `panel-basic`
- `agent-tool-basic`
- `skill-pack`
- `marketplace-mock-publisher`

## Official marketplace repository

Published plugins live in [`vastsa/pi-desktop-plugins`](https://github.com/vastsa/pi-desktop-plugins).

Local examples here remain useful for development loading (`Load dev plugin`).
Marketplace installs should come from that repository's `catalog.json` + `packages/*.piplug`.

