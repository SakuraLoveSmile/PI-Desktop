import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("tablist controls expose stable ids and point to their matching panels", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  try {
    const { SegmentedControl } = await server.ssrLoadModule("/src/components/ui.tsx");
    const options = [
      {
        value: "ssh",
        label: "SSH",
        id: "remote-host-add-tab-ssh",
        controls: "remote-host-add-panel-ssh",
      },
      {
        value: "pair",
        label: "Pair",
        id: "remote-host-add-tab-pair",
        controls: "remote-host-add-panel-pair",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(SegmentedControl, {
          value: "ssh",
          onChange() {},
          options,
          label: "Add method",
          role: "tablist",
        }),
        ...options.map(({ value }) =>
          createElement("form", {
            id: `remote-host-add-panel-${value}`,
            role: "tabpanel",
            "aria-labelledby": `remote-host-add-tab-${value}`,
            hidden: value !== "ssh",
          }),
        ),
      ),
    );

    assert.match(
      html,
      /role="tab" id="remote-host-add-tab-ssh" aria-controls="remote-host-add-panel-ssh" aria-selected="true"/,
    );
    assert.match(
      html,
      /role="tab" id="remote-host-add-tab-pair" aria-controls="remote-host-add-panel-pair" aria-selected="false"/,
    );
    assert.match(html, /id="remote-host-add-panel-ssh" role="tabpanel" aria-labelledby="remote-host-add-tab-ssh"/);
    assert.match(html, /id="remote-host-add-panel-pair" role="tabpanel" aria-labelledby="remote-host-add-tab-pair" hidden=""/);

    const control = SegmentedControl({
      value: "ssh",
      onChange(value) {
        selected = value;
      },
      options,
      label: "Add method",
      role: "tablist",
    });
    let selected = "ssh";
    const buttons = control.props.children;
    assert.equal(buttons[0].props.tabIndex, 0);
    assert.equal(buttons[1].props.tabIndex, -1);
    const focused = [];
    const fakeTabs = options.map((_option, index) => ({
      focus() {
        focused.push(index);
      },
    }));
    const press = (buttonIndex, key) => {
      let prevented = false;
      buttons[buttonIndex].props.onKeyDown({
        key,
        preventDefault() {
          prevented = true;
        },
        currentTarget: {
          parentElement: {
            querySelectorAll() {
              return fakeTabs;
            },
          },
        },
      });
      assert.equal(prevented, true, `${key} should be handled`);
    };

    press(0, "ArrowRight");
    assert.equal(selected, "pair");
    assert.deepEqual(focused, [1]);
    press(1, "ArrowRight");
    assert.equal(selected, "ssh");
    assert.deepEqual(focused, [1, 0]);
    press(0, "ArrowLeft");
    assert.equal(selected, "pair");
    assert.deepEqual(focused, [1, 0, 1]);
    press(1, "Home");
    assert.equal(selected, "ssh");
    assert.deepEqual(focused, [1, 0, 1, 0]);
    press(0, "End");
    assert.equal(selected, "pair");
    assert.deepEqual(focused, [1, 0, 1, 0, 1]);

    const translatedHtml = renderToStaticMarkup(
      createElement(SegmentedControl, {
        value: "ssh",
        onChange() {},
        options,
        label: "添加方式",
        role: "tablist",
      }),
    );
    assert.match(translatedHtml, /id="remote-host-add-tab-ssh"/);
    assert.match(translatedHtml, /aria-controls="remote-host-add-panel-ssh"/);

    const disabledControl = SegmentedControl({
      value: "ssh",
      onChange() {},
      options,
      label: "Add method",
      role: "tablist",
      disabled: true,
    });
    assert.ok(disabledControl.props.children.every((button) => button.props.disabled));
  } finally {
    await server.close();
  }
});
