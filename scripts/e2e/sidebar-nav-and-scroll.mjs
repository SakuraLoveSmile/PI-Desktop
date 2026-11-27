import { setTimeout as delay } from "node:timers/promises";

const NAV_DESTINATIONS = ["new-task", "open-search", "scheduled", "plugins", "context-insights"];

/**
 * Sidebar destinations above the list and the footer's update pill. Row-order,
 * grid and reveal checks read the rendered DOM; a click proves the destination
 * reports the current page.
 */
export async function checkSidebarNavAndScroll({ cdp, check, waitFor }) {
  const rowSelector = (value) =>
    value === "new-task" || value === "open-search"
      ? `.sidebar-nav-row[data-action="${value}"]`
      : `.sidebar-nav-row[data-nav="${value}"]`;
  const originalTheme = await cdp.evaluate("document.documentElement.dataset.theme");
  const point = async (selector) => {
    let target;
    await waitFor(async () => {
      target = await cdp.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        element.scrollIntoView({ block: 'nearest' });
        const box = element.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit === element || element.contains(hit) };
      })()`);
      return target?.hit;
    }, `sidebar nav target is hittable: ${selector}`);
    return target;
  };
  const move = async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await delay(180);
  };
  const click = async (selector) => {
    const target = await point(selector);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount: 1,
    });
  };

  try {
    await waitFor(
      () => cdp.evaluate("document.querySelectorAll('.sidebar-nav-row').length === 5"),
      "the sidebar nav renders five destinations",
    );
    const grid = await cdp.evaluate(`(() => {
      const body = document.querySelector('.sidebar-body');
      const nav = document.querySelector('.sidebar-nav');
      if (!body || !nav) throw new Error('Missing sidebar nav');
      const base = body.getBoundingClientRect().left;
      return [...nav.querySelectorAll('.sidebar-nav-row')].map((row) => {
        const icon = row.querySelector('.sidebar-nav-icon').getBoundingClientRect();
        const label = row.querySelector('.sidebar-nav-label').getBoundingClientRect();
        const hint = row.querySelector('.sidebar-nav-shortcut');
        return {
          destination: row.dataset.action ?? row.dataset.nav ?? null,
          height: Math.round(row.getBoundingClientRect().height),
          iconCenter: icon.left + icon.width / 2 - base,
          labelLeft: label.left - base,
          hintText: hint?.textContent?.trim() ?? '',
          hintOpacity: hint ? getComputedStyle(hint).opacity : null,
        };
      });
    })()`);
    check(
      JSON.stringify(grid.map((row) => row.destination)) === JSON.stringify(NAV_DESTINATIONS) &&
        grid.every((row) => row.height === 28 && Math.abs(row.iconCenter - 24) <= 1 &&
          Math.abs(row.labelLeft - 40) <= 1),
      "the five destinations sit on the 28px row grid with the icon on x=24 and the label at x=40",
      JSON.stringify(grid),
    );
    check(
      grid.slice(0, 2).every((row) => row.hintText.length > 0 && row.hintOpacity === "0") &&
        grid.slice(2).every((row) => row.hintText === ""),
      "only the two shell actions carry a quiet shortcut hint",
      JSON.stringify(grid.map((row) => ({ destination: row.destination, hint: row.hintText, opacity: row.hintOpacity }))),
    );
    const newTaskTarget = await point(rowSelector("new-task"));
    await move(newTaskTarget.x, newTaskTarget.y);
    const hoveredHint = await cdp.evaluate(
      `getComputedStyle(document.querySelector('.sidebar-nav-row[data-action="new-task"] .sidebar-nav-shortcut')).opacity`,
    );
    check(hoveredHint === "1", "a hovered destination reveals its shortcut hint", JSON.stringify({ hoveredHint }));
    await move(600, 120);

    const destinations = await cdp.evaluate(`(() => {
      const counts = {};
      for (const element of document.querySelectorAll('.sidebar [data-nav]')) {
        const value = element.dataset.nav;
        counts[value] = (counts[value] ?? 0) + 1;
      }
      return counts;
    })()`);
    check(
      Object.values(destinations).every((count) => count === 1),
      "each sidebar destination appears once now that the footer is not a second home for them",
      JSON.stringify(destinations),
    );
    check(
      !(await cdp.evaluate("!!document.querySelector('.sidebar-update-pill')")),
      "the footer shows no pill while no update is ready",
    );

    await click('.sidebar-nav-row[data-nav="scheduled"]');
    await waitFor(
      () => cdp.evaluate(
        "document.querySelector('.sidebar-nav-row[data-nav=\"scheduled\"]')?.getAttribute('aria-current') === 'page'",
      ),
      "the scheduled destination reports the current page",
    );
    const current = await cdp.evaluate(
      "[...document.querySelectorAll('.sidebar-nav-row[aria-current=\"page\"]')].map((row) => row.dataset.nav)",
    );
    check(current.length === 1 && current[0] === "scheduled", "exactly one destination is current", JSON.stringify(current));
    await cdp.evaluate('window.__PI_DESKTOP__.setPage("chat")');
    await waitFor(
      () => cdp.evaluate(
        "(() => { const row = document.querySelector('.sidebar-nav-row'); const shell = document.querySelector('.app-chat-shell'); return !!row && !!shell && !shell.hidden; })()",
      ),
      "the chat page returns after the destination check",
    );
    await move(600, 120);
  } finally {
    await cdp.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}; window.dispatchEvent(new Event('focus'))`);
  }
}
