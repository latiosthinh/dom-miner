// @ts-nocheck
/**
 * Parse a URL list from .txt / .csv / .json for explore-urls mode.
 *
 * Supported formats:
 *   - .txt / .list: one URL per line (# comments, blank lines ignored)
 *   - .csv: header with `url`/`URL` column, or first column
 *   - .json: string[], { urls: string[] | {url}[] }, or CompactDom urls-full.json
 */
import fs from 'node:fs';
import path from 'node:path';

function looksLikeUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function uniqUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    const u = String(raw || '').trim();
    if (!looksLikeUrl(u)) continue;
    const key = u.replace(/\/$/, '') || u;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function parseTxt(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const urlIdx = header.findIndex((h) => /^url$/i.test(h));
  if (urlIdx >= 0) {
    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return cols[urlIdx];
    });
  }
  // No header — first column, or whole line if it looks like a URL
  const start = looksLikeUrl(header[0]) ? 0 : 1;
  return lines.slice(start).map((line) => {
    if (looksLikeUrl(line)) return line;
    return line.split(',')[0].trim().replace(/^"|"$/g, '');
  });
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    return data.map((item) => (typeof item === 'string' ? item : item?.url)).filter(Boolean);
  }
  if (Array.isArray(data?.urls)) {
    return data.urls.map((item) => (typeof item === 'string' ? item : item?.url)).filter(Boolean);
  }
  if (Array.isArray(data?.pages)) {
    return data.pages.map((p) => p?.url || p?.finalUrl).filter(Boolean);
  }
  throw new Error('JSON must be string[], { urls: [...] }, urls-full.json, or { pages: [{url}] }');
}

/**
 * @param {string} filePath
 * @returns {{ urls: string[], source: string, format: string }}
 */
export function loadUrlsFromFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`URL list file not found: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  let raw;
  let format;
  if (ext === '.json') {
    raw = parseJson(text);
    format = 'json';
  } else if (ext === '.csv') {
    raw = parseCsv(text);
    format = 'csv';
  } else {
    // .txt, .list, no ext, or unknown → line-oriented
    raw = parseTxt(text);
    format = ext === '.txt' || ext === '.list' ? ext.slice(1) : 'txt';
  }
  const urls = uniqUrls(raw);
  if (!urls.length) {
    throw new Error(`No http(s) URLs found in ${abs}`);
  }
  return { urls, source: abs, format };
}
