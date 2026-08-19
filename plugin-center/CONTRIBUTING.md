# Publishing a plugin

Your plugin's source stays in your repository. This repository stores the pin,
re-hosts the package, and generates the catalog PI-Desktop reads.

## 1. Build and pin

From your plugin directory, on a clean worktree, at the commit you want to ship:

```bash
git tag v1.0.0
pnpm pi-plugin publish .
```

This packs `dist/<id>-<version>.piplug`, records its SHA-256, resolves your
repository URL, tag, and commit, and writes
`dist/<id>-<version>.submission.json`.

It refuses a dirty worktree — the commit you submit has to describe the bytes
you packed — and refuses a git remote with credentials in it, because the
submission is public data.

## 2. Attach the package to your own release

Upload the `.piplug` to the GitHub release for that tag. Your release is where
the bytes come from; this repository is where users download them, so deleting
your release later cannot change what an already published version resolves to.

## 3. Submit

Send the submission payload to the plugin center. It verifies that you hold
`admin` or `maintain` on the repository through the GitHub App installation,
re-resolves your tag to a commit itself, rebuilds or verifies the package, runs
review, and — only if the policy evaluator approves — publishes.

## Requirements

| Rule | Why |
|---|---|
| `pluginId` is `<publisher>.<name>`, lowercase | The namespace is the ownership claim |
| `pluginId` matches `manifest.id` | The package and the registry must describe one thing |
| Version is plain SemVer | The client compares versions, not ranges |
| A published version is never changed | Correct with a new version; withdraw with a yank |
| `minPiDesktop` is a plain version | The client ignores a bound it cannot parse |
| Every `fs.write` / `fs.delete` declares a scope | Undeclared scope installs to nothing |
| `contributes.skills` requires `agent.prompt.inject` | Skills are inert without it |
| Packages come from `github.com`, `githubusercontent.com`, or `cnb.cool` | The client refuses other hosts |

Run `pi-plugin check .` before publishing; it catches most of these locally.

## Trust tiers

`community` is the tier for any ownership-verified publisher whose release
passed automated review. `verified` is issued by center operators and cannot be
requested in a submission — a value you set is dropped. PI-Desktop downgrades
any `verified` claim it cannot attribute to the official source, so asserting it
yourself achieves nothing.

## Withdrawing a version

Ask the center to yank it and say why. A withdrawn version:

- disappears from install and update selection, including an explicit pick
- stays in version history with your reason, so users holding it understand
- is flagged in the Plugins page of anyone who has it installed

The plugin keeps running for existing users. Withdrawal is a distribution
signal, not permission to disable software somebody is relying on.

Publish the fix as a new version. Never ask for a published version's bytes or
digest to be edited — that breaks the record that makes tampering detectable.

## Permission changes

Adding a permission in a new version triggers a higher-risk review and blocks
automatic updates: users see the diff and accept it themselves. Removing
permissions is not gated. Declare what you use and nothing more; unrecognised
permissions are treated as high risk.
