# PI-Desktop Docs

`docs/` is a VitePress project. The published site starts at [`index.md`](index.md);
the repository's English technical source of truth remains organized under
`spec/` and `adr/`.

## Local commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

## Entry points

- [English documentation site](index.md)
- [中文入口](zh-CN/index.md)
- [Quick guide](guide/index.md)
- [Specification index](spec/README.md)
- [ADR index](adr/README.md)
- [Plugin development](plugin-development.md)

The Chinese entry point translates orientation and navigation while linking to
the complete English technical specifications, matching the repository's
English-first documentation policy.
