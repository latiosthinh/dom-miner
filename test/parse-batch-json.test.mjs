import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadBatchFile } from '../dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(__dirname, 'fixtures', name);

describe('loadBatchFile', () => {
  it('parses single entry', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-single.json');
    writeFileSync(tmp, JSON.stringify({ url: 'https://example.com/' }));
    const result = loadBatchFile(tmp);
    assert.strictEqual(result.format, 'json-batch');
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].url, 'https://example.com/');
    assert.strictEqual(result.entries[0].credential, undefined);
    rmSync(tmp);
  });

  it('parses array of entries', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-array.json');
    writeFileSync(tmp, JSON.stringify([
      { url: 'https://a.com/' },
      { url: 'https://b.com/', credential: { username: 'user', password: 'pass' } },
    ]));
    const result = loadBatchFile(tmp);
    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[1].credential.username, 'user');
    assert.strictEqual(result.entries[1].credential.password, 'pass');
    rmSync(tmp);
  });

  it('parses { urls: [...] } format', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-urls.json');
    writeFileSync(tmp, JSON.stringify({
      urls: [
        { url: 'https://x.com/' },
        { url: 'https://y.com/', credential: { username: 'admin', password: 'secret' } },
      ],
    }));
    const result = loadBatchFile(tmp);
    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0].url, 'https://x.com/');
    rmSync(tmp);
  });

  it('filters out invalid entries', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-mixed.json');
    writeFileSync(tmp, JSON.stringify([
      { url: 'https://valid.com/' },
      { url: 'not-a-url' },
      { url: 'https://good.com/', credential: { username: 'x' } }, // missing password
      { notUrl: 'https://trick.com/' },
    ]));
    const result = loadBatchFile(tmp);
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].url, 'https://valid.com/');
    rmSync(tmp);
  });

  it('throws on missing file', () => {
    assert.throws(() => loadBatchFile(fix('nonexistent.json')), /not found/i);
  });

  it('throws on invalid JSON', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-bad.json');
    writeFileSync(tmp, '{ invalid json }');
    assert.throws(() => loadBatchFile(tmp), /invalid json/i);
    rmSync(tmp);
  });

  it('throws when no valid entries', () => {
    const tmp = path.join(__dirname, 'fixtures', 'batch-empty.json');
    writeFileSync(tmp, JSON.stringify([{ url: 'not-a-url' }, { foo: 'bar' }]));
    assert.throws(() => loadBatchFile(tmp), /no valid.*url/i);
    rmSync(tmp);
  });
});
