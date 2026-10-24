#!/usr/bin/env node
/** Isolated renderer interaction coverage for agent instructions and capabilities. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryRoot, resolveElectronBinary } from './e2e/boot.mjs';
const root = repositoryRoot();
const { build } = createRequire(join(root, 'packages/agent-runtime/package.json'))('esbuild');
const temp = await mkdtemp(join(tmpdir(), 'pi-agent-capabilities-'));
try {
  await build({ entryPoints: [join(root, 'scripts/e2e/agent-capabilities.tsx')], outfile: join(temp, 'renderer.js'), bundle: true,
    platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
    alias: { '@pi-desktop/shared': join(root, 'packages/shared/src/index.ts'),
      '@pi-desktop/shared/changelog-loader': join(root, 'packages/shared/src/changelog-loader.ts'),
      '@pi-desktop/i18n': join(root, 'packages/i18n/src/index.ts'),
      '@pi-desktop/i18n/locale-info': join(root, 'packages/i18n/src/locale-info.ts'),
      ...Object.fromEntries(['en','zh-CN','zh-TW','tr','de','es','fr','ko','pt-BR'].map(locale => [`@pi-desktop/i18n/locales/${locale}`, join(root, `packages/i18n/src/locales/${locale}/index.ts`)])),
      '@pi-desktop/voice-runtime/live': join(root, 'packages/voice-runtime/src/live/index.ts'),
      react: join(root, 'apps/desktop/node_modules/react'), 'react-dom': join(root, 'apps/desktop/node_modules/react-dom'),
      i18next: join(root, 'apps/desktop/node_modules/i18next'), 'react-i18next': join(root, 'apps/desktop/node_modules/react-i18next') },
    nodePaths: [join(root, 'apps/desktop/node_modules')],
  });
  await writeFile(join(temp, 'index.html'), '<!doctype html><html><body><script type="module" src="renderer.js"></script></body></html>');
  await writeFile(join(temp, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.setPath('userData', require('node:path').join(__dirname, 'profile'));
app.whenReady().then(async () => { const win = new BrowserWindow({show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
try { await win.loadFile(require('node:path').join(__dirname,'index.html')); const result=await win.webContents.executeJavaScript('globalThis.agentCapabilitiesProbe()'); console.log('AGENT_CAPABILITIES '+JSON.stringify(result)); app.exit(0); } catch(error) {console.error(error);app.exit(1);} });`);
  const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(resolveElectronBinary(root).electronBinary,[join(temp,'main.cjs')],{env,stdio:['ignore','pipe','pipe']});
  let output=''; for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>output+=chunk);
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  let code; try {code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});} finally {clearTimeout(timer);}
  assert.equal(code,0,output); console.log(output.trim());
} finally {await rm(temp,{recursive:true,force:true});}
