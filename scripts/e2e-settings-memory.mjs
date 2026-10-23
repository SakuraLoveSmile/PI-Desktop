// Isolated settings renderer; only the preload IPC boundary is simulated.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { repositoryRoot, resolveElectronBinary } from './e2e/boot.mjs';

const root = repositoryRoot();
const { build } = createRequire(new URL('../packages/agent-runtime/package.json', import.meta.url))('esbuild');
const temporary = await mkdtemp(join(tmpdir(), 'pi-settings-memory-'));
try {
  await build({ entryPoints: [join(root, 'apps/desktop/test/fixtures/settings-memory.jsx')], outfile: join(temporary, 'fixture.js'),
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl' },
    alias: { '@pi-desktop/i18n': join(root, 'packages/i18n/src'),
      '@pi-desktop/shared': join(root, 'packages/shared/src') },
    define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'inline-url-assets', setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, ({ path, resolveDir }) => ({
        path: resolve(resolveDir, path.slice(0, -4)), namespace: 'url-asset',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'url-asset' }, async ({ path }) => ({
        contents: `export default ${JSON.stringify(`data:text/javascript;base64,${(await readFile(path)).toString('base64')}`)}`,
        loader: 'js',
      }));
    } }],
  });
  const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
  const vite = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
  const { default: tailwind } = await import(pathToFileURL(desktopRequire.resolve('@tailwindcss/vite')).href);
  const styles = await vite.build({
    configFile: false, root: join(root, 'apps/desktop'), logLevel: 'error', plugins: [tailwind()],
    build: { write: false, assetsInlineLimit: () => true,
      rollupOptions: { input: join(root, 'apps/desktop/src/styles/globals.css') } },
  });
  const cssAssets = (Array.isArray(styles) ? styles : [styles]).flatMap(result => result.output)
    .filter(entry => entry.type === 'asset' && entry.fileName.endsWith('.css'));
  if (!cssAssets.length) throw new Error('Production CSS was not compiled');
  await writeFile(join(temporary, 'fixture.css'), cssAssets.map(entry => entry.source).join('\n'));
  const server = createServer(async (request, response) => {
    const name = request.url?.split('?')[0];
    if (name === '/') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
      return;
    }
    if (name !== '/fixture.css' && name !== '/fixture.js') { response.writeHead(404); response.end(); return; }
    try {
      response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(join(temporary, name.slice(1))));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    if (process.argv.includes('--serve')) {
      console.log(`SETTINGS_MEMORY_FIXTURE_URL http://127.0.0.1:${server.address().port}`);
      console.log(`WORKSPACE_MEMORY_FIXTURE_URL http://127.0.0.1:${server.address().port}/?mode=workspace`);
      await new Promise(resolvePromise => {
        process.once('SIGINT', resolvePromise);
        process.once('SIGTERM', resolvePromise);
      });
    } else {
      for (const mode of process.argv.includes('--workspace') ? ['workspace'] : ['settings', 'workspace']) {
        const environment = { ...process.env, PI_SETTINGS_MEMORY_FIXTURE_URL:
          `http://127.0.0.1:${server.address().port}/${mode === 'workspace' ? '?mode=workspace' : ''}` };
        delete environment.ELECTRON_RUN_AS_NODE;
        const child = spawn(resolveElectronBinary(root).electronBinary,
          [`--user-data-dir=${join(temporary, `profile-${mode}`)}`, join(root, 'apps/desktop/test/fixtures/settings-memory-runner.cjs')],
          { env: environment, windowsHide: true, stdio: 'inherit' });
        process.exitCode = await new Promise((resolvePromise, reject) => {
          child.once('exit', (code) => resolvePromise(code ?? 1)); child.once('error', reject);
        });
        if (process.exitCode !== 0) break;
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
