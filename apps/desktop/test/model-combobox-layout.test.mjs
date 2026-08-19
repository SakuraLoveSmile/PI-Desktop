import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("model suggestions use a fixed portal overlay", async () => {
  const component = await read(
    "../src/components/settings/ModelCombobox.tsx",
  );
  const styles = await read("../src/styles/providers.css");
  const vendorDialog = await read(
    "../src/components/settings/VendorAccountDialog.tsx",
  );

  assert.match(component, /createPortal\(menu, document\.body\)/);
  assert.match(component, /useState<MenuPosition \| null>\(null\)/);
  assert.match(styles, /\.provider-model-menu \{\s+position: fixed;/);
  assert.match(styles, /\.provider-model-menu\.is-open/);
  assert.doesNotMatch(styles, /provider-model-combo-flow/);
  assert.doesNotMatch(vendorDialog, /flowMenu/);
});
