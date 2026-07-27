# 08. Plugin Signing and Updates

## 1. Goals

Provide integrity and provenance guarantees for plugin distribution.

Layers:

1. **Checksum**: protect against transfer corruption / tampering (do first)
2. **Signature**: protect against forged provenance (do later)
3. **Update channel**: controlled upgrades

## 2. Verification levels

| Level | Condition | Policy |
|---|---|---|
| L0 | No checksum | Allowed only for dev / local dir |
| L1 | sha256 checksum | Minimum requirement for marketplace downloads |
| L2 | checksum + signature | Required for official / verified plugins (later) |

## 3. Checksum flow

After download:

```text
sha256(file) == downloadInfo.shasum
```

On failure:
- Do not install
- Show "Integrity check failed"
- Record an audit entry

## 4. Signature scheme (implementation details to be frozen later)

Recommended:

- Algorithm: `Ed25519`
- Publisher key pair
- Public key distributed by the marketplace or the publisher
- Signed object: `pluginId + version + shasum`

Example:

```ts
type PluginSignature = {
 alg: "ed25519"
 publisherId: string
 signedAt: string
 payload: {
 pluginId: string
 version: string
 shasum: string
 }
 signature: string // base64
}
```

A failed verification rejects the install / update.

## 5. Publisher trust

```ts
type PublisherTrust = {
 publisherId: string
 displayName: string
 publicKey: string
 level: "official" | "verified" | "community"
}
```

The host maintains:
- A built-in official public key
- User-added custom trusted publishers (advanced)

## 6. Update channels

```ts
type UpdateChannel = "stable" | "beta" | "dev"
```

Rules:
- Default is stable
- beta/dev require an explicit user opt-in
- Versions from different channels must not be blindly downgraded

## 7. Update policy

### Manual update (do first)
- Check for updates
- Show the changelog
- Upgrade after user confirmation

### Automatic update (do later)
Configurable:
- off
- notify-only
- auto-for-official
- auto-all (not recommended as the default)

Automatic updates still go through verification and permission-change review.

## 8. Permission-change review

If a new version adds permissions on upgrade:

1. Block the silent upgrade
2. Show the permission diff
3. Continue after user confirmation

Example:

```text
+ net.fetch
+ fs.write.workspace
```

## 9. Rollback

P2 goal:

- Keep a backup of the previous version
- Automatically roll back on a failed upgrade
- Allow the user to manually revert (same id, older version)

## 10. Security incident response

If a malicious plugin version is discovered:

- The marketplace side can mark it as yanked
- The host rejects it during checkUpdates / install
- Users who already installed it get a risk warning and one-click disable

## 11. Acceptance

1. A mismatched checksum cannot be installed
2. An upgrade that adds permissions prompts the user
3. The official-plugin signature policy has a configurable toggle (during development)
4. Update-check results can be shown in the UI


## 12. Implementation status

Shipped now:

- sha256 checksum verification on marketplace/package install
- update discovery via `market.checkUpdates`
- manual update actions in Plugins UI
- auto-update opt-in per plugin + `market.applyUpdates`
- permission-diff review before upgrades that add capabilities

Still planned:

- mandatory ed25519 signatures
- publisher key management UI
- yank/incident response automation
