# Vendored upstream

`pi.file-manager` is a third-party plugin that also ships through the official
marketplace. This directory is a vendored copy of one released version, so that
every installation has a file view out of the box (ADR 0241).

## Origin

| Field | Value |
| --- | --- |
| Repository | https://github.com/Tioit-Wang/pi-desktop-plugin-file-manager |
| Tag | `v0.5.0` |
| Commit | `cbd47b09bcad6a47edd093f82b3d037a533e3cfd` |
| License | MIT (see `LICENSE`; upstream ships no license file) |
| Marketplace | published to the plugin center at <https://plugins.aiuo.net/console/publish/upload>: `pi.file-manager` 0.5.0, audit passed, artifact `e130e5d523d1e85be3624a6df152c87ddd69d328328aaf31455e4d3b456ac21b` (1460284 bytes) |

The tag is pushed and the release is published, so a marketplace-installed 0.4.0
is now offered 0.5.0 from the marketplace as well as from this bundled copy.
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
| `main.js` | 62931 | `e8941a31ada06b18264e509df01d0e4023744b819f185a26da25c7925f0ac03e` |
| `README.md` | 19698 | `04f0a028fd8106a4b7e575f6e27b96bbd3fe7d32ea859429d364f05c13f2acf0` |
| `views/index.html` | 345 | `771fd3d8afdea7fca75ed1f1918c1ce93ad1c87babdb321cfb85e910465cd2c1` |
| `views/assets/index.js` | 1345101 | `36121f1e6a92d4615e086ea591576240f2a5a7d8eb3664db3ca2a231c4e93ccc` |
| `manifest.json` | 13026 | `8ec56c0dcfa36cd5a929f22b8e95e47e73690033db24d401b3c2ba20f9cc0460` |

`views-src/` from the upstream repository is deliberately not vendored: this
directory carries the built view the plugin publishes, not its React source.

## Local changes

Two, so a re-sync stays a copy:

- `manifest.json` gains `"license": "MIT"` (after `author`), making the vendored
  copy 13046 bytes
  (`a672b93d3339c6d38fd351201ead684ddc014ea8cae1a094538686f75a622bfe`). Every
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
   tag's copies, **as LF**: `git archive` applies the checkout's line-ending
   conversion, so extract the blobs from the working tree (or with
   `git cat-file blob`) instead of from an archive.
3. Re-apply `"license": "MIT"` to `manifest.json`, and re-create
   `package.json` — the marker is local and the tag does not carry it.
4. Update `Origin`, the checksum table and the release section here, and the
   commit hash `bundled-plugins.test.mjs` pins, then run
   `node --test test/bundled-plugins.test.mjs` in `apps/desktop`.
5. Leave the version in `manifest.json` untouched: it is the upstream version,
   and the marketplace offers an update from it.

## What 0.5.0 adds

A project can be a group of local folder roots, and the view now learns that:
`pi.workspace.get()` and the `workspace:changed` event carry `projectId` and
`roots` (`{ path, name, primary }[]`, group order, primary first) beside the
unchanged `path` / `name`. The folder name in the view's header becomes a switcher
when the group holds more than one folder, and the choice is remembered per project
in the view's own `prefs.projectRoots` — it never changes the workspace, the agent's
tool roots, a session's primary path or project instructions.

The containment base is still exactly one registered root at a time, never the
union of the group: listing, reading, writing, search and SQLite all resolve against
the selected folder, with the same symlink and junction refusals and the same
credential deny list. An absolute path the host asks this view to open that lies
under another folder of the same project switches the base to that folder first and
is then resolved relative to it — which is what lets a chat file reference that
completes into a sibling folder open in the view instead of as an external file.

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
