const { app, BrowserWindow } = require('electron');

app.setName('PI Settings Memory Fixture');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1120, height: 780, useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const rendererErrors = [];
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') { rendererErrors.push(event.message); console.error(event.message); }
  });
  const evaluate = source => window.webContents.executeJavaScript(source);
  const until = expression => evaluate(`new Promise((resolve, reject) => {
    const start = performance.now();
    function check() {
      try { if (${expression}) return resolve(true); } catch (error) { return reject(error); }
      if (performance.now() - start > 8000) return reject(new Error('Timed out: ' + ${JSON.stringify(expression)} + '\\n' + document.body.innerText));
      requestAnimationFrame(check);
    } check();
  })`);
  const check = async (name, expression) => {
    if (!await evaluate(expression)) throw new Error(`FAIL ${name}`);
    console.log(`PASS ${name}`);
  };
  const click = async selector => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Obstructed element: ' + ${JSON.stringify(selector)});
      if (element.disabled) throw new Error('Disabled element: ' + ${JSON.stringify(selector)});
      return { x, y };
    })()`);
    const previous = await evaluate('window.__fixtureClicks');
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse',
      });
    }
    await until(`window.__fixtureClicks > ${previous}`);
  };
  const type = async (selector, value) => {
    await click(selector);
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.focus();
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`);
  };
  const nav = label => `.settings-nav-item:has(.settings-nav-label[data-fixture-label="${label}"])`;
  const tagNav = () => evaluate(`document.querySelectorAll('.settings-nav-label').forEach(label => label.dataset.fixtureLabel = label.textContent.trim())`);
  const open = async name => {
    await until(`!!document.querySelector('button[aria-label="Project memory · ${name}"]')`);
    await click(`button[aria-label="Project memory · ${name}"]`);
    await until(`document.querySelector('.project-memory-card input')?.value === '${name} note'`);
  };
  const close = '.project-instructions-dialog-close';
  const save = '.project-memory-dialog .project-instructions-dialog-actions button:last-child';
  const toggle = '.project-auto-memory-toggle button[role="switch"]';
  try {
    await window.loadURL(process.env.PI_SETTINGS_MEMORY_FIXTURE_URL);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.bringToFront');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await until('!!window.settingsMemoryFixture');
    await evaluate(`window.__fixtureClicks = 0; window.addEventListener('click', () => window.__fixtureClicks++, true)`);
    await tagNav();
    await check('Memory is an ordinary top-level Workspace menu in a packaged build', `(() => {
      const label = [...document.querySelectorAll('.settings-nav-label')].find(node => node.textContent === 'Memory');
      return !!label && label.closest('.settings-nav-group').querySelector('.settings-nav-group-label').textContent === 'Workspace' &&
        !label.closest('button').querySelector('.settings-nav-experimental') && window.settingsMemoryFixture.tab() === 'instructions';
    })()`);
    await type('.settings-search', 'memory');
    await tagNav();
    await check('rail search finds Memory', `document.querySelectorAll('.settings-nav-item').length === 1 && document.querySelector('.settings-nav-label').textContent === 'Memory'`);
    await click(nav('Memory'));
    await until(`window.settingsMemoryFixture.tab() === 'memory' && document.querySelectorAll('.settings-content button[aria-label^="Project memory ·"]').length === 3`);
    await check('host project groups and legacy folders are listed once, including paths', `
      ['Project A', 'Project B', 'Legacy folder', '/fixture/a', '/fixture/b', '/fixture/legacy']
        .every(text => document.querySelector('.settings-content').textContent.includes(text)) &&
      document.querySelectorAll('button[aria-label="Project memory · Project A"]').length === 1`);
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 560, height: 780, deviceScaleFactor: 1, mobile: false,
    });
    await until('window.innerWidth === 560');
    await evaluate('new Promise(requestAnimationFrame)');
    await check('long project paths stay inside their rows and content pane at 560px', `(() => {
      const pane = document.querySelector('.settings-content').getBoundingClientRect();
      const paths = [...document.querySelectorAll('.memory-settings-path')];
      const within = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
      return paths.some(path => path.scrollWidth > path.clientWidth) &&
        [...document.querySelectorAll('.memory-settings .settings-row-copy, .memory-settings-path')].every(element => {
          const bounds = element.getBoundingClientRect();
          const row = element.closest('.settings-row').getBoundingClientRect();
          return within(bounds, row) && within(bounds, pane);
        });
    })()`);
    await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    await until('window.innerWidth === 1120');
    await type('.settings-search', '');
    await tagNav();
    await open('Project A');
    await type('.project-memory-card textarea', 'Edited A context');
    await click('.project-memory-dialog-toolbar button');
    await until(`document.querySelectorAll('.project-memory-card').length === 2`);
    await type('.project-memory-card:nth-child(2) input', 'Additional note');
    await type('.project-memory-card:nth-child(2) textarea', 'Added A context');
    await click(toggle);
    await until(`window.settingsMemoryFixture.state('/fixture/a').enabled === true`);
    await check('automatic recording switch preserves unsaved edits', `document.querySelector('.project-memory-card textarea').value === 'Edited A context' && window.settingsMemoryFixture.state('/fixture/a').memory.entries.length === 1`);
    await click(save);
    await until(`window.settingsMemoryFixture.state('/fixture/a').memory.entries.length === 2 && document.querySelector('${save}').disabled`);
    await click(close);
    await until(`!document.querySelector('.project-memory-dialog')`);
    await click(nav('Instructions'));
    await until(`window.settingsMemoryFixture.tab() === 'instructions'`);
    await click(nav('Memory'));
    await open('Project A');
    await check('saved memory survives navigating away and reopening', `document.querySelector('.project-memory-card textarea').value === 'Edited A context' && document.querySelector('.project-memory-card:nth-child(2) input').value === 'Additional note' && document.querySelector('${toggle}').getAttribute('aria-checked') === 'true'`);
    await click('.project-memory-card:nth-child(2) .project-memory-remove');
    await click(save);
    await until(`window.settingsMemoryFixture.state('/fixture/a').memory.entries.length === 1 && document.querySelector('${save}').disabled`);
    await click(toggle);
    await until(`window.settingsMemoryFixture.state('/fixture/a').enabled === false`);
    await check('disable preserves existing memory and persists removals', `window.settingsMemoryFixture.state('/fixture/a').memory.entries[0].content === 'Edited A context' && !document.querySelector('.project-memory-card textarea').disabled`);
    await click(close);
    await open('Project B');
    await check('Project B does not inherit Project A edits or opt-in', `document.querySelector('.project-memory-card textarea').value === 'Project B context' && document.querySelector('${toggle}').getAttribute('aria-checked') === 'false'`);
    await click(close);
    await open('Legacy folder');
    await type('.project-memory-card textarea', 'Edited legacy context');
    await click(save);
    await until(`window.settingsMemoryFixture.state('/fixture/legacy').memory.entries[0].content === 'Edited legacy context' && document.querySelector('${save}').disabled`);
    await check('legacy path owner supports the same editor', `window.settingsMemoryFixture.requests.some(request => request.channel.endsWith('/memory/editor/save') && request.input.expectedOwner === 'path:/fixture/legacy')`);
    await click(close);
    await click(nav('Instructions'));
    await evaluate('window.settingsMemoryFixture.failList(true)');
    await click(nav('Memory'));
    await until(`document.querySelector('.settings-content').textContent.includes('Could not load the project list')`);
    await evaluate('window.settingsMemoryFixture.failList(false)');
    await click('.settings-content .settings-row button');
    await until(`document.querySelectorAll('.settings-content button[aria-label^="Project memory ·"]').length === 3`);
    await check('failed listing offers a working retry', `!document.querySelector('.settings-content').textContent.includes('Could not load the project list') && !!document.querySelector('button[aria-label=\"Project memory · Project A\"]')`);
    await click(nav('Instructions'));
    await evaluate('window.settingsMemoryFixture.empty(true)');
    await click(nav('Memory'));
    await until(`document.querySelector('.settings-content .settings-row button')?.textContent === 'Projects'`);
    await click('.settings-content .settings-row button');
    await until(`window.settingsMemoryFixture.tab() === 'projects' && !!document.querySelector('.projects-toolbar')`);
    await check('empty Memory leads to the existing Projects archive', `document.querySelector('.settings-nav-item.active .settings-nav-label').textContent === 'Projects'`);
    if (rendererErrors.length) throw new Error(`Renderer errors: ${rendererErrors.join('\n')}`);
    console.log('Settings Memory E2E passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
