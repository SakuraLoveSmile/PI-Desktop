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

The Chinese entry point mirrors the English reading paths, translates the
orientation and eight topic landing pages, and links to the same English
technical contracts. This keeps the repository's English-first source policy
without leaving the Chinese site as a partial or disconnected navigation tree.
