import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { catalogs, flattenCatalog } from '@pi-desktop/i18n';
import { PluginScenicThemesDestination } from '../../src/components/settings/PluginScenicThemesDestination';
import { RemoteHostsPage } from '../../src/components/settings/RemoteHostsPage';
import { ConfigSyncPage } from '../../src/components/settings/ConfigSyncPage';
import { useAppStore } from '../../src/stores/app-store';
import { createExtensionsFixture, scenicDestination } from '../../../../scripts/e2e/settings-extensions-fixture';
const parameters = new URLSearchParams(location.search);
const unexpected = [];
const fixture = createExtensionsFixture({ configured: parameters.has('configured'), remoteError: parameters.has('remoteError'), approvals: parameters.has('approvals'), syncLoadError: parameters.has('syncLoadError'), locked: parameters.has('locked') });
window.piDesktop = { platform: 'darwin', on: fixture.on, async invoke(channel, input) {
  try { const result = await fixture.invoke(channel, input); if (!result.handled) { unexpected.push(channel); throw new Error(`Unexpected fixture IPC: ${channel}`); } return { ok: true, data: result.data }; }
  catch (error) { return { ok: false, error: { code: 'INJECTED', message: error.message, retriable: false } }; }
} };
await i18n.use(initReactI18next).init({ lng: parameters.get('locale') ?? 'en', fallbackLng: 'en', keySeparator: false,
  resources: Object.fromEntries(['en', 'zh-CN'].map(locale => [locale, { translation: flattenCatalog(catalogs[locale]) }])), interpolation: { escapeValue: false } });
document.documentElement.dataset.theme = parameters.get('theme') ?? 'light';
const toasts = [];
useAppStore.setState({ settings: { theme: 'fixture.a' }, showToast: (...args) => toasts.push(args) });
const root = createRoot(document.getElementById('root'));
const selectTheme = async theme => { useAppStore.setState({ settings: { theme } }); };
flushSync(() => root.render(<div className="settings-detail-content">
  {parameters.get('page') === 'remote' ? <RemoteHostsPage /> : parameters.get('page') === 'sync' ? <ConfigSyncPage /> :
    <PluginScenicThemesDestination destination={scenicDestination} selectTheme={selectTheme} />}
</div>));
window.extensionsFixture = { ...fixture, toasts, unexpected, selectTheme, label: key => i18n.t(key) };
