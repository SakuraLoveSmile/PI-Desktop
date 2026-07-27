# 02. i18n (English-first)

## 1. Policy

PI-Desktop is a global product.

- **Default locale:** `en`
- **Source language:** English
- **Authoring language for specs/UI/source strings:** English
- Other locales are translations of English sources

## 2. Framework requirements

UI must use **i18next + react-i18next** (D012).

Rules:

1. No hard-coded user-facing English sentences scattered without IDs long-term
2. Every visible string has a stable key
3. Locale switch must not require code edits
4. Every shipped locale has the same flattened key set as English
5. Interpolation variable names and sets match across every locale
6. Dates and times use the active application locale rather than the host default
7. Electron application-menu custom labels and renderer window controls
   consume catalog keys; native role labels may use Electron/OS localization

## 3. Catalog structure

```text
packages/i18n/src/locales/
├── en/index.ts
└── zh-CN/index.ts
```

The English catalog is the source type for translated catalogs. Catalog parity
and interpolation parity are enforced by automated tests.

## 4. Key conventions

```text
domain.section.item
```

Examples:

- `chat.composer.placeholder`
- `settings.providers.add`
- `plugins.permissions.fs.write.workspace`
- `errors.tool.denied`

## 5. Non-UI language surfaces

Also English-first:

- docs/spec
- ADRs
- commit messages
- issue/PR templates
- plugin example docs
- command titles in core product

Plugins may include localized display fields later, but English fields are required.

## 6. Acceptance

1. App boots in English by default
2. Locale files exist for English source catalog
3. Switching architecture supports additional locales
4. No Chinese hard dependency in core UI path
5. Catalog tests reject missing keys or mismatched interpolation variables
6. Import, Projects, and Temporary sessions expose localized visible and
   accessible labels in English and Simplified Chinese
7. macOS system-menu custom commands and Windows/Linux window controls expose
   localized English and Simplified Chinese labels
8. Boot splash and renderer crash chrome use catalog keys (`app.starting`,
   `app.shellName`, `app.tagline`, `app.uiCrashed`); empty-home hero titles are
   translated in every shipped locale
