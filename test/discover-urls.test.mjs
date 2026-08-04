import { describe, it } from 'node:test';
import assert from 'node:assert';
import { stemFromUrl, slugFromUrl, sanitizeStem, sameOrigin, sortAndRank } from '../dist/index.js';

describe('stemFromUrl', () => {
  it('extracts stem from hostname', () => {
    assert.strictEqual(stemFromUrl('https://www.example.com/'), 'example');
    assert.strictEqual(stemFromUrl('https://blog.example.org/page'), 'blog');
  });

  it('falls back to "site" on invalid URL', () => {
    assert.strictEqual(stemFromUrl('not-a-url'), 'site');
  });
});

describe('slugFromUrl', () => {
  it('converts path to slug', () => {
    assert.strictEqual(slugFromUrl('https://example.com/'), 'homepage');
    assert.strictEqual(slugFromUrl('https://example.com/about'), 'about');
    assert.strictEqual(slugFromUrl('https://example.com/blog/post-1'), 'blog-post-1');
  });

  it('falls back to "page" on invalid URL', () => {
    assert.strictEqual(slugFromUrl('bad'), 'page');
  });
});

describe('sanitizeStem', () => {
  it('cleans unsafe characters', () => {
    assert.strictEqual(sanitizeStem('My Stem!'), 'my-stem');
    assert.strictEqual(sanitizeStem('../evil'), 'evil');
    assert.strictEqual(sanitizeStem('../../etc/passwd'), 'etc-passwd');
  });

  it('collapses and trims dashes', () => {
    assert.strictEqual(sanitizeStem('  a--b--c  '), 'a-b-c');
  });

  it('falls back to "site" for empty input', () => {
    assert.strictEqual(sanitizeStem(''), 'site');
    assert.strictEqual(sanitizeStem('!!!'), 'site');
  });

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(100);
    assert.strictEqual(sanitizeStem(long).length, 80);
  });
});

describe('sameOrigin', () => {
  it('matches same origin', () => {
    assert.strictEqual(sameOrigin('https://example.com/a', 'https://example.com/b'), true);
  });

  it('rejects different origins', () => {
    assert.strictEqual(sameOrigin('https://example.com/', 'https://other.com/'), false);
    assert.strictEqual(sameOrigin('http://example.com/', 'https://example.com/'), false);
  });

  it('handles invalid URLs gracefully', () => {
    assert.strictEqual(sameOrigin('not-a-url', 'https://example.com/'), false);
  });
});

describe('sortAndRank', () => {
  it('ranks by priority then depth', () => {
    const entries = [
      { url: 'https://example.com/deep/page', priority: 0.3 },
      { url: 'https://example.com/', priority: 1.0 },
      { url: 'https://example.com/about', priority: 0.8 },
    ];
    const ranked = sortAndRank(entries);
    assert.strictEqual(ranked[0].url, 'https://example.com/');
    assert.strictEqual(ranked[0].rank, 1);
    assert.strictEqual(ranked[1].url, 'https://example.com/about');
    assert.strictEqual(ranked[2].url, 'https://example.com/deep/page');
  });

  it('deduplicates by URL, keeping highest priority', () => {
    const entries = [
      { url: 'https://example.com/', priority: 0.5 },
      { url: 'https://example.com/', priority: 1.0 },
    ];
    const ranked = sortAndRank(entries);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].priority, 1.0);
  });
});
