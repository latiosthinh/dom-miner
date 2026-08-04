// @ts-nocheck
/**
 * Shared page dump loop used by dump-to-data and site-map.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { runCompactObserve, formatCompactTree } from './compact-observe.js';
import { runDeepInventory } from './deep-inventory.js';
import { expandUi } from './expand-ui.js';
import { estimateTokens, byteLength, summarizeCompact, summarizeDeep } from './metrics.js';
import { settlePage } from './settle-page.js';

export function pageIdFromUrl(url, index = 0) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    if (!p) p = 'home';
    let slug = p
      .split('/')
      .map((s) => s.replace(/[^a-z0-9-_]/gi, '-').slice(0, 40))
      .join('__')
      .slice(0, 80);
    if (!slug) slug = `page-${index + 1}`;
    if (u.search) {
      let h = 0;
      for (let i = 0; i < u.search.length; i++) h = ((h << 5) - h + u.search.charCodeAt(i)) | 0;
      slug += '-q' + Math.abs(h).toString(36).slice(0, 6);
    }
    return slug;
  } catch {
    return `page-${index + 1}`;
  }
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJsonOrText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

/**
 * @param {object} opts
 * @param {string} opts.root - repo root
 * @param {string} opts.stem
 * @param {string[]} opts.urls
 * @param {boolean} [opts.withDeep]
 * @param {boolean} [opts.headed]
 * @param {number} [opts.settleMs]
 * @param {'commit'|'domcontentloaded'|'load'|'networkidle'} [opts.waitUntil]
 * @param {string} [opts.readySelector]
 * @param {boolean} [opts.scroll]
 * @param {boolean} [opts.spa] - CSR/SPA settle presets
 * @param {boolean} [opts.autoCsr] - thin-shell retry (default true)
 * @param {boolean} [opts.expand]
 * @param {boolean} [opts.includeCollapsedNav]
 * @param {boolean} [opts.skipExisting]
 * @param {import('playwright').Browser} [opts.browser] - reuse browser if provided
 * @param {object} [opts.extraManifest] - merged into manifest.json
 */
export async function dumpPagesToData(opts) {
  const {
    root,
    stem,
    urls,
    withDeep = false,
    headed = false,
    settleMs = 1500,
    waitUntil = 'domcontentloaded',
    readySelector = '',
    scroll = false,
    spa = false,
    autoCsr = true,
    expand = true,
    includeCollapsedNav = true,
    skipExisting = true,
    browser: existingBrowser,
    extraManifest = {},
  } = opts;

  const outRoot = path.join(root, 'data/dom-miner', stem);
  ensureDir(outRoot);

  const ownBrowser = !existingBrowser;
  const browser = existingBrowser || (await chromium.launch({ headless: !headed }));
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const pages = [];
  let skipped = 0;

  // Preserve prior dump entries when adding URLs (do not clobber full-site manifest)
  const priorManifestPath = path.join(outRoot, 'manifest.json');
  const priorById = new Map();
  let priorManifestMeta = {};
  if (fs.existsSync(priorManifestPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(priorManifestPath, 'utf8'));
      for (const p of prior.pages || []) {
        if (p?.pageId) priorById.set(p.pageId, p);
      }
      // Keep site discovery / settle / last explore across mixed-mode runs on same stem
      priorManifestMeta = {
        discovery: prior.discovery,
        settle: prior.settle,
        exploreHistory: prior.exploreHistory || (prior.explore ? [prior.explore] : undefined),
      };
    } catch {
      // ignore
    }
  }

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const pageId = pageIdFromUrl(url, i);
      const dir = path.join(outRoot, pageId);
      const treePath = path.join(dir, 'compact.tree.txt');

      if (skipExisting && fs.existsSync(treePath)) {
        skipped++;
        console.error(`Skip existing ${pageId}`);
        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(dir, 'observe-meta.json'), 'utf8'));
        } catch {
          // ignore
        }
        pages.push({
          pageId,
          url: meta.finalUrl || url,
          title: meta.title || '',
          compactTokens: meta.compact?.estTokens,
          deepTokens: meta.deep?.estTokens,
          skipped: true,
          blocked: meta.blocked || undefined,
          error: meta.blocked
            ? `blocked:${meta.settle?.interstitial?.kind || 'interstitial'}`
            : undefined,
          blockReasons: meta.blockReasons || meta.settle?.interstitial?.reasons,
          paths: {
            tree: path.relative(root, treePath).replace(/\\/g, '/'),
            compact: path.relative(root, path.join(dir, 'compact.json')).replace(/\\/g, '/'),
            meta: path.relative(root, path.join(dir, 'observe-meta.json')).replace(/\\/g, '/'),
            deep: withDeep || fs.existsSync(path.join(dir, 'deep.json'))
              ? path.relative(root, path.join(dir, 'deep.json')).replace(/\\/g, '/')
              : undefined,
          },
        });
        continue;
      }

      console.error(`Dumping ${i + 1}/${urls.length} ${pageId}: ${url}`);
      const t0 = performance.now();
      let settleMeta = null;
      try {
        settleMeta = await settlePage(page, {
          url,
          waitUntil,
          settleMs,
          readySelector,
          scroll,
          spa,
          autoCsr,
          timeout: 90_000,
        });
        if (settleMeta.thinShell) {
          console.error(
            `  warn: still thin after CSR settle (text=${settleMeta.probeAfterRetry?.textLen ?? settleMeta.probe?.textLen})`,
          );
        } else if (settleMeta.retries?.length) {
          console.error(`  settle retries: ${settleMeta.retries.join(',')}`);
        }
      } catch (err) {
        console.error(`  navigate failed: ${err.message || err}`);
        pages.push({ pageId, url, error: String(err.message || err) });
        continue;
      }

      const blocked = Boolean(settleMeta?.interstitial?.blocked);
      if (blocked) {
        console.error(
          `  blocked (${settleMeta.interstitial.kind || 'interstitial'}): ${(settleMeta.interstitial.reasons || []).join(',') || 'unknown'}`,
        );
      }

      let expandMeta = null;
      // Skip expand on bot walls — clicks won't help and may confuse metrics
      if (expand && !blocked) {
        const e0 = performance.now();
        try {
          expandMeta = await expandUi(page);
          expandMeta.ms = Math.round(performance.now() - e0);
        } catch (err) {
          expandMeta = { ok: false, error: String(err.message || err) };
        }
      }
      const navMs = Math.round(performance.now() - t0);

      const c0 = performance.now();
      const compact = await runCompactObserve(page, { includeCollapsedNav });
      const compactMs = Math.round(performance.now() - c0);
      const compactText = formatCompactTree(compact);

      writeJsonOrText(treePath, compactText);
      writeJsonOrText(path.join(dir, 'compact.json'), compact);

      let deepMeta;
      if (withDeep && !blocked) {
        const d0 = performance.now();
        const deep = await runDeepInventory(page);
        const deepMs = Math.round(performance.now() - d0);
        writeJsonOrText(path.join(dir, 'deep.json'), deep);
        deepMeta = {
          ms: deepMs,
          bytes: byteLength(JSON.stringify(deep)),
          estTokens: estimateTokens(deep),
          summary: summarizeDeep(deep),
        };
      }

      const meta = {
        stem,
        pageId,
        url,
        finalUrl: page.url(),
        title: await page.title(),
        viewport: { width: 1920, height: 1080 },
        navMs,
        settle: settleMeta,
        blocked: blocked || undefined,
        blockReasons: blocked ? settleMeta.interstitial?.reasons : undefined,
        expand: expand && !blocked,
        expandMeta,
        capturedAt: new Date().toISOString(),
        compact: {
          ms: compactMs,
          bytes: byteLength(compactText),
          estTokens: estimateTokens(compactText),
          summary: summarizeCompact(compact),
        },
        deep: deepMeta,
      };
      writeJsonOrText(path.join(dir, 'observe-meta.json'), meta);
      const pageEntry = {
        pageId,
        url: meta.finalUrl,
        title: meta.title,
        compactTokens: meta.compact.estTokens,
        deepTokens: deepMeta?.estTokens,
        paths: {
          tree: path.relative(root, treePath).replace(/\\/g, '/'),
          compact: path.relative(root, path.join(dir, 'compact.json')).replace(/\\/g, '/'),
          meta: path.relative(root, path.join(dir, 'observe-meta.json')).replace(/\\/g, '/'),
          deep: withDeep && !blocked
            ? path.relative(root, path.join(dir, 'deep.json')).replace(/\\/g, '/')
            : undefined,
        },
      };
      if (blocked) {
        pageEntry.error = `blocked:${settleMeta.interstitial?.kind || 'interstitial'}`;
        pageEntry.blocked = true;
        pageEntry.blockReasons = settleMeta.interstitial?.reasons || [];
      }
      pages.push(pageEntry);
    }
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }

  // Merge: prior pages not touched in this run stay in the catalog
  for (const p of pages) {
    if (p?.pageId) priorById.set(p.pageId, p);
  }
  // Also pick up any on-disk folders with observe-meta (recovery after clobber)
  for (const ent of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const metaPath = path.join(outRoot, ent.name, 'observe-meta.json');
    if (!fs.existsSync(metaPath) || priorById.has(ent.name)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const treePath = path.join(outRoot, ent.name, 'compact.tree.txt');
      priorById.set(ent.name, {
        pageId: ent.name,
        url: meta.finalUrl || meta.url,
        title: meta.title || '',
        compactTokens: meta.compact?.estTokens,
        deepTokens: meta.deep?.estTokens,
        blocked: meta.blocked || undefined,
        error: meta.blocked
          ? `blocked:${meta.settle?.interstitial?.kind || 'interstitial'}`
          : undefined,
        blockReasons: meta.blockReasons || meta.settle?.interstitial?.reasons,
        paths: {
          tree: path.relative(root, treePath).replace(/\\/g, '/'),
          compact: path.relative(root, path.join(outRoot, ent.name, 'compact.json')).replace(/\\/g, '/'),
          meta: path.relative(root, metaPath).replace(/\\/g, '/'),
          deep: fs.existsSync(path.join(outRoot, ent.name, 'deep.json'))
            ? path.relative(root, path.join(outRoot, ent.name, 'deep.json')).replace(/\\/g, '/')
            : undefined,
        },
      });
    } catch {
      // ignore
    }
  }

  const mergedPages = [...priorById.values()].sort((a, b) =>
    String(a.pageId).localeCompare(String(b.pageId)),
  );
  const okPages = mergedPages.filter((p) => !p.error && !p.blocked);
  const thisRunFailed = pages.filter((p) => p.error || p.blocked).length;
  const blockedCount = mergedPages.filter((p) => p.blocked || String(p.error || '').startsWith('blocked:')).length;
  const failedTotal = mergedPages.filter((p) => p.error || p.blocked).length;
  const exploreHistory = [
    ...(priorManifestMeta.exploreHistory || []),
    ...(extraManifest.explore ? [extraManifest.explore] : []),
  ].slice(-20);
  const manifest = {
    stem,
    capturedAt: new Date().toISOString(),
    baseUrl: urls[0],
    withDeep,
    pageCount: okPages.length,
    skippedExisting: skipped,
    failed: failedTotal,
    failedThisRun: thisRunFailed,
    blocked: blockedCount,
    totalCompactTokens: okPages.reduce((s, p) => s + (p.compactTokens || 0), 0),
    totalDeepTokens: okPages.some((p) => p.deepTokens)
      ? okPages.reduce((s, p) => s + (p.deepTokens || 0), 0)
      : undefined,
    pages: mergedPages,
    // Prior site metadata first; this run's extraManifest wins on overlap
    ...(priorManifestMeta.discovery ? { discovery: priorManifestMeta.discovery } : {}),
    ...(priorManifestMeta.settle ? { settle: priorManifestMeta.settle } : {}),
    ...(exploreHistory.length ? { exploreHistory } : {}),
    ...extraManifest,
  };
  writeJsonOrText(path.join(outRoot, 'manifest.json'), manifest);
  writeJsonOrText(
    path.join(outRoot, 'README.md'),
    `# dom-miner dump: ${stem}

Generated by dom-miner.

- **Pages:** ${manifest.pageCount} (this run skipped existing: ${skipped}, failed: ${manifest.failed}, blocked: ${blockedCount})
- **Compact tokens (sum):** ${manifest.totalCompactTokens}
${manifest.totalDeepTokens != null ? `- **Deep tokens (sum):** ${manifest.totalDeepTokens}\n` : ''}${
      extraManifest.discovery
        ? `- **URL discovery:** ${extraManifest.discovery.source}${extraManifest.discovery.sitemapUrl ? ` (${extraManifest.discovery.sitemapUrl})` : ''}\n`
        : ''
    }
## Pages

${okPages
  .map((p) => `- **${p.pageId}** — ${p.title || p.url}${p.skipped ? ' _(cached)_' : ''}\n  - \`${p.paths?.tree || ''}\``)
  .join('\n')}
${
  blockedCount
    ? `\n## Blocked (Cloudflare / bot wall)\n\n${mergedPages
        .filter((p) => p.blocked || String(p.error || '').startsWith('blocked:'))
        .map((p) => `- **${p.pageId}** — ${p.url} (${(p.blockReasons || []).join(',') || p.error})`)
        .join('\n')}\n`
    : ''
}
`,
  );

  return { outRoot, manifest };
}
