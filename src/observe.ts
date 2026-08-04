#!/usr/bin/env node
// @ts-nocheck
/**
 * Page map CLI — compact (plan) or deep (TC/codegen) page reads via Playwright.
 *
 * Usage:
 *   node scripts/dom-miner/observe.mjs --url https://example.com --mode compact
 *   node scripts/dom-miner/observe.mjs --url https://example.com --mode deep
 *   node scripts/dom-miner/observe.mjs --url https://example.com --mode both --out test-output/dom-miner
 *
 * Env: MINE_URL or TEST_BASE_URL as default URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import dotenv from 'dotenv';
import { runCompactObserve, formatCompactTree } from './lib/compact-observe.js';
import { runDeepInventory } from './lib/deep-inventory.js';
import { expandUi } from './lib/expand-ui.js';
import { estimateTokens, byteLength, summarizeCompact, summarizeDeep } from './lib/metrics.js';
import { settlePage } from './lib/settle-page.js';

dotenv.config({ quiet: true });

function parseArgs(argv) {
  const out = {
    url: process.env.MINE_URL || process.env.TEST_BASE_URL || '',
    mode: 'compact',
    outDir: '',
    headed: false,
    width: 1920,
    height: 1080,
    settleMs: 800,
    waitUntil: 'domcontentloaded',
    readySelector: '',
    scroll: false,
    spa: false,
    expand: true,
    includeCollapsedNav: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--headed') out.headed = true;
    else if (a === '--no-expand') out.expand = false;
    else if (a === '--expand') out.expand = true;
    else if (a === '--include-collapsed-nav') out.includeCollapsedNav = true;
    else if (a === '--no-collapsed-nav') out.includeCollapsedNav = false;
    else if (a === '--spa') out.spa = true;
    else if (a === '--scroll') out.scroll = true;
    else if (a === '--ready') out.readySelector = argv[++i];
    else if (a === '--wait-until') out.waitUntil = argv[++i];
    else if (a === '--viewport') {
      const [w, h] = String(argv[++i]).split('x').map(Number);
      out.width = w || 1920;
      out.height = h || 1080;
    } else if (a === '--settle-ms') out.settleMs = Number(argv[++i]) || 800;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.url) {
    console.log(`Usage: node scripts/dom-miner/observe.mjs --url <url> --mode compact|deep|both [--out dir] [--expand|--no-expand]

Compact = compact DOM tree for QA: landmarks + text-holders + interactive [id]s
          (default --expand + --include-collapsed-nav).
Deep    = full interactive inventory + playwrightLocator (TC authoring / codegen).
--expand (default): open collapsed nav before read.
--include-collapsed-nav (default): also list hidden nav children as (collapsed).
--no-expand / --no-collapsed-nav: visible-only (may miss mega-menu TCs).
--spa: CSR/SPA settle (load + longer wait + thin-shell retry + scroll).
--ready <css>: wait for selector before read.
--wait-until <state>: commit|domcontentloaded|load|networkidle.
--scroll: scroll page to trigger lazy content.
Same Playwright browser — two read depths, not two browser stacks.`);
    process.exit(args.help ? 0 : 1);
  }

  if (!['compact', 'deep', 'both'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}". Use: compact, deep, or both.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
  });
  const page = await context.newPage();

  const navStart = performance.now();
  const settleMeta = await settlePage(page, {
    url: args.url,
    waitUntil: args.waitUntil,
    settleMs: args.settleMs,
    readySelector: args.readySelector,
    scroll: args.scroll,
    spa: args.spa,
    timeout: 60_000,
  });
  if (settleMeta.interstitial?.blocked) {
    console.error(
      `Blocked page (${settleMeta.interstitial.kind}): ${(settleMeta.interstitial.reasons || []).join(',')}`,
    );
  }
  let expandMeta = null;
  if (
    args.expand &&
    !settleMeta.interstitial?.blocked &&
    (args.mode === 'compact' || args.mode === 'both' || args.mode === 'deep')
  ) {
    const e0 = performance.now();
    expandMeta = await expandUi(page);
    expandMeta.ms = Math.round(performance.now() - e0);
  }
  const navMs = Math.round(performance.now() - navStart);

  const result = {
    meta: {
      url: args.url,
      finalUrl: page.url(),
      viewport: { width: args.width, height: args.height },
      navMs,
      settle: settleMeta,
      expand: args.expand,
      expandMeta,
      mode: args.mode,
      capturedAt: new Date().toISOString(),
    },
  };

  if (args.mode === 'compact' || args.mode === 'both') {
    const t0 = performance.now();
    const compact = await runCompactObserve(page, {
      includeCollapsedNav: args.includeCollapsedNav,
    });
    const ms = Math.round(performance.now() - t0);
    const agentText = formatCompactTree(compact);
    result.compact = {
      ms,
      summary: summarizeCompact(compact),
      bytes: byteLength(agentText),
      estTokens: estimateTokens(agentText),
      agentText,
      data: compact,
    };
  }

  if (args.mode === 'deep' || args.mode === 'both') {
    const t0 = performance.now();
    const deep = await runDeepInventory(page);
    const ms = Math.round(performance.now() - t0);
    const jsonText = JSON.stringify(deep);
    result.deep = {
      ms,
      summary: summarizeDeep(deep),
      bytes: byteLength(jsonText),
      estTokens: estimateTokens(jsonText),
      data: deep,
    };
  }

  await browser.close();

  if (args.outDir) {
    ensureDir(args.outDir);
    if (result.compact) {
      writeJson(path.join(args.outDir, 'compact.json'), result.compact.data);
      fs.writeFileSync(path.join(args.outDir, 'compact.tree.txt'), result.compact.agentText, 'utf8');
    }
    if (result.deep) {
      writeJson(path.join(args.outDir, 'deep.json'), result.deep.data);
    }
    writeJson(path.join(args.outDir, 'observe-meta.json'), {
      ...result.meta,
      compact: result.compact
        ? { ms: result.compact.ms, bytes: result.compact.bytes, estTokens: result.compact.estTokens, summary: result.compact.summary }
        : undefined,
      deep: result.deep
        ? { ms: result.deep.ms, bytes: result.deep.bytes, estTokens: result.deep.estTokens, summary: result.deep.summary }
        : undefined,
    });
    console.log('Wrote', path.resolve(args.outDir));
  }

  // stdout summary (not full payloads)
  console.log(JSON.stringify({
    meta: result.meta,
    compact: result.compact
      ? { ms: result.compact.ms, bytes: result.compact.bytes, estTokens: result.compact.estTokens, summary: result.compact.summary }
      : undefined,
    deep: result.deep
      ? { ms: result.deep.ms, bytes: result.deep.bytes, estTokens: result.deep.estTokens, summary: result.deep.summary }
      : undefined,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
