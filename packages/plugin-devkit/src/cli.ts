#!/usr/bin/env node
import { resolve } from "node:path";
import { check } from "./check.js";
import { pack } from "./pack.js";
import { TEMPLATE_NAMES, isTemplateName, scaffold } from "./templates.js";

const USAGE = `pi-plugin — PI-Desktop plugin development commands

Usage:
  pi-plugin init <template> <dir> [--id <id>] [--name <name>]
  pi-plugin check <dir>
  pi-plugin pack <dir> [--out <dir>]

Templates:
${TEMPLATE_NAMES.map((name) => `  ${name}`).join("\n")}
`;

type Flags = { positional: string[]; options: Record<string, string> };

function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = "true";
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function runInit(flags: Flags): Promise<number> {
  const [template, dir] = flags.positional;
  if (!template || !dir) {
    process.stderr.write("pi-plugin init needs a template and a target directory\n\n");
    process.stderr.write(USAGE);
    return 2;
  }
  if (!isTemplateName(template)) {
    process.stderr.write(
      `unknown template "${template}" (expected one of: ${TEMPLATE_NAMES.join(", ")})\n`,
    );
    return 2;
  }
  const result = await scaffold({
    dir: resolve(dir),
    template,
    id: flags.options.id,
    name: flags.options.name,
  });
  process.stdout.write(`Created ${result.name} (${result.id}) in ${result.dir}\n`);
  for (const file of result.files) process.stdout.write(`  ${file}\n`);
  process.stdout.write(
    "\nNext: load it from the Plugins page with \"Load development plugin\", then run `pi-plugin pack`.\n",
  );
  return 0;
}

async function runCheck(flags: Flags): Promise<number> {
  const dir = resolve(flags.positional[0] ?? ".");
  const result = await check(dir);
  for (const issue of result.errors) {
    process.stderr.write(`error  ${issue.code}: ${issue.message}\n`);
  }
  for (const issue of result.warnings) {
    process.stdout.write(`warn   ${issue.code}: ${issue.message}\n`);
  }
  if (!result.ok) {
    process.stderr.write(`\n${result.errors.length} error(s) in ${dir}\n`);
    return 1;
  }
  const manifest = result.manifest;
  process.stdout.write(
    `\nOK ${manifest?.id}@${manifest?.version} — ${result.fileCount} files, ${formatBytes(result.totalBytes)}\n`,
  );
  return 0;
}

async function runPack(flags: Flags): Promise<number> {
  const dir = resolve(flags.positional[0] ?? ".");
  try {
    const result = await pack(dir, { outDir: flags.options.out });
    for (const issue of result.check.warnings) {
      process.stdout.write(`warn   ${issue.code}: ${issue.message}\n`);
    }
    process.stdout.write(
      `Packed ${result.fileName} (${result.fileCount} files, ${formatBytes(result.byteLength)})\n`,
    );
    process.stdout.write(`  path   ${result.packagePath}\n`);
    process.stdout.write(`  sha256 ${result.shasum}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  switch (command) {
    case "init":
    case "create":
      return runInit(flags);
    case "check":
      return runCheck(flags);
    case "pack":
      return runPack(flags);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
