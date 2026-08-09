import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [autocomplete, autocompleteHook, styles] = await Promise.all([
  read("../src/components/ComposerAutocomplete.tsx"),
  read("../src/lib/use-composer-autocomplete.ts"),
  read("../src/styles/composer-autocomplete.css"),
]);

test("file autocomplete rows keep the path out of the persistent label", () => {
  assert.match(
    autocomplete,
    /const displayName = `\$\{name\}\$\{isDir \? "\/" : ""\}`/,
  );
  assert.match(autocomplete, /className="composer-ac-name">\{displayName\}/);
  assert.doesNotMatch(autocomplete, /composer-ac-path/);
  assert.doesNotMatch(styles, /\.composer-ac-path/);
});

test("file autocomplete preserves path identity for discovery and insertion", () => {
  assert.match(autocomplete, /title=\{item\.entry\.path\}/);
  assert.match(
    autocomplete,
    /aria-label=\{`\$\{displayName\} — \$\{item\.entry\.path\}`\}/,
  );
  assert.match(
    autocompleteHook,
    /formatFileInsert\(item\.entry\.path, item\.entry\.kind\)/,
  );
});
