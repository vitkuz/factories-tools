#!/usr/bin/env node
/**
 * One-shot setup: install, build, put `ai-usage` on PATH, register the enclosing factory.
 *   npm run setup            auto-detects the factory root (first parent dir that has run/ or .git)
 *   npm run setup -- <root>  explicit factory root
 *   npm run setup -- --no-factory   skip registration (plain per-session tracking only)
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const run = (cmd) => {
  process.stdout.write(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: toolDir });
};

const detectFactoryRoot = () => {
  let dir = path.dirname(toolDir);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "run")) || existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
};

const explicit = args.find((a) => !a.startsWith("--"));
const skipFactory = args.includes("--no-factory");
const root = skipFactory ? null : (explicit ? path.resolve(explicit) : detectFactoryRoot());

run(existsSync(path.join(toolDir, "package-lock.json")) ? "npm ci" : "npm install");
run("npm run build");
run("npm link");
if (root) run(`ai-usage factory add "${root}"`);
run("ai-usage ingest");

process.stdout.write(`
✅ ai-usage is ready${root ? ` and tracking ${root}` : ""}.

  ai-usage factory report            cost per pipeline run
  ai-usage factory report --run <x>  one run, step by step
  ai-usage watch                     keep refreshing while pipelines run
  ai-usage report --by provider      totals per harness
`);
