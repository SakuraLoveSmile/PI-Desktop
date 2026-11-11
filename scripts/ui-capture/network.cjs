const { relative, isAbsolute } = require("node:path");
const { fileURLToPath } = require("node:url");

function isFixtureRequest(url, bundle) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (!url.startsWith("file:")) return false;
  try {
    const rel = relative(bundle, fileURLToPath(url));
    return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
  } catch { return false; }
}

module.exports = { isFixtureRequest };
