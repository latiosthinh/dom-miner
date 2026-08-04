// @ts-nocheck
/**
 * Discover same-origin page URLs from a homepage.
 * Prefer robots.txt → sitemap.xml; fall back to /sitemap.xml; optional crawl.
 */
import { settlePage } from './settle-page.js';

const UA = 'dom-miner/0.1';

export async function fetchText(url, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export function stemFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'site';
  } catch {
    return 'site';
  }
}

export function sameOrigin(url, baseUrl) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function stripNs(xml) {
  return xml.replace(/\sxmlns(:\w+)?="[^"]*"/g, '');
}

function extractTagBlocks(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function extractTagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

export async function resolveSitemapUrl(homeUrl) {
  const origin = new URL(homeUrl).origin;
  const candidates = [];

  try {
    const robots = await fetchText(new URL('/robots.txt', origin).href);
    for (const line of robots.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m?.[1]) candidates.push(m[1].trim());
    }
  } catch {
    // ignore
  }

  candidates.push(
    new URL('/sitemap.xml', origin).href,
    new URL('/sitemap_index.xml', origin).href,
    new URL('/sitemap-index.xml', origin).href,
  );

  const tried = new Set();
  for (const c of candidates) {
    if (tried.has(c)) continue;
    tried.add(c);
    try {
      const text = await fetchText(c);
      if (/<(urlset|sitemapindex)[\s>]/i.test(text)) {
        return { sitemapUrl: c, xml: text };
      }
    } catch {
      // next
    }
  }
  return null;
}

function pathDepth(url) {
  try {
    return (new URL(url).pathname || '/').split('/').filter(Boolean).length;
  } catch {
    return 999;
  }
}

export async function parseSitemapXml(xml, { baseUrl, visited = new Set() } = {}) {
  const cleaned = stripNs(xml);
  const entries = [];

  if (/<sitemapindex[\s>]/i.test(cleaned)) {
    for (const block of extractTagBlocks(cleaned, 'sitemap')) {
      const loc = extractTagText(block, 'loc');
      if (!loc || visited.has(loc)) continue;
      visited.add(loc);
      const childXml = await fetchText(loc);
      entries.push(...(await parseSitemapXml(childXml, { baseUrl, visited })));
    }
    return entries;
  }

  if (!/<urlset[\s>]/i.test(cleaned)) {
    throw new Error('Unsupported sitemap root (expected urlset or sitemapindex)');
  }

  for (const block of extractTagBlocks(cleaned, 'url')) {
    const loc = extractTagText(block, 'loc');
    if (!loc) continue;
    if (baseUrl && !sameOrigin(loc, baseUrl)) continue;
    let priority = 0.5;
    const rawPri = extractTagText(block, 'priority');
    if (rawPri) {
      const n = Number(rawPri);
      if (!Number.isNaN(n)) priority = Math.max(0, Math.min(1, n));
    }
    const lastmod = extractTagText(block, 'lastmod') || undefined;
    entries.push({ url: loc.split('#')[0], priority, lastmod });
  }
  return entries;
}

export function sortAndRank(entries) {
  const byUrl = new Map();
  for (const e of entries) {
    const prev = byUrl.get(e.url);
    if (!prev || e.priority > prev.priority) byUrl.set(e.url, e);
  }
  const list = [...byUrl.values()].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return pathDepth(a.url) - pathDepth(b.url) || a.url.localeCompare(b.url);
  });
  return list.map((e, i) => ({
    rank: i + 1,
    url: e.url,
    priority: e.priority,
    lastmod: e.lastmod,
    slug: slugFromUrl(e.url),
  }));
}

export function slugFromUrl(url) {
  try {
    const path = new URL(url).pathname || '/';
    const slug = path.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'homepage';
    return slug.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 120) || 'page';
  } catch {
    return 'page';
  }
}

/** Sanitize a user-supplied stem: allow only safe chars, max 80. */
export function sanitizeStem(str) {
  const s = String(str || '').trim();
  const clean = s.replace(/[^a-z0-9-_]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (clean || 'site').slice(0, 80);
}

export async function crawlFromPage(page, homeUrl, { maxUrls = 50, maxDepth = 2, spa = false } = {}) {
  const origin = new URL(homeUrl).origin;
  const queue = [{ url: page.url(), depth: 0 }];
  const seen = new Set();
  const found = [];

  while (queue.length && found.length < maxUrls) {
    const { url, depth } = queue.shift();
    const key = url.split('#')[0].replace(/\/$/, '') || url;
    if (seen.has(key)) continue;
    seen.add(key);

    if (depth > 0) {
      try {
        if (spa) {
          await settlePage(page, {
            url,
            spa: true,
            settleMs: 1200,
            timeout: 45_000,
            scroll: false,
          });
        } else {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(400);
        }
      } catch {
        continue;
      }
    }

    found.push({ url: page.url().split('#')[0], priority: Math.max(0.1, 1 - depth * 0.2) });
    if (depth >= maxDepth) continue;

    const hrefs = await page.evaluate((originHint) => {
      const out = [];
      document.querySelectorAll('a[href]').forEach((a) => {
        try {
          const u = new URL(a.href, location.href);
          if (u.origin !== originHint) return;
          if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|css|js)(\?|$)/i.test(u.pathname)) return;
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
          out.push(u.href.split('#')[0]);
        } catch (_) {}
      });
      return [...new Set(out)];
    }, origin);

    for (const h of hrefs) {
      const k = h.replace(/\/$/, '');
      if (!seen.has(k)) queue.push({ url: h, depth: depth + 1 });
    }
  }

  return sortAndRank(found);
}

export async function discoverSiteUrls(
  homeUrl,
  { sitemapUrl, page, crawlFallback = true, maxUrls = 200, spa = false } = {},
) {
  let source = 'none';
  let entries = [];
  let resolvedSitemap = sitemapUrl || null;

  try {
    if (sitemapUrl) {
      const xml = await fetchText(sitemapUrl);
      entries = await parseSitemapXml(xml, { baseUrl: homeUrl });
      source = 'sitemap';
    } else {
      const resolved = await resolveSitemapUrl(homeUrl);
      if (resolved) {
        resolvedSitemap = resolved.sitemapUrl;
        entries = await parseSitemapXml(resolved.xml, { baseUrl: homeUrl });
        source = 'sitemap';
      }
    }
  } catch (err) {
    console.error('Sitemap discovery failed:', err.message || err);
    entries = [];
  }

  if (!entries.length && crawlFallback && page) {
    source = 'crawl';
    const crawlLimit = Math.min(maxUrls, 300);
    const crawled = await crawlFromPage(page, homeUrl, { maxUrls: crawlLimit, maxDepth: 2, spa });
    return { source, sitemapUrl: resolvedSitemap, urls: crawled.slice(0, maxUrls) };
  }

  const homeAbs = new URL(homeUrl).href;
  const homeNorm = homeAbs.replace(/\/$/, '');
  if (!entries.some((e) => e.url.replace(/\/$/, '') === homeNorm || e.url === homeAbs)) {
    entries.unshift({ url: homeAbs, priority: 1 });
  }

  const ranked = sortAndRank(entries);
  return {
    source,
    sitemapUrl: resolvedSitemap,
    urls: ranked.slice(0, maxUrls),
  };
}
