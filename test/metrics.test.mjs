import { describe, it } from 'node:test';
import assert from 'node:assert';
import { estimateTokens, byteLength, summarizeCompact, summarizeDeep } from '../dist/index.js';

describe('estimateTokens', () => {
  it('estimates tokens from string', () => {
    assert.strictEqual(estimateTokens('abcd'), 1);
    assert.strictEqual(estimateTokens('abcdefgh'), 2);
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('handles non-string input via JSON.stringify', () => {
    assert.ok(estimateTokens({ a: 1 }) > 0);
  });
});

describe('byteLength', () => {
  it('returns UTF-8 byte length', () => {
    assert.strictEqual(byteLength('hello'), 5);
    assert.strictEqual(byteLength('café'), 5);
  });

  it('handles non-string input', () => {
    assert.ok(byteLength([1, 2, 3]) > 0);
  });
});

describe('summarizeDeep', () => {
  it('returns expected summary fields', () => {
    const deep = {
      elementCount: 100,
      visibleCount: 60,
      hiddenCount: 40,
      anchorCount: 30,
      buttonCount: 10,
      elements: [
        { playwrightLocator: 'getByRole("button")' },
        { playwrightLocator: null },
      ],
    };
    const summary = summarizeDeep(deep);
    assert.strictEqual(summary.elementCount, 100);
    assert.strictEqual(summary.visibleCount, 60);
    assert.strictEqual(summary.hiddenCount, 40);
    assert.strictEqual(summary.anchorCount, 30);
    assert.strictEqual(summary.buttonCount, 10);
    assert.strictEqual(summary.withLocator, 1);
  });

  it('handles empty elements array', () => {
    const summary = summarizeDeep({ elements: [] });
    assert.strictEqual(summary.withLocator, 0);
  });
});

describe('summarizeCompact', () => {
  it('returns expected summary fields', () => {
    const compact = {
      interactableCount: 20,
      textHolderCount: 15,
      headingCount: 3,
      visibleCount: 18,
      collapsedNavCount: 5,
      interactables: [
        { collapsed: false, playwrightLocator: { kind: 'getByRole' }, region: 'main' },
        { collapsed: true, playwrightLocator: null, region: 'nav' },
      ],
      textHolders: [
        { region: 'main' },
        { region: 'header' },
      ],
    };
    const summary = summarizeCompact(compact);
    assert.strictEqual(summary.interactableCount, 20);
    assert.strictEqual(summary.textHolderCount, 15);
    assert.strictEqual(summary.headingCount, 3);
    assert.strictEqual(summary.withLocator, 1);
    assert.ok(summary.regions.includes('main'));
    assert.ok(summary.regions.includes('nav'));
  });
});
