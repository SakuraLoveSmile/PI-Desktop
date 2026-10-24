// Isolated rendered workspace settings paths. Only preload IPC is simulated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryRoot, resolveElectronBinary } from './e2e/boot.mjs';
const root = repositoryRoot();
const { build } = createRequire(join(root, 'packages/agent-runtime/package.json'))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'pi-settings-workspace-'));
try {
  await build({ entryPoints: [join(root, 'scripts/e2e/settings-workspace.jsx')], outfile: join(temporary, 'renderer.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', alias: { '@pi-desktop/i18n': join(root, 'packages/i18n/src'), '@pi-desktop/shared': join(root, 'packages/shared/src') }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' } });
  await writeFile(join(temporary, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>');
  await writeFile(join(temporary, 'main.cjs'), `const {app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'index.html'));try {const result=await win.webContents.executeJavaScript('workspaceProbe()');console.log('WORKSPACE_PROBE '+JSON.stringify(result));app.exit(result.ok?0:1);}catch(error){console.error(error);app.exit(1);}});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temporary, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); clearTimeout(timeout);
  console.log(output.slice(-4000)); assert.equal(code, 0, output.slice(-4000));
} finally { await rm(temporary, { recursive: true, force: true }); }
