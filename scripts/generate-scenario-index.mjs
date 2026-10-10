#!/usr/bin/env node
import { generateScenarioIndex } from "./scenario-index.mjs";
if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Usage: node scripts/generate-scenario-index.mjs [--check]");
const result = await generateScenarioIndex({ check: process.argv.includes("--check") });
console.log(`Scenario index: ${result.suites} suites, ${result.scenarios} executable ids; ${process.argv.includes("--check") ? "current" : "generated"}.`);
