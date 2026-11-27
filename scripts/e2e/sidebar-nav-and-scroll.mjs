import { setTimeout as delay } from "node:timers/promises";

const NAV_DESTINATIONS = ["new-task", "open-search", "scheduled", "plugins", "context-insights"];

/**
 * Sidebar destinations above the list and the footer's update pill. Row-order,
 * grid and reveal checks read the rendered DOM; a click proves the destination
 * reports the current page.
 */
export async function checkSidebarNavAndScroll({ cdp, check, waitFor, seed }) {
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

    // One scroll region for the pins, the session list and the projects.
    const scroller = await cdp.evaluate(`(() => {
      const body = document.querySelector('.sidebar-body');
      if (!body) throw new Error('Missing sidebar body');
      const scrollers = [...body.querySelectorAll('*')].filter((element) => {
        const style = getComputedStyle(element);
        return style.overflowY === 'auto' || style.overflowY === 'scroll';
      });
      return { count: scrollers.length, classes: scrollers.map((element) => element.className) };
    })()`);
    check(
      scroller.count === 1 && String(scroller.classes[0]).includes('sidebar-scroll'),
      'the sidebar has exactly one vertical scroller and it is the shared region',
      JSON.stringify(scroller),
    );

    const lists = await cdp.evaluate(`(() => {
      const read = (selector) => {
        const body = document.querySelector(selector);
        if (!body) return null;
        const rows = [...body.querySelectorAll('[data-sidebar-session-row]')];
        const box = body.getBoundingClientRect();
        return {
          maxHeight: getComputedStyle(body).maxHeight,
          rows: rows.length,
          rowsInside: rows.filter((row) => row.getBoundingClientRect().bottom <= box.bottom + 0.5).length,
        };
      };
      return {
        pinned: read('.sidebar-session-group-body.pinned'),
        standalone: read('.sidebar-session-group-body.standalone'),
      };
    })()`);
    check(
      lists.pinned?.maxHeight === 'none' &&
        lists.pinned.rows === seed.pinnedSessionIds.length &&
        lists.pinned.rowsInside === lists.pinned.rows &&
        lists.standalone?.maxHeight === 'none',
      'every pin shows and neither section caps its own height',
      JSON.stringify(lists),
    );

    const shortList = await cdp.evaluate(`(() => {
      const body = document.querySelector('.sidebar-session-group-body.standalone');
      return {
        rows: body.querySelectorAll('[data-sidebar-session-row]').length,
        more: body.querySelector('.sidebar-load-more')?.textContent?.trim() ?? null,
      };
    })()`);
    check(
      shortList.rows === 5 && Boolean(shortList.more),
      'the session section shows five rows and counts the rest behind load-more',
      JSON.stringify(shortList),
    );
    await click('.sidebar-session-group-body.standalone .sidebar-load-more');
    await waitFor(
      () => cdp.evaluate(
        "document.querySelectorAll('.sidebar-session-group-body.standalone [data-sidebar-session-row]').length === 7",
      ),
      'the load-more row expands the session section',
    );
    const expandedRows = await cdp.evaluate(
      "document.querySelectorAll('.sidebar-session-group-body.standalone [data-sidebar-session-row]').length",
    );
    check(expandedRows === 7, 'the session section expands to every seeded row', JSON.stringify({ rows: expandedRows }));

    // A folded project reports the activity it hides. The seeded suite starts no
    // live turn, so the probe element carries the same class and hint contract
    // the store-driven span uses; the state wiring is covered by the SSR test.
    const betaGroup = `[data-sidebar-project-group=${JSON.stringify(seed.paths.beta)}]`;
    await click(`${betaGroup} .project-toggle`);
    await waitFor(
      () => cdp.evaluate(
        `document.querySelector(${JSON.stringify(betaGroup + ' .sidebar-session-group-body')})?.classList.contains('collapsed')`,
      ),
      'the beta project folds',
    );
    // The click left the pointer on the header; move it off so the probe is
    // measured in the resting state it describes.
    await move(600, 120);
    const hintProbe = await cdp.evaluate(`(() => {
      const header = document.querySelector(${JSON.stringify(betaGroup + ' .sidebar-session-group-header')});
      if (!header) throw new Error('Missing project header');
      const probe = document.createElement('span');
      probe.className = 'sidebar-project-hint';
      probe.dataset.hint = 'running';
      probe.id = 'e2e-project-hint-probe';
      probe.setAttribute('role', 'img');
      probe.setAttribute('aria-label', 'Working');
      header.insertBefore(probe, header.querySelector('.sidebar-menu-wrap'));
      const ring = getComputedStyle(probe, '::before');
      return {
        display: getComputedStyle(probe).display,
        ringAnimation: ring.animationName,
        ringBorder: parseFloat(ring.borderTopWidth),
      };
    })()`);
    const betaHeaderTarget = await point(`${betaGroup} .sidebar-session-group-header`);
    await move(betaHeaderTarget.x, betaHeaderTarget.y);
    const hoveredProjectHint = await cdp.evaluate(
      "getComputedStyle(document.querySelector('#e2e-project-hint-probe')).display",
    );
    check(
      hintProbe.display !== 'none' && hintProbe.ringAnimation !== 'none' &&
        Math.abs(hintProbe.ringBorder - 1.5) <= 0.01 && hoveredProjectHint === 'none',
      'a folded project shows a neutral spinner until its header is hovered',
      JSON.stringify({ hintProbe, hoveredProjectHint }),
    );
    await move(600, 120);
    const permissionHint = await cdp.evaluate(`(() => {
      const probe = document.querySelector('#e2e-project-hint-probe');
      probe.dataset.hint = 'permission';
      const dot = getComputedStyle(probe, '::before');
      const token = document.createElement('span');
      token.style.background = 'var(--ds-purple)';
      document.body.appendChild(token);
      const purple = getComputedStyle(token).backgroundColor;
      token.remove();
      return { display: getComputedStyle(probe).display, background: dot.backgroundColor, purple, animation: dot.animationName };
    })()`);
    check(
      permissionHint.display !== 'none' && permissionHint.background === permissionHint.purple &&
        permissionHint.animation !== 'none',
      'a folded project with a waiting approval shows the purple dot',
      JSON.stringify(permissionHint),
    );
    await cdp.evaluate(
      "document.querySelector('#e2e-project-hint-probe')?.remove()",
    );
    await click(`${betaGroup} .project-toggle`);
    await waitFor(
      () => cdp.evaluate(
        `!document.querySelector(${JSON.stringify(betaGroup + ' .sidebar-session-group-body')})?.classList.contains('collapsed')`,
      ),
      'the beta project reopens',
    );

    // The project list's own surface still opens the project menu: the handler
    // sits on the container, not on a row. The probe dispatches the bubbling
    // event on that container (CDP mouse events do not synthesize a contextmenu
    // on macOS) with coordinates that only place the menu.
    const contextTarget = await cdp.evaluate(`(() => {
      const list = document.querySelector('.sidebar-session-groups');
      if (!list) return { ok: false };
      const box = list.getBoundingClientRect();
      const x = Math.round(box.left + box.width / 2);
      const y = Math.round(Math.max(box.top + 8, box.bottom - 8));
      list.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 2,
      }));
      return { ok: true, x, y, className: list.className };
    })()`);
    await waitFor(
      () => cdp.evaluate('!!document.querySelector("[data-sidebar-section-menu]")'),
      'the project list opens its section menu',
    );
    const sectionMenu = await cdp.evaluate(
      'document.querySelector("[data-sidebar-section-menu]")?.dataset.sidebarSectionMenu ?? null',
    );
    check(
      contextTarget.ok && sectionMenu === 'projects',
      'the empty project surface still opens the project section menu',
      JSON.stringify({ contextTarget, sectionMenu }),
    );
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(
      () => cdp.evaluate('!document.querySelector("[data-sidebar-section-menu]")'),
      'the section menu closes',
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
