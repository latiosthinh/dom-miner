import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-core';
import { authenticate, isLoginPage } from '../dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loginPath = path.join(__dirname, 'fixtures', 'login.html');
const loginUrl = `file://${loginPath.replace(/\\/g, '/')}`;

let browser, page;

before(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
});

after(async () => {
  await browser.close();
});

describe('isLoginPage', () => {
  it('detects a login page', async () => {
    await page.goto(loginUrl);
    const result = await isLoginPage(page);
    assert.strictEqual(result, true);
  });

  it('does not detect a non-login page', async () => {
    await page.goto('data:text/html,<h1>Hello World</h1>');
    const result = await isLoginPage(page);
    assert.strictEqual(result, false);
  });
});

describe('authenticate', () => {
  it('fills credentials and submits the form', async () => {
    await page.goto(loginUrl);
    const result = await authenticate(page, { username: 'test@example.com', password: 'secret123' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.method, 'form');

    // Verify the page changed to authenticated state
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.ok(bodyText.includes('Authenticated'));
    assert.ok(bodyText.includes('test@example.com'));
  });

  it('fails gracefully on a page without a login form', async () => {
    await page.goto('data:text/html,<h1>No Form Here</h1>');
    const result = await authenticate(page, { username: 'x', password: 'y' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.length > 0);
  });
});
