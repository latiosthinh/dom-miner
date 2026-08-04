#!/usr/bin/env node
// @ts-nocheck
/**
 * Same-scenario benchmark: compact vs deep observe on one or more URLs.
 *
 * Measures wall-clock time, payload bytes, estimated tokens (chars/4),
 * element coverage, and locator hint rates — same browser session per URL.
 *
 * Usage:
 *   npx dom-miner benchmark --url https://www.example.com/
 *   npx dom-miner benchmark --url https://a --url https://b --out test-output/dom-miner/benchmark
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import dotenv from 'dotenv';
import { runCompactObserve, formatCompactTree } from './lib/compact-observe.js';
import { runDeepInventory } from './lib/deep-inventory.js';
import { estimateTokens, byteLength, summarizeCompact, summarizeDeep } from './lib/metrics.js';

dotenv.config({ quiet: true });

function parseArgs(argv) {
  const urls = [];
  let outDir = 'test-output/dom-miner/benchmark';
  let headed = false;
  let settleMs = 1000;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') urls.push(argv[++i]);
    else if (a === '--out') outDir = argv[++i];
    else if (a === '--headed') headed = true;
    else if (a === '--settle-ms') settleMs = Number(argv[++i]) || 1000;
  }
  if (!urls.length) {
    const fallback = process.env.MINE_URL || process.env.TEST_BASE_URL;
    if (fallback) urls.push(fallback);
  }
  return { urls, outDir, headed, settleMs };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function overlapNames(compact, deep) {
  const cNames = new Set(
    (compact.interactables || [])
      .map((x) => (x.name || '').toLowerCase())
      .filter((n) => n && n !== '(unnamed)'),
  );
  const dVisible = (deep.elements || []).filter((e) => e.visible);
  const dNames = new Set(
    dVisible
      .map((x) => (x.accessibleName || '').toLowerCase())
      .filter(Boolean),
  );
  let hit = 0;
  for (const n of cNames) if (dNames.has(n)) hit++;
  return {
    compactNamed: cNames.size,
    deepVisibleNamed: dNames.size,
    nameOverlap: hit,
    compactCoveredByDeep: cNames.size ? hit / cNames.size : 0,
  };
}

async function measureUrl(page, url, settleMs) {
  const navStart = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(settleMs);
  const navMs = Math.round(performance.now() - navStart);

  const c0 = performance.now();
  const compactData = await runCompactObserve(page);
  const compactMs = Math.round(performance.now() - c0);
  const compactText = formatCompactTree(compactData);

  const d0 = performance.now();
  const deepData = await runDeepInventory(page);
  const deepMs = Math.round(performance.now() - d0);
  const deepText = JSON.stringify(deepData);

  const compactBytes = byteLength(compactText);
  const deepBytes = byteLength(deepText);
  const compactTokens = estimateTokens(compactText);
  const deepTokens = estimateTokens(deepText);

  return {
    url,
    finalUrl: page.url(),
    title: await page.title(),
    navMs,
    compact: {
      ms: compactMs,
      bytes: compactBytes,
      estTokens: compactTokens,
      summary: summarizeCompact(compactData),
      agentTextPreview: compactText.slice(0, 1200),
    },
    deep: {
      ms: deepMs,
      bytes: deepBytes,
      estTokens: deepTokens,
      summary: summarizeDeep(deepData),
    },
    comparison: {
      tokenRatioCompactVsDeep: deepTokens ? compactTokens / deepTokens : null,
      tokenSavingsVsDeep: deepTokens ? 1 - compactTokens / deepTokens : null,
      byteRatioCompactVsDeep: deepBytes ? compactBytes / deepBytes : null,
      timeRatioCompactVsDeep: deepMs ? compactMs / deepMs : null,
      fidelity: overlapNames(compactData, deepData),
    },
    artifacts: {
      compactData,
      deepData,
      compactText,
    },
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# CompactDom benchmark: compact vs deep');
  lines.push('');
  lines.push(`- **Captured at:** ${report.capturedAt}`);
  lines.push(`- **Viewport:** ${report.viewport.width}×${report.viewport.height}`);
  lines.push(`- **URLs:** ${report.pages.length}`);
  lines.push(`- **Token estimate:** \`chars / 4\` (relative comparison, not provider-exact)`);
  lines.push('');
  lines.push('## What was compared');
  lines.push('');
  lines.push('| Mode | Purpose | Payload |');
  lines.push('|------|---------|---------|');
  lines.push('| **compact** | Test-plan / multi-page explore | Pruned visible tree + numeric IDs + light locators |');
  lines.push('| **deep** | TC authoring / codegen (current inventory style) | Full interactive JSON incl. hidden + playwrightLocator |');
  lines.push('');
  lines.push('Same Playwright browser + page state per URL; only the **read format** differs.');
  lines.push('');

  lines.push('## Totals');
  lines.push('');
  lines.push('| Metric | Compact | Deep | Compact / Deep |');
  lines.push('|--------|---------|------|----------------|');
  lines.push(`| Est. tokens (agent payload) | ${report.totals.compactTokens} | ${report.totals.deepTokens} | ${pct(report.totals.tokenRatio)} |`);
  lines.push(`| Bytes | ${report.totals.compactBytes} | ${report.totals.deepBytes} | ${pct(report.totals.byteRatio)} |`);
  lines.push(`| Observe wall time (ms) | ${report.totals.compactMs} | ${report.totals.deepMs} | ${pct(report.totals.timeRatio)} |`);
  lines.push(`| Navigate wall time (ms) | ${report.totals.navMs} (shared) | same | — |`);
  lines.push('');
  if (report.totals.deepTokens > 0) {
    lines.push(
      `**Token savings if agent ingests compact instead of deep:** ${pct(1 - report.totals.tokenRatio)} fewer estimated tokens.`,
    );
    lines.push('');
  }

  lines.push('## Per URL');
  lines.push('');
  for (const p of report.pages) {
    lines.push(`### ${p.title || p.url}`);
    lines.push('');
    lines.push(`- URL: ${p.finalUrl}`);
    lines.push(`- Navigate: ${p.navMs} ms`);
    lines.push('');
    lines.push('| Metric | Compact | Deep |');
    lines.push('|--------|---------|------|');
    lines.push(`| Observe ms | ${p.compact.ms} | ${p.deep.ms} |`);
    lines.push(`| Est. tokens | ${p.compact.estTokens} | ${p.deep.estTokens} |`);
    lines.push(`| Bytes | ${p.compact.bytes} | ${p.deep.bytes} |`);
    lines.push(`| Controls counted | ${p.compact.summary.interactableCount} visible | ${p.deep.summary.elementCount} total (${p.deep.summary.visibleCount} visible / ${p.deep.summary.hiddenCount} hidden) |`);
    lines.push(`| Locator hints | ${p.compact.summary.withLocator} | ${p.deep.summary.withLocator} |`);
    lines.push(
      `| Name overlap (compact ∩ deep visible) | ${p.comparison.fidelity.nameOverlap} / ${p.comparison.fidelity.compactNamed} compact names (${pct(p.comparison.fidelity.compactCoveredByDeep)}) | — |`,
    );
    lines.push(`| Token savings vs deep | ${pct(p.comparison.tokenSavingsVsDeep || 0)} | — |`);
    lines.push('');
    lines.push('<details><summary>Compact tree preview</summary>');
    lines.push('');
    lines.push('```');
    lines.push(p.compact.agentTextPreview);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  lines.push('## Interpretation');
  lines.push('');
  lines.push('| Question | Answer from this run |');
  lines.push('|----------|----------------------|');
  lines.push('| Do we need two browser stacks? | **No** — one Playwright session. |');
  lines.push('| Is compact “instead of” Playwright MCP? | **No** — it is a cheaper **read** of the same page. |');
  lines.push('| When to use compact | `/generate-application-test-plan`, multi-page module mapping |');
  lines.push('| When to use deep | `/generate-testcases-from-requirements`, codegen, locator healing |');
  lines.push('| Time cost | Observe extract is usually small vs navigation; payload size dominates agent cost |');
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('See sibling `comparison.json` and per-page `*-compact.*` / `*-deep.json` in this folder.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.urls.length) {
    console.error('Pass --url <url> (repeatable) or set TEST_BASE_URL / MINE_URL');
    process.exit(1);
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const pages = [];
  for (let i = 0; i < args.urls.length; i++) {
    const url = args.urls[i];
    console.error(`Measuring ${i + 1}/${args.urls.length}: ${url}`);
    const measured = await measureUrl(page, url, args.settleMs);
    const stem = `page-${String(i + 1).padStart(2, '0')}`;
    fs.writeFileSync(path.join(args.outDir, `${stem}-compact.tree.txt`), measured.artifacts.compactText, 'utf8');
    fs.writeFileSync(
      path.join(args.outDir, `${stem}-compact.json`),
      JSON.stringify(measured.artifacts.compactData, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      path.join(args.outDir, `${stem}-deep.json`),
      JSON.stringify(measured.artifacts.deepData, null, 2),
      'utf8',
    );
    const { artifacts, ...rest } = measured;
    pages.push(rest);
  }

  await browser.close();

  const totals = pages.reduce(
    (acc, p) => {
      acc.navMs += p.navMs;
      acc.compactMs += p.compact.ms;
      acc.deepMs += p.deep.ms;
      acc.compactBytes += p.compact.bytes;
      acc.deepBytes += p.deep.bytes;
      acc.compactTokens += p.compact.estTokens;
      acc.deepTokens += p.deep.estTokens;
      return acc;
    },
    {
      navMs: 0,
      compactMs: 0,
      deepMs: 0,
      compactBytes: 0,
      deepBytes: 0,
      compactTokens: 0,
      deepTokens: 0,
      tokenRatio: 0,
      byteRatio: 0,
      timeRatio: 0,
    },
  );
  totals.tokenRatio = totals.deepTokens ? totals.compactTokens / totals.deepTokens : 0;
  totals.byteRatio = totals.deepBytes ? totals.compactBytes / totals.deepBytes : 0;
  totals.timeRatio = totals.deepMs ? totals.compactMs / totals.deepMs : 0;

  const report = {
    capturedAt: new Date().toISOString(),
    viewport: { width: 1920, height: 1080 },
    method: {
      browser: 'playwright-chromium',
      compact: 'src/lib/compact-observe.ts',
      deep: 'src/lib/deep-inventory.ts (element-discovery fidelity)',
      tokenEstimate: 'ceil(utf16_chars / 4)',
    },
    totals,
    pages,
  };

  fs.writeFileSync(path.join(args.outDir, 'comparison.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(args.outDir, 'COMPARISON.md'), renderMarkdown(report), 'utf8');

  console.log(JSON.stringify({ outDir: path.resolve(args.outDir), totals }, null, 2));
  console.error(`Report: ${path.resolve(args.outDir, 'COMPARISON.md')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
