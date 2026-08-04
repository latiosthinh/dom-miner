// @ts-nocheck
/**
 * Compact DOM trees for QA workflows — not raw HTML, not interactive-only.
 *
 * Includes:
 * - landmarks / regions (header, nav, main, footer, overlay, body)
 * - text-holders (headings, paragraphs, list items, labels, captions) — truncated
 * - interactive controls with numeric IDs (+ optional collapsed nav children)
 *
 * Site-level URL inventory remains separate (sitemap urls-full.json).
 * This module is the per-page "agent page map".
 */

function buildCompactDomScript() {
  return (opts) => {
    const includeCollapsedNav = opts?.includeCollapsedNav !== false;
    const maxTextHolders = opts?.maxTextHolders ?? 80;
    const maxTextLen = opts?.maxTextLen ?? 120;

    const INTERACTIVE =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="switch"]';

    const TEXT_HOLDERS = 'h1, h2, h3, h4, h5, h6, p, li, label, figcaption, th, td, [role="heading"]';

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0' &&
        !el.closest('[hidden], [aria-hidden="true"]')
      );
    }

    function inNavChrome(el) {
      return Boolean(
        el.closest('nav, [role="navigation"], header, [class*="menu" i], [class*="submenu" i]'),
      );
    }

    function region(el) {
      if (el.closest('[role="dialog"], [class*="modal" i], [class*="drawer" i]')) return 'overlay';
      if (el.closest('nav, [role="navigation"]')) return 'nav';
      if (el.closest('header')) return 'header';
      if (el.closest('footer')) return 'footer';
      if (el.closest('main, [role="main"]')) return 'main';
      if (el.closest('aside, [role="complementary"]')) return 'aside';
      return 'body';
    }

    function normText(el, max) {
      const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!t) return '';
      return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }

    function roleOf(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button' || tag === 'summary') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'submit' || t === 'button') return 'button';
        return 'textbox';
      }
      return tag;
    }

    function accessibleName(el) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const t = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean)
          .join(' ');
        if (t) return t.replace(/\s+/g, ' ').slice(0, 80);
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (el.id) {
        const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label?.textContent) return label.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
      }
      const parentLabel = el.closest('label');
      if (parentLabel?.textContent) return parentLabel.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (el.placeholder) return String(el.placeholder).trim().slice(0, 80);
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) return text.slice(0, 80);
      return el.getAttribute('name') || el.getAttribute('title') || '';
    }

    function suggestLocator(el, role, name) {
      const testId = el.getAttribute('data-testid');
      if (testId) return { kind: 'getByTestId', testId };
      if (name && (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem')) {
        return { kind: 'getByRole', role, name };
      }
      if (name && (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio')) {
        return { kind: 'getByLabel', name };
      }
      if (el.getAttribute('placeholder')) {
        return { kind: 'getByPlaceholder', name: el.getAttribute('placeholder') };
      }
      if (el.id && !/^(react|ember|mui|css|radix)/i.test(el.id)) {
        return { kind: 'locator', selector: '#' + CSS.escape(el.id) };
      }
      return null;
    }

    // --- text-holders (content map) ---
    const textSeen = new Set();
    const textHolders = [];
    for (const el of document.querySelectorAll(TEXT_HOLDERS)) {
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      // Skip text that is only inside a link/button (covered as interactive name)
      if (el.closest('a[href], button, [role="button"]') && !/^H[1-6]$/.test(el.tagName)) continue;
      // Skip list items that are just a single link wrapper (duplicate of interactive)
      if (el.tagName === 'LI') {
        const links = el.querySelectorAll('a[href], button');
        if (links.length === 1 && normText(el, maxTextLen) === normText(links[0], maxTextLen)) continue;
      }
      const text = normText(el, maxTextLen);
      if (!text || text.length < 2) continue;
      const tag = el.tagName.toLowerCase();
      const key = tag + '|' + text;
      if (textSeen.has(key)) continue;
      textSeen.add(key);
      textHolders.push({
        kind: 'text',
        tag,
        role: el.getAttribute('role') || (/^h[1-6]$/.test(tag) ? 'heading' : tag),
        level: /^h[1-6]$/.test(tag) ? Number(tag[1]) : undefined,
        text,
        region: region(el),
      });
      if (textHolders.length >= maxTextHolders) break;
    }

    // --- interactive ---
    const seen = new Set();
    const interactables = [];
    let nextId = 1;

    function pushInteractive(el, collapsed) {
      if (!(el instanceof HTMLElement)) return;
      const role = roleOf(el);
      const name = accessibleName(el);
      const href = el.tagName === 'A' ? el.getAttribute('href') : null;
      if (!name && !href) return;
      if (href && (href.startsWith('javascript:') || href === '#')) {
        if (!name) return;
      }
      const key = [role, name, href || '', el.id || '', collapsed ? 'c' : 'v'].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      interactables.push({
        kind: 'interactive',
        id: nextId++,
        role,
        name: name || '(unnamed)',
        region: region(el),
        href,
        collapsed: !!collapsed,
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        playwrightLocator: suggestLocator(el, role, name),
      });
    }

    document.querySelectorAll(INTERACTIVE).forEach((el) => {
      if (!isVisible(el)) return;
      pushInteractive(el, false);
    });

    if (includeCollapsedNav) {
      document.querySelectorAll(INTERACTIVE).forEach((el) => {
        if (isVisible(el)) return;
        if (!inNavChrome(el) && !el.closest('[class*="submenu" i], [class*="dropdown" i]')) return;
        if (el.closest('footer')) return;
        pushInteractive(el, true);
      });
    }

    // --- compose agent tree by region (text + interactive) ---
    const regionOrder = ['header', 'nav', 'main', 'aside', 'body', 'footer', 'overlay'];
    const byRegion = {};
    for (const t of textHolders) (byRegion[t.region] ||= { text: [], interactive: [] }).text.push(t);
    for (const i of interactables) (byRegion[i.region] ||= { text: [], interactive: [] }).interactive.push(i);

    const lines = [];
    lines.push('Page map: ' + (document.title || '(no title)'));
    lines.push('URL: ' + location.href);
    lines.push(
      'Nodes: text-holders ' +
        textHolders.length +
        ', interactive ' +
        interactables.length +
        ' (visible ' +
        interactables.filter((i) => !i.collapsed).length +
        ', collapsed-nav ' +
        interactables.filter((i) => i.collapsed).length +
        ')',
    );
    lines.push('─'.repeat(60));

    for (const reg of regionOrder) {
      const bucket = byRegion[reg];
      if (!bucket || (!bucket.text.length && !bucket.interactive.length)) continue;
      lines.push('[' + reg + ']');
      for (const t of bucket.text) {
        if (t.level) lines.push('  text:heading' + t.level + ' "' + t.text + '"');
        else lines.push('  text:' + t.tag + ' "' + t.text + '"');
      }
      for (const item of bucket.interactive) {
        const hrefBit = item.href ? ' href=' + item.href.slice(0, 80) : '';
        const dis = item.disabled ? ' disabled' : '';
        const col = item.collapsed ? ' (collapsed)' : '';
        lines.push(
          '  [' + item.id + '] ' + item.role + ' "' + item.name + '"' + col + hrefBit + dis,
        );
      }
    }

    return {
      mode: 'compact-dom',
      includeCollapsedNav: !!includeCollapsedNav,
      url: location.href,
      title: document.title,
      textHolderCount: textHolders.length,
      textHolders,
      interactableCount: interactables.length,
      visibleCount: interactables.filter((i) => !i.collapsed).length,
      collapsedNavCount: interactables.filter((i) => i.collapsed).length,
      interactables,
      // back-compat aliases used by older callers/metrics
      headingCount: textHolders.filter((t) => t.level).length,
      headings: textHolders
        .filter((t) => t.level)
        .map((t) => ({ level: t.level, text: t.text })),
      treeText: lines.join('\n'),
    };
  };
}

export async function runCompactObserve(
  page,
  { includeCollapsedNav = true, maxTextHolders = 80, maxTextLen = 120 } = {},
) {
  return page.evaluate(buildCompactDomScript(), {
    includeCollapsedNav,
    maxTextHolders,
    maxTextLen,
  });
}

export function formatCompactTree(result) {
  if (result?.treeText) return result.treeText;
  return JSON.stringify(result, null, 2);
}
