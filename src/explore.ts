#!/usr/bin/env node
/**
 * Explore modes — three ways to feed dom-miner dumps.
 *
 *   dom-miner explore site --url https://example.com/ [--top 50]
 *   dom-miner explore page --url https://example.com/about/
 *   dom-miner explore urls --urls-file urls.txt --stem example
 *   dom-miner explore urls --url https://a/ --url https://b/
 *
 * Aliases (same engines):
 *   site-map / sitemap  → explore site
 *   dump                → explore urls (or page when one --url)
 *   page                → explore page
 *   urls                → explore urls
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODES: Record<string, { file: string; desc: string; aliases?: string[] }> = {
  site: {
    file: 'site-map.js',
    desc: 'Full site: homepage → sitemap/crawl → dump top-N pages',
    aliases: ['sitemap', 'site-map', 'full'],
  },
  page: {
    file: 'dump-to-data.js',
    desc: 'Single URL dump into data/dom-miner/<stem>/',
    aliases: ['url', 'one'],
  },
  urls: {
    file: 'dump-to-data.js',
    desc: 'URL set: --urls-file list.txt|.csv|.json and/or repeated --url',
    aliases: ['list', 'set', 'file'],
  },
};

function resolveMode(name: string): string | null {
  const key = String(name || '').toLowerCase();
  if (MODES[key]) return key;
  for (const [mode, spec] of Object.entries(MODES)) {
    if (spec.aliases?.includes(key)) return mode;
  }
  return null;
}

function printHelp(): void {
  console.log(`dom-miner explore — choose how many URLs to map

Modes:
  site   ${MODES.site.desc}
  page   ${MODES.page.desc}
  urls   ${MODES.urls.desc}

Examples:
  # 1) Full sitemap explore
  dom-miner explore site --url https://www.australianethical.com.au/ --top 50

  # 2) Single page
  dom-miner explore page --url https://www.australianethical.com.au/super/ --stem australianethical

  # 3) URL set from a text file (one URL per line)
  dom-miner explore urls --urls-file data/dom-miner/ae-module-urls.txt --stem australianethical

  # 3b) URL set inline
  dom-miner explore urls --stem australianethical \\
    --url https://www.australianethical.com.au/super/ \\
    --url https://www.australianethical.com.au/investments/

Shared dump flags (page / urls):
  --stem --with-deep --spa --ready --wait-until --scroll --settle-ms
  --no-expand --no-collapsed-nav --no-skip-existing --headed

Site flags:
  --top --max-discover --sitemap --discover-only --with-deep --spa ...

URL list file formats (--urls-file):
  .txt   one URL per line (# comments ok)
  .csv   url column or first column
  .json  string[] | { urls: [...] } | dom-miner urls-full.json
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  // When invoked as `node explore.js site ...` argv[0] is mode.
  // When invoked via cli as `explore site ...`, cli strips `explore` and runs this with mode first.
  const modeArg = argv[0];
  if (!modeArg || modeArg === '-h' || modeArg === '--help' || modeArg === 'help') {
    printHelp();
    process.exit(modeArg ? 0 : 1);
  }

  const mode = resolveMode(modeArg);
  if (!mode) {
    console.error(`Unknown explore mode: ${modeArg}\n`);
    printHelp();
    process.exit(1);
  }

  const forward = argv.slice(1);
  if (mode === 'page') {
    // Hint dump that this is single-page mode (stricter validation)
    forward.unshift('--explore-mode', 'page');
  } else if (mode === 'urls') {
    forward.unshift('--explore-mode', 'urls');
  }

  const script = path.join(__dirname, MODES[mode].file);
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
