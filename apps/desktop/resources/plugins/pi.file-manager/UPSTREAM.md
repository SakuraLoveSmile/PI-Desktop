# Vendored upstream

`pi.file-manager` is a third-party plugin that also ships through the official
marketplace. This directory is a vendored copy of one released version, so that
every installation has a file view out of the box (ADR 0241).

## Origin

| Field | Value |
| --- | --- |
| Repository | https://github.com/Tioit-Wang/pi-desktop-plugin-file-manager |
| Tag | `v0.4.0` |
| Commit | `6c7ee2fc2744e7af5a16be9b9c9cab6a9956830f` |
| License | MIT (see `LICENSE`; upstream ships no license file) |
| Marketplace | published to the plugin center at <https://plugins.aiuo.net/console/publish/upload>: `pi.file-manager` 0.4.0, audit passed, artifact `a8cbfd5a0c31c8685fb7d9ed2e0c57bcbd5871dcbbb701382bfaecfbc5ae83b` (1433256 bytes) |

The tag is pushed and the release is published, so a marketplace-installed 0.3.1
is now offered 0.4.0 from the marketplace as well as from this bundled copy.
Both paths ship the same bytes.

> The published `.piplug` contains the seven files a plugin installs from
> (`manifest.json`, `main.js`, `README.md`, `CHANGELOG.md`, `.gitignore`,
> `views/index.html`, `views/assets/index.js`) and **not** `views-src/`: the
> artifact ships the built view, never its React source. `pi-plugin pack` on the
> repository root includes `views-src/`, and the plugin center's audit rejects
> such a package as four blockers before it can be submitted — pack from a copy
> of the tagged tree with `views-src/` removed instead.

The files below are byte-identical to that commit, except for the one manifest
field listed under local changes. Line endings are LF: the upstream commit
stores LF, and this repository's `.gitattributes` keeps it that way.

## Upstream checksums (sha256)

| File | Bytes | sha256 |
| --- | --- | --- |
| `main.js` | 51876 | `1c73578170e1f80db8cbe1dd68f81d0a718edf20f8319c67ca330de86f61e001` |
| `README.md` | 16267 | `209722413b16dcd5c96e5e4b239f0e9facad7643d8fc204c825313467ff277f8` |
| `views/index.html` | 345 | `771fd3d8afdea7fca75ed1f1918c1ce93ad1c87babdb321cfb85e910465cd2c1` |
| `views/assets/index.js` | 1340220 | `f8f04492324e929980504cd783d475565c0887872824d87c131f799632295c76` |
| `manifest.json` | 9765 | `81077974286c0c5bd934abaa31dce851d075fcaef183f400e07f4a27f620de5b` |

`views-src/` from the upstream repository is deliberately not vendored: this
directory carries the built view the plugin publishes, not its React source.

## Local changes

Two, so a re-sync stays a copy:

- `manifest.json` gains `"license": "MIT"` (after `author`), making the vendored
  copy 9785 bytes
  (`9145f39b6ce7eddf0511a4f1bf1ec0a16412d6f06a81f33b2ddf2f3e67c209bc`). Every
  shipped plugin carries its license, and the upstream manifest predates that
  convention.
- `package.json` is **added**, containing `{"type": "commonjs"}`. It is not in
  the upstream release and not in the published `.piplug`. `main.js` is
  CommonJS, and `apps/desktop/package.json` declares `"type": "module"`, so in
  a checkout every `.js` beneath it — this one included — is classified as ESM
  and the host's `require()` fails with "require is not defined in ES module
  scope". The marker is Node's own mechanism for that and scopes the correction
  to this plugin alone; `pi.browser` is ESM and must keep inheriting the
  ancestor's `"module"`, which is why the marker cannot live one directory up.
  In a packaged app the file is inert, and deleting it only costs the developer
  experience, never a user.

## Re-syncing a newer release

1. Check out the new upstream tag and confirm the marketplace entry points at
   the same bytes.
2. Replace the four upstream files above (`main.js`, `README.md`,
   `views/index.html`, `views/assets/index.js`) plus `manifest.json` with the
   tag's copies.
3. Re-apply `"license": "MIT"` to `manifest.json`, and re-create
   `package.json` — the marker is local and the tag does not carry it.
4. Update `Origin` and the checksum table here, then run
   `node --test test/bundled-plugins.test.mjs` in `apps/desktop`.
5. Leave the version in `manifest.json` untouched: it is the upstream version,
   and the marketplace offers an update from it.

## What 0.4.0 adds

The host can hand a contributed view one file to show: the reference travels as
the view entry URL's `piViewOpen` query parameter on creation, and as the
`view:open` preload event once the view is loaded. A chat file reference uses
that to open in this view instead of the host file tab, and the view collapses
its own left file list when the host asks it to show a file. The view also
accepts absolute paths outside the project root — the session scratch and
attachment stores the host itself picked — which is why its `safetyNotes`
discloses that exception instead of claiming the project-root containment still
covers everything it reads.
