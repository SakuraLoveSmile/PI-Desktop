/**
 * `packages/*` manifests keep the version of the upstream tree they were last
 * synced from (ADR plus-version-line), so they are not release surfaces.
 */
export function isUpstreamTrackedPackage(relPath) {
  return relPath.replaceAll("\\", "/").startsWith("packages/");
}

/**
 * Version failures across workspace manifests (`{ relPath, version }`).
 *
 * App surfaces (root, docs, apps/*) carry the Plus release line and must equal
 * `surfaceVersion`. `packages/*` only have to agree with each other: the most
 * common version is the reference, so a single stray manifest is the one
 * reported.
 */
export function workspaceVersionFailures(manifests, surfaceVersion) {
  const failures = [];
  const upstreamTracked = [];
  for (const { relPath, version } of manifests) {
    if (isUpstreamTrackedPackage(relPath)) {
      upstreamTracked.push({ relPath, version });
    } else if (version !== surfaceVersion) {
      failures.push({ relPath, message: `version is ${version}, expected ${surfaceVersion}` });
    }
  }

  const counts = new Map();
  for (const { version } of upstreamTracked) counts.set(version, (counts.get(version) ?? 0) + 1);
  const [reference] =
    [...counts.entries()].sort(
      ([versionA, countA], [versionB, countB]) =>
        countB - countA || String(versionA).localeCompare(String(versionB)),
    )[0] ?? [];
  for (const { relPath, version } of upstreamTracked) {
    if (version !== reference) {
      failures.push({
        relPath,
        message: `version is ${version}, expected ${reference} (packages/* must agree with each other)`,
      });
    }
  }
  return failures;
}

export function resolveReleaseDocumentCheck(currentVersion, requestedVersion) {
  const documentVersion = requestedVersion ?? currentVersion;
  const isPrereleasePreview =
    requestedVersion !== undefined &&
    currentVersion !== documentVersion &&
    currentVersion.startsWith(`${documentVersion}-`);

  return {
    documentVersion,
    surfaceVersion: isPrereleasePreview ? currentVersion : documentVersion,
    isPrereleasePreview,
  };
}
