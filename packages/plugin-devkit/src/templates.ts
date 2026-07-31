import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Template ids match the catalogue in docs/spec/07-plugins/10-plugin-devex.md §3. */
export const TEMPLATE_NAMES = [
  "panel-basic",
  "agent-tool-basic",
  "skill-pack",
  "full-demo",
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export type ScaffoldInput = {
  /** Absolute directory the plugin is written into. Created when missing. */
  dir: string;
  template: TemplateName;
  /** Plugin id. Defaults to `local.<directory-slug>`. */
  id?: string;
  /** Display name. Defaults to the directory slug in title case. */
  name?: string;
  version?: string;
};

export type ScaffoldResult = {
  dir: string;
  id: string;
  name: string;
  template: TemplateName;
  /** Written files, relative to `dir`, in creation order. */
  files: string[];
};

/** Plugin ids travel into file paths through host-core's `sanitize_id`. */
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isTemplateName(value: unknown): value is TemplateName {
  return typeof value === "string" && (TEMPLATE_NAMES as readonly string[]).includes(value);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plugin"
  );
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => name !== ".DS_Store").length === 0;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return true;
    throw error;
  }
}

/**
 * Write a starter plugin into `dir`.
 *
 * Refuses a non-empty directory: scaffolding is a create-only operation, and
 * silently merging into existing sources is how people lose work.
 */
export async function scaffold(input: ScaffoldInput): Promise<ScaffoldResult> {
  if (!isTemplateName(input.template)) {
    throw new Error(
      `unknown template "${String(input.template)}" (expected one of: ${TEMPLATE_NAMES.join(", ")})`,
    );
  }
  const dir = resolve(input.dir);
  if (!(await isEmptyDir(dir))) {
    throw new Error(`directory is not empty: ${dir}`);
  }

  const slug = slugify(dir.split(sep).filter(Boolean).pop() ?? "plugin");
  const id = (input.id ?? `local.${slug}`).trim();
  if (!ID_PATTERN.test(id)) {
    throw new Error(`plugin id "${id}" must match [a-zA-Z0-9][a-zA-Z0-9._-]*`);
  }
  const name = (input.name ?? titleCase(slug)).trim() || titleCase(slug);
  const version = (input.version ?? "0.1.0").trim();

  const files = templateFiles(input.template, { id, name, version, slug });
  for (const [relative, content] of files) {
    const target = join(dir, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  return { dir, id, name, template: input.template, files: files.map(([r]) => r) };
}

type TemplateVars = { id: string; name: string; version: string; slug: string };

function templateFiles(
  template: TemplateName,
  vars: TemplateVars,
): Array<[string, string]> {
  const panel = template === "panel-basic" || template === "full-demo";
  const tool = template === "agent-tool-basic" || template === "full-demo";
  const skill = template === "skill-pack" || template === "full-demo";

  const files: Array<[string, string]> = [
    ["manifest.json", manifestJson(template, vars)],
    ["main.js", mainJs(template, vars)],
  ];
  if (panel) files.push(["renderer/index.html", panelHtml(vars)]);
  if (skill) files.push([`skills/${vars.slug}.md`, skillDoc(vars)]);
  files.push(["README.md", readme(template, vars, { panel, tool, skill })]);
  return files;
}

function manifestJson(template: TemplateName, vars: TemplateVars): string {
  const panel = template === "panel-basic" || template === "full-demo";
  const tool = template === "agent-tool-basic" || template === "full-demo";
  const skill = template === "skill-pack" || template === "full-demo";

  const contributes: Record<string, unknown> = {};
  const permissions: string[] = [];
  const activationEvents: string[] = ["onStartup"];

  if (panel) {
    contributes.commands = [
      {
        id: `${vars.slug}.open`,
        title: `${vars.name}: Open Panel`,
        keywords: [vars.slug],
      },
    ];
    permissions.push("ui.panel");
    activationEvents.unshift(`onCommand:${vars.slug}.open`);
  }
  if (tool) {
    contributes.agentTools = [
      {
        name: "echo_text",
        description: "Echo text back to the agent.",
        risk: "low",
        schema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ];
    permissions.push("agent.tool.register");
  }
  if (skill) {
    contributes.skills = [`skills/${vars.slug}.md`];
    permissions.push("agent.prompt.inject");
  }
  if (template === "full-demo") {
    contributes.settings = [
      { key: "greeting", type: "string", default: `Hello from ${vars.name}`, title: "Greeting" },
    ];
  }

  const manifest = {
    schemaVersion: 1,
    id: vars.id,
    name: vars.name,
    version: vars.version,
    description: `${vars.name} — generated from the ${template} template.`,
    main: "main.js",
    ...(panel ? { ui: { panel: "renderer/index.html", title: vars.name } } : {}),
    contributes,
    permissions,
    engines: { piDesktop: ">=0.1.0" },
    activationEvents,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function mainJs(template: TemplateName, vars: TemplateVars): string {
  const panel = template === "panel-basic" || template === "full-demo";
  const tool = template === "agent-tool-basic" || template === "full-demo";
  const commandId = `${vars.slug}.open`;

  const load: string[] = [];
  const unload: string[] = [];

  if (template === "full-demo") {
    load.push("  const settings = await pi.plugin.getSettings();");
  }
  if (panel) {
    const toast =
      template === "full-demo"
        ? `settings.greeting || "Hello from ${vars.name}"`
        : `"Hello from ${vars.name}"`;
    load.push(
      "  await pi.commands.register({",
      `    id: "${commandId}",`,
      `    title: "${vars.name}: Open Panel",`,
      `    keywords: ["${vars.slug}"],`,
      "    run: async () => {",
      `      await pi.ui.openPanel({ title: "${vars.name}" });`,
      `      await pi.ui.showToast(${toast});`,
      "    },",
      "  });",
    );
    unload.push(`  await pi.commands.unregister("${commandId}");`);
  }
  if (tool) {
    load.push(
      "  await pi.agent.registerTool({",
      '    name: "echo_text",',
      '    description: "Echo text back to the agent.",',
      '    risk: "low",',
      "    schema: {",
      '      type: "object",',
      '      properties: { text: { type: "string" } },',
      '      required: ["text"],',
      "    },",
      "    execute: async (args) => ({",
      "      ok: true,",
      '      echo: String(args?.text ?? ""),',
      "      pluginId: pi.plugin.getId(),",
      "    }),",
      "  });",
    );
    unload.push('  await pi.agent.unregisterTool("echo_text");');
  }
  if (!load.length) {
    // skill-pack contributes prompt text only; the entry still has to exist
    // because host-core rejects a manifest whose `main` is missing.
    load.push('  await pi.ui.showToast("' + vars.name + ' skills are active.");');
  }

  return `/**
 * ${vars.name} — PI-Desktop plugin entry.
 *
 * The host injects the global \`pi\` object. Every call is gated by the
 * permissions declared in manifest.json, so widening what this file does
 * usually means widening \`permissions\` too.
 */

async function onLoad() {
${load.join("\n")}
}

async function onUnload() {
${unload.length ? unload.join("\n") : "  // nothing to tear down"}
}

module.exports = { onLoad, onUnload };
`;
}

function panelHtml(vars: TemplateVars): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${vars.name}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b1020;
        color: #e8eefc;
      }
      .card {
        border: 1px solid #24304d;
        border-radius: 12px;
        padding: 16px;
        background: #121a2f;
      }
      button {
        margin-top: 12px;
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        background: #4f7cff;
        color: #fff;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${vars.name}</h2>
      <p>Panel served from this plugin's renderer directory.</p>
      <button id="ping">Toast ping</button>
    </div>
    <script>
      document.getElementById("ping").addEventListener("click", async () => {
        if (window.pluginBridge?.invoke) {
          await window.pluginBridge.invoke("ui.showToast", { message: "${vars.name} panel bridge" });
        } else {
          alert("pluginBridge is unavailable outside PI-Desktop");
        }
      });
    </script>
  </body>
</html>
`;
}

function skillDoc(vars: TemplateVars): string {
  return `---
name: ${vars.name}
description: Describe when the agent should follow this skill.
---

# ${vars.name}

Replace this body with the instructions the agent should follow. Keep it short
and specific — the whole document is injected into the system prompt whenever
this plugin is enabled, and it competes for context with the user's own
\`AGENTS.md\`.

## When to use

- Describe the situations this skill applies to.

## How to use

- Describe the concrete steps, and name the tools this plugin registers.
`;
}

function readme(
  template: TemplateName,
  vars: TemplateVars,
  parts: { panel: boolean; tool: boolean; skill: boolean },
): string {
  const contributions = [
    parts.panel ? `- Command \`${vars.slug}.open\` opening a panel from \`renderer/index.html\`` : "",
    parts.tool ? "- Agent tool `echo_text`" : "",
    parts.skill ? `- Skill \`skills/${vars.slug}.md\`` : "",
    template === "full-demo" ? "- Setting `greeting`" : "",
  ].filter(Boolean);

  return `# ${vars.name}

Generated from the \`${template}\` template.

## Contributions

${contributions.join("\n")}

## Develop

1. Open the Plugins page and use **Load development plugin**, pointing at this
   directory. PI-Desktop reloads the plugin whenever you save a file here.
2. Verify the contributions from the command palette.
3. Validate and package:

\`\`\`bash
pnpm pi-plugin check .
pnpm pi-plugin pack .
# writes dist/${vars.id}-${vars.version}.piplug
\`\`\`

Install the resulting \`.piplug\` from the Plugins page to test it the way a
user would.
`;
}
