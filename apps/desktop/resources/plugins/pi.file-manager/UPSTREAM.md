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
| Marketplace | not published yet — `v0.4.0` is a local tag, so the marketplace still offers 0.3.1 |

> The tag above is **not pushed**: the release exists only in the maintainer's
> checkout, and no marketplace package has been built or uploaded for it. The
> files here are byte-identical to that commit's artifacts. Publishing the tag
> and the marketplace package is a separate, deliberate step; until it happens
> a marketplace-installed 0.3.1 will be replaced by this bundled 0.4.0 on the
> next launch, because this build ships the strictly newer version (ADR 0241).

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

Only one, so a re-sync stays a copy:

- `manifest.json` gains `"license": "MIT"` (after `author`), making the vendored
  copy 9785 bytes
  (`9145f39b6ce7eddf0511a4f1bf1ec0a16412d6f06a81f33b2ddf2f3e67c209bc`). Every
  shipped plugin carries its license, and the upstream manifest predates that
  convention.

## Re-syncing a newer release

1. Check out the new upstream tag and confirm the marketplace entry points at
   the same bytes.
2. Replace the five files above with the tag's copies.
3. Re-apply `"license": "MIT"` to `manifest.json`.
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
