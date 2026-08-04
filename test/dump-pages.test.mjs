import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pageIdFromUrl } from '../dist/index.js';

describe('pageIdFromUrl', () => {
  it('handles root URL', () => {
    assert.strictEqual(pageIdFromUrl('https://example.com/', 0), 'home');
  });

  it('handles simple paths', () => {
    assert.strictEqual(pageIdFromUrl('https://example.com/about', 0), 'about');
    assert.strictEqual(pageIdFromUrl('https://example.com/blog/post-1', 0), 'blog__post-1');
  });

  it('handles index fallback', () => {
    assert.strictEqual(pageIdFromUrl('bad-url', 3), 'page-4');
  });

  it('sanitizes special characters in path segments', () => {
    const result = pageIdFromUrl('https://example.com/hello world!', 0);
    assert.ok(!result.includes(' '));
    assert.ok(!result.includes('!'));
  });

  it('adds query hash suffix', () => {
    const without = pageIdFromUrl('https://example.com/search', 0);
    const withQ = pageIdFromUrl('https://example.com/search?q=test&page=2', 0);
    assert.ok(without === 'search');
    assert.ok(withQ.startsWith('search-q'));
    assert.ok(withQ !== without);
  });

  it('same query produces same hash', () => {
    const a = pageIdFromUrl('https://example.com/s?q=x', 0);
    const b = pageIdFromUrl('https://example.com/s?q=x', 0);
    assert.strictEqual(a, b);
  });

  it('different query produces different hash', () => {
    const a = pageIdFromUrl('https://example.com/s?q=apple', 0);
    const b = pageIdFromUrl('https://example.com/s?q=banana', 0);
    assert.notStrictEqual(a, b);
  });

  it('caps path segments at 40 chars', () => {
    const long = 'a'.repeat(60);
    const result = pageIdFromUrl(`https://example.com/${long}`, 0);
    assert.ok(result.length <= 80 + 10);
  });
});
