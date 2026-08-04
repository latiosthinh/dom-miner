#!/usr/bin/env node
// @ts-nocheck
/**
 * Homepage → site URL inventory → compact DOM dumps for the whole (or top-N) site.
 *
 * Usage:
 *   npm run dom-miner:site -- --url https://www.australianethical.com.au/
 *   npm run dom-miner:site -- --url https://example.com/ --stem example --top 30
 *   npm run dom-miner:site -- --url https://example.com/ --sitemap https://example.com/sitemap.xml
 *
 * Pipeline:
 *   1. Resolve sitemap (robots.txt /sitemap.xml) or crawl fallback
 *   2. Write test-output/sitemap/<stem>-urls-full.json
 *   3. Dump compact page maps → data/dom-miner/<stem>/
 *
 * Feeds /generate-application-test-plan and /generate-testcases-from-requirements
 * without re-browsing when reading data/dom-miner/<stem>/.
 */
import path from 'node:path';
import { chromium } from 'playwright-core';
import dotenv from 'dotenv';
import { discoverSiteUrls, stemFromUrl, sanitizeStem } from './lib/discover-urls.js';
import { dumpPagesToData, ensureDir, writeJsonOrText } from './lib/dump-pages.js';
import { findRepoRoot } from './lib/root.js';
import { settlePage } from './lib/settle-page.js';

dotenv.config({ quiet: true });

const ROOT = findRepoRoot();

function parseArgs(argv) {
  const out = {
    url: process.env.MINE_URL || process.env.TEST_BASE_URL || '',
    stem: '',
    sitemap: '',
    top: 50,
    maxDiscover: 5000,
    withDeep: false,
    headed: false,
    settleMs: 1200,
    waitUntil: 'domcontentloaded',
    readySelector: '',
    scroll: false,
    spa: false,
    expand: true,
    includeCollapsedNav: true,
    skipExisting: true,
    crawlFallback: true,
    discoverOnly: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--stem') out.stem = argv[++i];
    else if (a === '--sitemap') out.sitemap = argv[++i];
    else if (a === '--top') out.top = Math.max(1, Number(argv[++i]) || 50);
    else if (a === '--max-discover') out.maxDiscover = Math.max(1, Number(argv[++i]) || 5000);
    else if (a === '--with-deep') out.withDeep = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--settle-ms') out.settleMs = Number(argv[++i]) || 1200;
    else if (a === '--wait-until') out.waitUntil = argv[++i];
    else if (a === '--ready') out.readySelector = argv[++i];
    else if (a === '--scroll') out.scroll = true;
    else if (a === '--spa') out.spa = true;
    else if (a === '--no-expand') out.expand = false;
    else if (a === '--no-collapsed-nav') out.includeCollapsedNav = false;
    else if (a === '--no-skip-existing') out.skipExisting = false;
    else if (a === '--no-crawl-fallback') out.crawlFallback = false;
    else if (a === '--discover-only') out.discoverOnly = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!out.stem && out.url) out.stem = sanitizeStem(stemFromUrl(out.url));
  else if (out.stem) out.stem = sanitizeStem(out.stem);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.url) {
    console.log(`Usage: dom-miner explore site --url <homepage> [options]
       (alias: dom-miner site-map)

Options:
  --stem <name>           Output folder stem (default: from hostname)
  --sitemap <url>         Force sitemap URL (skip robots discovery)
  --top <n>               Max URLs to dump (default 50)
  --max-discover <n>      Cap on sitemap/crawl inventory size (default 5000)
  --with-deep             Also write deep.json per page (slow; for TC/codegen)
  --discover-only         Only write urls-full.json; skip compact dumps
  --no-crawl-fallback     Fail if no sitemap found
  --no-skip-existing      Re-dump pages that already have compact.tree.txt
  --no-expand / --no-collapsed-nav / --headed / --settle-ms
  --spa / --scroll / --ready <css> / --wait-until <state>

Other explore modes:
  dom-miner explore page --url <one>
  dom-miner explore urls --urls-file list.txt

Outputs:
  test-output/sitemap/<stem>-urls-full.json   (full ranked inventory)
  data/dom-miner/<stem>/manifest.json + per-page compact trees`);
    process.exit(args.help ? 0 : 1);
  }

  const homeUrl = args.url;

  console.error(`Discovering URLs from ${homeUrl} …`);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await settlePage(page, {
      url: homeUrl,
      waitUntil: args.waitUntil,
      settleMs: Math.min(args.settleMs, 1500),
      readySelector: args.readySelector,
      scroll: args.scroll,
      spa: args.spa,
      timeout: 90_000,
    });
  } catch (err) {
    await browser.close();
    console.error('Failed to open homepage:', err.message || err);
    process.exit(1);
  }

  const discovery = await discoverSiteUrls(page.url(), {
    sitemapUrl: args.sitemap || undefined,
    page,
    crawlFallback: args.crawlFallback,
    maxUrls: Math.max(args.top, args.maxDiscover),
    spa: args.spa,
  });

  if (!discovery.urls.length) {
    await browser.close();
    console.error('No URLs discovered. Provide --sitemap or allow crawl fallback.');
    process.exit(1);
  }

  const selected = discovery.urls.slice(0, args.top);
  console.error(
    `Discovery: source=${discovery.source}` +
      (discovery.sitemapUrl ? ` sitemap=${discovery.sitemapUrl}` : '') +
      ` total=${discovery.urls.length} dumping=${selected.length}`,
  );

  const sitemapDir = path.join(ROOT, 'test-output/sitemap');
  ensureDir(sitemapDir);
  const urlsFullPath = path.join(sitemapDir, `${args.stem}-urls-full.json`);
  const urlsPayload = {
    meta: {
      stem: args.stem,
      baseUrl: homeUrl,
      source: discovery.source,
      sitemapUrl: discovery.sitemapUrl,
      capturedAt: new Date().toISOString(),
      total_urls: discovery.urls.length,
      selected_for_dump: selected.length,
      top: args.top,
    },
    urls: discovery.urls,
  };
  writeJsonOrText(urlsFullPath, urlsPayload);
  console.error(`Wrote ${path.relative(ROOT, urlsFullPath)}`);

  if (args.discoverOnly) {
    await browser.close();
    console.log(
      JSON.stringify(
        {
          stem: args.stem,
          discovery: { source: discovery.source, sitemapUrl: discovery.sitemapUrl },
          urlsFull: path.relative(ROOT, urlsFullPath).replace(/\\/g, '/'),
          totalUrls: discovery.urls.length,
          selected: selected.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Reuse browser for dumps — dumpPagesToData opens its own context; close ours first
  await context.close();
  await browser.close();

  const dumpUrls = selected.map((u) => u.url);
  const { outRoot, manifest } = await dumpPagesToData({
    root: ROOT,
    stem: args.stem,
    urls: dumpUrls,
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
      discovery: {
        source: discovery.source,
        sitemapUrl: discovery.sitemapUrl,
        totalDiscovered: discovery.urls.length,
        top: args.top,
        urlsFull: path.relative(ROOT, urlsFullPath).replace(/\\/g, '/'),
      },
      settle: {
        spa: args.spa,
        waitUntil: args.waitUntil,
        settleMs: args.settleMs,
        readySelector: args.readySelector || undefined,
        scroll: args.scroll,
      },
    },
  });

  // Site-level index for TC generators
  writeJsonOrText(path.join(outRoot, 'site-map.json'), {
    stem: args.stem,
    homeUrl,
    discovery: manifest.discovery,
    urlsFull: path.relative(ROOT, urlsFullPath).replace(/\\/g, '/'),
    pages: manifest.pages.filter((p) => !p.error),
    nextSteps: [
      'Read data/dom-miner/<stem>/manifest.json + compact.tree.txt files',
      'Run /generate-application-test-plan using urls-full.json + compact trees',
      'Run /generate-testcases-from-requirements per module (escalate --with-deep on hot pages if needed)',
    ],
  });

  console.log(
    JSON.stringify(
      {
        stem: args.stem,
        urlsFull: path.relative(ROOT, urlsFullPath).replace(/\\/g, '/'),
        dataRoot: path.relative(ROOT, outRoot).replace(/\\/g, '/'),
        discovery: manifest.discovery,
        pageCount: manifest.pageCount,
        totalCompactTokens: manifest.totalCompactTokens,
        skippedExisting: manifest.skippedExisting,
        failed: manifest.failed,
        blocked: manifest.blocked,
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
