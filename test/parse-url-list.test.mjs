import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadUrlsFromFile } from '../dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(__dirname, 'fixtures', name);

describe('loadUrlsFromFile', () => {
  it('parses .txt files with comments and blanks', () => {
    const result = loadUrlsFromFile(fix('urls.txt'));
    assert.strictEqual(result.format, 'txt');
    assert.strictEqual(result.urls.length, 4);
    assert.strictEqual(result.urls[0], 'https://example.com/');
    assert.strictEqual(result.urls[1], 'https://example.com/about');
    assert.strictEqual(result.urls[2], 'https://example.com/contact');
    assert.strictEqual(result.urls[3], 'https://example.com/blog/post-1');
  });

  it('parses .csv with url header', () => {
    const result = loadUrlsFromFile(fix('urls.csv'));
    assert.strictEqual(result.format, 'csv');
    assert.strictEqual(result.urls.length, 3);
    assert.strictEqual(result.urls[0], 'https://example.com/');
  });

  it('parses .json { urls: [...] }', () => {
    const result = loadUrlsFromFile(fix('urls.json'));
    assert.strictEqual(result.format, 'json');
    assert.strictEqual(result.urls.length, 2);
    assert.strictEqual(result.urls[0], 'https://example.com/');
  });

  it('parses .json string[]', () => {
    const result = loadUrlsFromFile(fix('urls-array.json'));
    assert.strictEqual(result.format, 'json');
    assert.strictEqual(result.urls.length, 2);
  });

  it('throws on missing file', () => {
    assert.throws(() => loadUrlsFromFile(fix('nonexistent.txt')), /not found/i);
  });

  it('throws when no valid URLs found', () => {
    const tmp = path.join(__dirname, 'fixtures', 'empty.txt');
    writeFileSync(tmp, '# only comments\n\n');
    assert.throws(() => loadUrlsFromFile(tmp), /no.*url/i);
    rmSync(tmp);
  });

  it('deduplicates URLs', () => {
    const tmp = path.join(__dirname, 'fixtures', 'dupes.txt');
    writeFileSync(tmp, 'https://a.com/\nhttps://a.com\nhttps://b.com/\n');
    const result = loadUrlsFromFile(tmp);
    assert.strictEqual(result.urls.length, 2);
    rmSync(tmp);
  });
});
