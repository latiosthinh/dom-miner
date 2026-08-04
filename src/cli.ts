#!/usr/bin/env node
/**
 * dom-miner — Compact DOM page maps for QA
 *
 * Explore modes (preferred):
 *   npx dom-miner explore site --url https://example.com/ --top 40
 *   npx dom-miner explore page --url https://example.com/about/
 *   npx dom-miner explore urls --urls-file urls.txt --stem example
 *
 * Legacy aliases still work: site-map, dump, compact, deep, …
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** dist/ when compiled */
const PKG = __dirname;

type CommandSpec = { file: string; desc: string; inject?: string[] };

const COMMANDS: Record<string, CommandSpec> = {
  init: { file: 'init.js', desc: 'Add npm scripts + gitignore to the current repo' },
  explore: { file: 'explore.js', desc: 'Explore site | page | urls (see: explore --help)' },
  // Explore aliases (skip explore.js router)
  site: { file: 'site-map.js', desc: 'Alias: explore site (full sitemap)' },
  'site-map': { file: 'site-map.js', desc: 'Alias: explore site' },
  sitemap: { file: 'site-map.js', desc: 'Alias: explore site' },
  page: { file: 'dump-to-data.js', desc: 'Alias: explore page (one URL)', inject: ['--explore-mode', 'page'] },
  urls: { file: 'dump-to-data.js', desc: 'Alias: explore urls (list/file)', inject: ['--explore-mode', 'urls'] },
  dump: { file: 'dump-to-data.js', desc: 'Alias: explore urls / page (explicit --url / --urls-file)' },
  compact: { file: 'observe.js', desc: 'Quick compact tree (stdout / --out)', inject: ['--mode', 'compact'] },
  deep: { file: 'observe.js', desc: 'Quick deep inventory', inject: ['--mode', 'deep'] },
  read: { file: 'observe.js', desc: 'Compact / deep / both (single page)' },
  benchmark: { file: 'benchmark.js', desc: 'Compact vs deep timing + tokens' },
};

function printHelp(): void {
  console.log(`dom-miner — Compact DOM maps for QA

Three explore modes:

  explore site   Full site (homepage → sitemap/crawl → dump)
  explore page   Single URL → data/dom-miner/<stem>/
  explore urls   URL set from --urls-file and/or repeated --url

Usage:
  dom-miner explore site --url https://www.example.com/ --top 40
  dom-miner explore page --url https://www.example.com/about/ --stem example
  dom-miner explore urls --urls-file ./module-urls.txt --stem example
  dom-miner explore urls --stem example --url https://a/ --url https://b/

Commands:
${Object.entries(COMMANDS)
  .map(([k, v]) => `  ${k.padEnd(12)} ${v.desc}`)
  .join('\n')}

Quick start:
  1. npm i -D dom-miner
  2. npx dom-miner init
  3. npx playwright-core install chromium
  4. npx dom-miner explore site --url https://www.example.com/ --top 40

CSR / SPA:
  dom-miner explore site --url https://spa.example/ --spa --top 40
  dom-miner explore page --url https://spa.example/app --spa --ready "main"

URL list file (--urls-file):
  .txt   one URL per line (# comments ok)
  .csv   url column or first column
  .json  string[] | { urls } | dom-miner urls-full.json

Cursor commands stay in your project — dom-miner ships the CLI only.

Env:
  MINE_URL / TEST_BASE_URL            default --url
  DOM_MINER_ROOT                      force project root (default: cwd walk-up)
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }

  const spec = COMMANDS[cmd];
  if (!spec) {
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
  }

  const script = path.join(PKG, spec.file);
  const forward = [...(spec.inject || []), ...argv.slice(1)];
  const child = spawn(process.execPath, [script, ...forward], {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
