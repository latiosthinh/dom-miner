#!/usr/bin/env node
// @ts-nocheck
/**
 * Dump compact DOM page maps (and optional deep) into data/dom-zipper/
 * for test-plan / TC workflows without re-browsing.
 *
 * Used by:
 *   dom-miner explore page --url <one>
 *   dom-miner explore urls --urls-file list.txt
 *   dom-miner dump --url ... (alias)
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { dumpPagesToData } from './lib/dump-pages.js';
import { stemFromUrl, sanitizeStem } from './lib/discover-urls.js';
import { loadUrlsFromFile } from './lib/parse-url-list.js';
import { findRepoRoot } from './lib/root.js';

dotenv.config({ quiet: true });

const ROOT = findRepoRoot();

function parseArgs(argv) {
  const urls = [];
  let stem = '';
  let urlsFile = '';
  let exploreMode = ''; // '' | 'page' | 'urls'
  let withDeep = false;
  let headed = false;
  let settleMs = 1500;
  let waitUntil = 'domcontentloaded';
  let readySelector = '';
  let scroll = false;
  let spa = false;
  let expand = true;
  let includeCollapsedNav = true;
  let skipExisting = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') urls.push(argv[++i]);
    else if (a === '--stem') stem = argv[++i];
    else if (a === '--urls-file' || a === '--file' || a === '-f') urlsFile = argv[++i];
    else if (a === '--explore-mode') exploreMode = argv[++i];
    else if (a === '--with-deep') withDeep = true;
    else if (a === '--headed') headed = true;
    else if (a === '--no-expand') expand = false;
    else if (a === '--no-collapsed-nav') includeCollapsedNav = false;
    else if (a === '--no-skip-existing') skipExisting = false;
    else if (a === '--settle-ms') settleMs = Number(argv[++i]) || 1500;
    else if (a === '--wait-until') waitUntil = argv[++i];
    else if (a === '--ready') readySelector = argv[++i];
    else if (a === '--scroll') scroll = true;
    else if (a === '--spa') spa = true;
    else if (a === '--help' || a === '-h') return { help: true };
  }
  return {
    urls,
    stem,
    urlsFile,
    exploreMode,
    withDeep,
    headed,
    settleMs,
    waitUntil,
    readySelector,
    scroll,
    spa,
    expand,
    includeCollapsedNav,
    skipExisting,
  };
}

function printHelp() {
  console.log(`Dump / explore page|urls — write compact maps under data/dom-miner/<stem>/

Usage:
  dom-miner explore page --url <url> [--stem <name>]
  dom-miner explore urls --urls-file <file> [--stem <name>]
  dom-miner explore urls --url <u1> --url <u2> [--stem <name>]
  dom-miner dump --url <u> [--urls-file <file>]   # same engine

Options:
  --url                 Page URL (repeatable for urls mode)
  --urls-file, -f       .txt / .csv / .json URL list
  --stem                Output folder under data/dom-miner/ (default: from first host)
  --with-deep           Also write deep.json
  --spa / --ready / --wait-until / --scroll / --settle-ms
  --no-expand / --no-collapsed-nav / --no-skip-existing / --headed

For full-site sitemap explore:
  dom-miner explore site --url <homepage> [--top 50]
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let urls = [...(args.urls || [])];
  let urlsFileMeta = null;

  if (args.urlsFile) {
    urlsFileMeta = loadUrlsFromFile(args.urlsFile);
    urls = [...urlsFileMeta.urls, ...urls];
  }

  if (!urls.length) {
    const u = process.env.MINE_URL || process.env.TEST_BASE_URL;
    if (u) urls.push(u);
  }

  // Dedupe while preserving order
  const seen = new Set();
  urls = urls.filter((u) => {
    const key = String(u).replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(u);
  });

  const exploreMode = args.exploreMode || (urls.length <= 1 && !args.urlsFile ? 'page' : 'urls');

  if (exploreMode === 'page') {
    if (args.urlsFile) {
      console.error('explore page does not accept --urls-file. Use: dom-miner explore urls --urls-file <file>');
      process.exit(1);
    }
    if (urls.length !== 1) {
      console.error(
        urls.length === 0
          ? 'explore page requires exactly one --url'
          : `explore page expects exactly one --url (got ${urls.length}). Use: dom-miner explore urls …`,
      );
      printHelp();
      process.exit(1);
    }
  }

  if (!urls.length) {
    printHelp();
    process.exit(1);
  }

  const stem = sanitizeStem(args.stem || stemFromUrl(urls[0]));
  if (stem === 'site' && !args.stem) {
    console.error('Could not derive --stem; pass --stem <name>');
    process.exit(1);
  }

  console.error(
    `Explore ${exploreMode}: ${urls.length} URL(s) → data/dom-miner/${stem}/` +
      (urlsFileMeta ? ` (from ${path.relative(ROOT, urlsFileMeta.source) || urlsFileMeta.source})` : ''),
  );

  const { outRoot, manifest } = await dumpPagesToData({
    root: ROOT,
    stem,
    urls,
    withDeep: args.withDeep,
    headed: args.headed,
    settleMs: args.settleMs,
    waitUntil: args.waitUntil,
    readySelector: args.readySelector,
    scroll: args.scroll,
    spa: args.spa,
    expand: args.expand,
    includeCollapsedNav: args.includeCollapsedNav,
    skipExisting: args.skipExisting,
    extraManifest: {
      explore: {
        mode: exploreMode,
        urlCount: urls.length,
        urlsFile: urlsFileMeta
          ? path.relative(ROOT, urlsFileMeta.source).replace(/\\/g, '/')
          : undefined,
        urlsFileFormat: urlsFileMeta?.format,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        exploreMode,
        outRoot: path.relative(ROOT, outRoot).replace(/\\/g, '/'),
        pageCount: manifest.pageCount,
        totalCompactTokens: manifest.totalCompactTokens,
        totalDeepTokens: manifest.totalDeepTokens,
        skippedExisting: manifest.skippedExisting,
        failed: manifest.failed,
        blocked: manifest.blocked,
        urlsFile: urlsFileMeta
          ? path.relative(ROOT, urlsFileMeta.source).replace(/\\/g, '/')
          : undefined,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
