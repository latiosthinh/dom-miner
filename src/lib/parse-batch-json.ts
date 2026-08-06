// @ts-nocheck
/**
 * Parse a batch JSON file for explore-urls mode.
 *
 * Supported formats:
 *   - { url: string, credential?: { username: string, password: string } }
 *   - [{ url, credential? }, ...]
 *   - { urls: [{ url, credential? }, ...] }
 *   - { pages: [{ url, credential? }, ...] }
 */
import fs from 'node:fs';
import path from 'node:path';

function looksLikeUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

/**
 * @param {string} filePath
 * @returns {{ entries: Array<{url: string, credential?: {username: string, password: string}}>, source: string, format: string }}
 */
export function loadBatchFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Batch file not found: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in batch file: ${abs}`);
  }

  const entries = normalizeEntries(raw);
  if (!entries.length) {
    throw new Error(`No valid URL entries found in ${abs}`);
  }

  return { entries, source: abs, format: 'json-batch' };
}

function normalizeEntries(data) {
  // Single entry
  if (isUrlEntry(data)) {
    return [data];
  }

  // Array of entries
  if (Array.isArray(data)) {
    return data.filter(isUrlEntry);
  }

  // { urls: [...] }
  if (Array.isArray(data?.urls)) {
    return data.urls.filter(isUrlEntry);
  }

  // { pages: [...] }
  if (Array.isArray(data?.pages)) {
    return data.pages
      .map((p) => ({
        url: p?.url || p?.finalUrl,
        credential: p?.credential,
      }))
      .filter(isUrlEntry);
  }

  // { url: "...", ... } at root level (not an entry object, but a wrapper)
  if (typeof data === 'object') {
    const entries = [];
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (typeof val === 'string' && looksLikeUrl(val)) {
        entries.push({ url: val });
      } else if (isUrlEntry(val)) {
        entries.push(val);
      }
    }
    if (entries.length) return entries;
  }

  throw new Error(
    'Batch JSON must be: {url, credential?}, [{url, credential?}], {urls:[...]}, or {pages:[...]}'
  );
}

function isUrlEntry(item) {
  if (!item || typeof item !== 'object') return false;
  if (!item.url || !looksLikeUrl(item.url)) return false;
  if (item.credential) {
    if (!item.credential.username || !item.credential.password) {
      return false;
    }
  }
  return true;
}
