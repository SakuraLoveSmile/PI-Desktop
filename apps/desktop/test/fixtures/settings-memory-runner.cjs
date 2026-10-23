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
    await until(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element && getComputedStyle(element).visibility === 'visible' && element.getBoundingClientRect().width > 0;
    })()`);
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      if (element.disabled) throw new Error('Disabled element: ' + ${JSON.stringify(selector)});
      return { x, y };
    })()`);
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', ...point, button: 'none', buttons: 0, pointerType: 'mouse',
    });
    await until(`document.querySelector(${JSON.stringify(selector)})?.contains(document.elementFromPoint(${point.x}, ${point.y}))`);
    const previous = await evaluate('window.__fixtureClicks');
    for (const type of ['mousePressed', 'mouseReleased']) {
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
    if (await evaluate(`window.settingsMemoryFixture.mode === 'workspace'`)) {
      const music = '[data-sidebar-project-group="/fixture/music/main"]';
      const other = '[data-sidebar-project-group="/fixture/absent/other-main"]';
      const task = id => `[data-sidebar-session-row="${id}"] .thread-item-main`;
      const state = 'window.settingsMemoryFixture.workspace()';
      await until(`document.querySelectorAll('[data-sidebar-project-group]').length === 2 && document.querySelectorAll('.projects-row').length === 2`);
      await check('real Sidebar folds three checkouts into one memory project and separates a matching name', `
        document.querySelectorAll('${music} [data-sidebar-session-row]').length === 3 &&
        document.querySelectorAll('${other} [data-sidebar-session-row]').length === 1 &&
        [...document.querySelectorAll('.project-toggle')].every(element => element.textContent.trim() === 'Music')`);
      await check('real Projects archive folds verified memory IDs while preserving distinct same-named projects', `
        document.querySelectorAll('.projects-name-text').length === 2 &&
        [...document.querySelectorAll('.projects-name-text')].every(element => element.textContent === 'Music')`);
      await click('.projects-row[title="/fixture/music/main"]');
      await until(`document.querySelectorAll('.projects-detail-task').length === 3`);
      await check('the archive exposes all three source checkouts', `
        ['Main decision', 'Branch verification', 'Slot review'].every(title =>
          [...document.querySelectorAll('.projects-detail-task-title')].some(element => element.textContent === title)) &&
        [...document.querySelectorAll('.projects-detail-task')].some(element => element.title.includes('/fixture/pool/music/slot-3'))`);
      await click('.projects-detail-task[title^="Branch verification"]');
      await until(`${state}.activeSessionId === 'branch-task' && ${state}.workspace.path === '/fixture/worktrees/music/review'`);
      await check('archive task selection activates its actual checkout through the real store', `
        window.settingsMemoryFixture.requests.some(request => request.channel.endsWith('/project/set') && request.input === '/fixture/worktrees/music/review')`);
      await click(task('main-task'));
      await until(`${state}.activeSessionId === 'main-task' && ${state}.workspace.path === '/fixture/music/main'`);
      await click(task('slot-task'));
      await until(`${state}.activeSessionId === 'slot-task' && ${state}.workspace.path === '/fixture/pool/music/slot-3'`);
      await check('Sidebar historical task selection retains each session checkout', `
        ${state}.sessions.find(session => session.id === 'main-task').projectPath === '/fixture/music/main' &&
        ${state}.sessions.find(session => session.id === 'branch-task').projectPath === '/fixture/worktrees/music/review' &&
        ${state}.sessions.find(session => session.id === 'slot-task').projectPath === '/fixture/pool/music/slot-3'`);
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
      await evaluate(`document.activeElement.blur(); window.settingsMemoryFixture.branch('refreshed-slot-branch');
        window.fixtureProjectActivations = window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/project/set')).length;
        document.querySelector('${task('slot-task')}').focus()`);
      await until(`document.querySelector('.sidebar-session-hover-card')?.textContent.includes('refreshed-slot-branch')`);
      await check('session hover refreshes the active checkout branch without activating a project or adding a native button tooltip', `
        ${state}.workspace.branch === 'refreshed-slot-branch' &&
        window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/project/set')).length === window.fixtureProjectActivations &&
        document.querySelector('${task('slot-task')}').title === '' &&
        document.querySelector('${task('slot-task')} .thread-item-context').title === '/fixture/pool/music/slot-3'`);
      await click(`${music} .sidebar-session-group-add`);
      await until(`${state}.activeSessionId?.startsWith('created-')`);
      await check('new task from the shared Sidebar row stays in the active slot', `
        ${state}.workspace.path === '/fixture/pool/music/slot-3' &&
        window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/session/create')).at(-1).input.projectPath === '/fixture/pool/music/slot-3'`);
      await click(`${music} .project-more`);
      await until(`!!document.querySelector('[data-action="edit-project"]')`);
      await check('shared row edit and delete actions identify the current checkout', `
        document.querySelector('[data-action="edit-project"]').title === '/fixture/pool/music/slot-3' &&
        document.querySelector('[data-action="delete-project"]').title === '/fixture/pool/music/slot-3'`);
      await click('[data-action="open-project-folder"]');
      await check('shared project folder action opens the actual active checkout', `
        window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/project/open-folder')).at(-1).input === '/fixture/pool/music/slot-3'`);
      await click(`${music} .project-more`);
      await click('[data-action="edit-project"]');
      await until(`!!document.querySelector('.project-create-folder-copy[title="/fixture/pool/music/slot-3"]')`);
      await check('editing the shared Sidebar row keeps the actual single-root group', `
        document.querySelectorAll('.project-create-folder-copy').length === 1`);
      await click('.project-create-dialog-close');
      await evaluate(`window.settingsMemoryFixture.running(['branch-task', 'slot-task'])`);
      await click(`${music} .project-more`);
      await click('[data-action="delete-project"]');
      await check('the first shared Sidebar delete click only arms the current row', `
        !document.querySelector('.project-delete-dialog') &&
        !window.settingsMemoryFixture.requests.some(request => request.channel.endsWith('/project/remove'))`);
      await click('[data-action="delete-project"]');
      await until(`!!document.querySelector('.project-delete-dialog')`);
      await check('Sidebar delete confirmation counts only the target checkout and its live task', `
        document.querySelector('#project-delete-dialog-sessions').textContent.startsWith('2 saved sessions') &&
        document.querySelector('#project-delete-dialog-running').textContent.startsWith('1 session in this project')`);
      await click('.project-delete-dialog .project-instructions-dialog-close');
      await evaluate(`window.settingsMemoryFixture.running([])`);
      await click(`${music} .project-more`);
      await click('[data-action="toggle-project-archive"]');
      await until(`${state}.workspace.path === '/fixture/other/checkout' && !document.querySelector('${music}')`);
      await check('archiving the current row activates the next real checkout when its memory primary is absent', `
        ${state}.projectMeta['/fixture/music/main'].archived === true &&
        !window.settingsMemoryFixture.requests.some(request => request.channel.endsWith('/project/set') && request.input === '/fixture/absent/other-main')`);
      await click('.projects-row[title="/fixture/absent/other-main"]');
      await until(`document.querySelector('.projects-detail-task-title')?.textContent === 'Other repository task'`);
      await click('.projects-detail-new');
      await until(`${state}.activeSessionId === 'created-2'`);
      await check('archive new task uses the actual representative checkout', `
        window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/session/create')).at(-1).input.projectPath === '/fixture/other/checkout'`);
      await click('.projects-icon-btn[aria-haspopup="menu"]');
      await until(`!!document.querySelector('.projects-menu [data-action="edit-project"]')`);
      await check('archive edit and delete actions retain the actual checkout target', `
        document.querySelector('.projects-menu [data-action="edit-project"]').title === '/fixture/other/checkout' &&
        document.querySelector('.projects-menu [data-action="delete-project"]').title === '/fixture/other/checkout'`);
      await click('.projects-menu [data-action="edit-project"]');
      await until(`!!document.querySelector('.project-create-folder-copy[title="/fixture/other/checkout"]')`);
      await check('archive edit keeps foreign same-name project roots separate', `document.querySelectorAll('.project-create-folder-copy').length === 1`);
      await type('#project-edit-name', 'Other checkout renamed');
      await click('.project-edit-dialog button[type="submit"]');
      await until(`!document.querySelector('.project-edit-dialog')`);
      await check('archive edit submits the actual project group and preserves its sole checkout root', `(() => {
        const input = window.settingsMemoryFixture.requests.filter(request => request.channel.endsWith('/project-group/update')).at(-1).input;
        return input.groupId === 'other' && input.name === 'Other checkout renamed' &&
          JSON.stringify(input.folders) === JSON.stringify(['/fixture/other/checkout']);
      })()`);
      await evaluate(`window.settingsMemoryFixture.running(['main-task', 'other-task'])`);
      await click('.projects-icon-btn[aria-haspopup="menu"]');
      await click('.projects-menu [data-action="delete-project"]');
      await check('the first archive delete click only arms the current row', `!document.querySelector('.project-delete-dialog')`);
      await click('.projects-menu [data-action="delete-project"]');
      await until(`!!document.querySelector('.project-delete-dialog')`);
      await check('archive delete confirmation excludes running sessions in another shared project', `
        document.querySelector('#project-delete-dialog-sessions').textContent.startsWith('2 saved sessions') &&
        document.querySelector('#project-delete-dialog-running').textContent.startsWith('1 session in this project')`);
      await click('.project-delete-dialog .project-instructions-dialog-close');
      await evaluate(`window.settingsMemoryFixture.running([])`);
      if (rendererErrors.length) throw new Error(`Renderer errors: ${rendererErrors.join('\n')}`);
      console.log('Workspace Memory E2E passed');
      app.exit(0);
      return;
    }
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
    await check('worktree groups expose only one shared memory entry', `
      !document.querySelector('button[aria-label="Project memory · Review worktree"]') &&
      window.settingsMemoryFixture.state('/fixture/worktrees/a-review').owner === 'memory:memory-a'`);
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
    await check('shared memory editor saves against the stable owner and is visible to its worktree', `
      window.settingsMemoryFixture.state('/fixture/worktrees/a-review').memory.entries[0].content === 'Edited A context' &&
      window.settingsMemoryFixture.requests.some(request => request.channel.endsWith('/memory/editor/save') &&
        request.input.expectedOwner === 'memory:memory-a')`);
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
    const projectBPath = '/fixture/b/' + 'long-unbroken-project-path-'.repeat(12);
    await evaluate(`window.settingsMemoryFixture.migration(${JSON.stringify(projectBPath)}, true)`);
    await open('Project B');
    await check('oversized legacy memory explains recovery and pauses automatic recording', `
      !!document.querySelector('.project-memory-dialog [role="status"]') &&
      document.querySelector('${toggle}').disabled && !document.querySelector('.project-memory-card textarea').disabled`);
    await type('.project-memory-card textarea', 'Shortened legacy context');
    await click(save);
    await until(`document.querySelector('${save}').disabled`);
    await check('oversized legacy memory still permits manual CAS edits', `
      window.settingsMemoryFixture.state(${JSON.stringify(projectBPath)}).memory.entries[0].content === 'Shortened legacy context'`);
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
