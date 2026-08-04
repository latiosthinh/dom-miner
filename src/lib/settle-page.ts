// @ts-nocheck
/**
 * Navigate + wait until the live DOM is usable for compact/deep reads.
 * Handles CSR / SPA shells that paint after domcontentloaded.
 */

/** @typedef {'commit'|'domcontentloaded'|'load'|'networkidle'} WaitUntil */

/**
 * @param {import('playwright-core').Page} page
 */
export async function probePageRichness(page) {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) {
      return { textLen: 0, interactive: 0, landmarks: 0, rootKids: 0, hasSpaRoot: false };
    }
    const text = (body.innerText || '').replace(/\s+/g, ' ').trim();
    const interactive = body.querySelectorAll(
      'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="menuitem"]',
    ).length;
    const landmarks = body.querySelectorAll(
      'main,nav,header,footer,h1,h2,[role="main"],[role="navigation"]',
    ).length;
    const root = document.querySelector('#root, #app, #__next, [data-reactroot], [ng-version]');
    return {
      textLen: text.length,
      interactive,
      landmarks,
      rootKids: root ? root.children.length : -1,
      hasSpaRoot: Boolean(root),
    };
  });
}

/**
 * Thin CSR shell: almost no copy / controls yet (typical empty #root).
 * @param {{ textLen: number, interactive: number, landmarks: number }} probe
 */
export function isThinShell(probe) {
  if (!probe) return true;
  return probe.textLen < 80 && probe.interactive < 3 && probe.landmarks < 2;
}

/**
 * Detect Cloudflare / bot-challenge / hard-block interstitials.
 * These must not be treated as successful page maps for QA.
 * @param {import('playwright-core').Page} page
 */
export async function detectInterstitialPage(page) {
  return page.evaluate(() => {
    const title = (document.title || '').trim();
    const titleL = title.toLowerCase();
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const textL = text.toLowerCase();
    const htmlHead = (document.documentElement?.innerHTML || '').slice(0, 8000).toLowerCase();
    const reasons = [];

    if (
      /attention required|just a moment|cloudflare|access denied|attention required!/.test(titleL)
    ) {
      reasons.push('title');
    }
    if (
      /sorry, you have been blocked|you are unable to access|checking your browser before|enable javascript and cookies to continue|cf-browser-verification|challenge-platform|turnstile/.test(
        textL,
      ) ||
      /cf-browser-verification|challenge-platform|cdn-cgi\/challenge|turnstile/.test(htmlHead)
    ) {
      reasons.push('body');
    }
    if (
      document.querySelector(
        '#challenge-form, #cf-challenge-running, .cf-browser-verification, #cf-wrapper, [name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com"]',
      )
    ) {
      reasons.push('dom');
    }

    return {
      blocked: reasons.length > 0,
      kind: reasons.length ? 'cloudflare-or-bot' : null,
      reasons,
      title,
      textSample: text.slice(0, 160),
    };
  });
}

/**
 * Scroll through the page to trigger lazy / intersection-observer content.
 * @param {import('playwright-core').Page} page
 */
export async function scrollPageForLazy(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
    const maxY = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    );
    for (let y = 0; y < maxY; y += step) {
      window.scrollTo(0, y);
      await delay(120);
    }
    window.scrollTo(0, 0);
    await delay(150);
  });
}

/**
 * @param {import('playwright-core').Page} page
 * @param {object} opts
 * @param {string} opts.url
 * @param {WaitUntil} [opts.waitUntil]
 * @param {number} [opts.settleMs]
 * @param {string} [opts.readySelector] - CSS selector that must become visible
 * @param {number} [opts.readyTimeout]
 * @param {boolean} [opts.scroll] - scroll for lazy content
 * @param {boolean} [opts.spa] - CSR/SPA presets (stronger waits + auto thin-shell retry)
 * @param {boolean} [opts.autoCsr] - retry when thin shell (default true)
 * @param {number} [opts.timeout] - navigation timeout
 * @param {boolean} [opts.navigate] - if false, only settle current page (no goto)
 */
export async function settlePage(page, opts) {
  const {
    url,
    waitUntil: waitUntilIn = 'domcontentloaded',
    settleMs = 1500,
    readySelector = '',
    readyTimeout = 30_000,
    scroll = false,
    spa = false,
    autoCsr = true,
    timeout = 90_000,
    navigate = true,
  } = opts;

  /** @type {WaitUntil} */
  const waitUntil =
    spa && waitUntilIn === 'domcontentloaded' ? 'load' : waitUntilIn;
  const effectiveSettle = spa ? Math.max(settleMs, 3000) : settleMs;
  const doScroll = spa || scroll;
  const doAutoCsr = spa || autoCsr;

  const meta = {
    url,
    waitUntil,
    settleMs: effectiveSettle,
    spa,
    scroll: doScroll,
    readySelector: readySelector || undefined,
    readyOk: undefined,
    readyError: undefined,
    retries: /** @type {string[]} */ ([]),
    probe: undefined,
    probeAfterRetry: undefined,
    thinShell: undefined,
  };

  if (navigate) {
    await page.goto(url, { waitUntil, timeout });
  }

  if (readySelector) {
    try {
      await page.waitForSelector(readySelector, { state: 'visible', timeout: readyTimeout });
      meta.readyOk = true;
    } catch (err) {
      meta.readyOk = false;
      meta.readyError = String(err?.message || err);
    }
  }

  await page.waitForTimeout(effectiveSettle);

  if (doScroll) {
    try {
      await scrollPageForLazy(page);
      meta.retries.push('scroll');
    } catch {
      // ignore scroll failures
    }
  }

  let probe = await probePageRichness(page);
  meta.probe = probe;

  if (doAutoCsr && isThinShell(probe)) {
    // Prefer quiet network, then wait until the shell gains content.
    try {
      await page.waitForLoadState('networkidle', { timeout: 20_000 });
      meta.retries.push('networkidle');
    } catch {
      meta.retries.push('networkidle-timeout');
    }

    try {
      await page.waitForFunction(
        () => {
          const t = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
          const n = document.querySelectorAll(
            'a[href],button,input,main,h1,h2,[role="main"]',
          ).length;
          return t.length >= 80 || n >= 5;
        },
        { timeout: 20_000 },
      );
      meta.retries.push('content');
    } catch {
      meta.retries.push('content-timeout');
    }

    await page.waitForTimeout(Math.min(effectiveSettle, 2000));

    if (doScroll) {
      try {
        await scrollPageForLazy(page);
      } catch {
        // ignore
      }
    }

    probe = await probePageRichness(page);
    meta.probeAfterRetry = probe;
  }

  meta.thinShell = isThinShell(probe);

  try {
    meta.interstitial = await detectInterstitialPage(page);
  } catch {
    meta.interstitial = { blocked: false, reasons: [], error: 'probe-failed' };
  }

  return meta;
}
