// @ts-nocheck
/**
 * Deep page inventory — same fidelity intent as element-discovery.md
 * (full interactive inventory + playwrightLocator suggestions).
 * Includes hidden nodes (collapsed menus, drawers).
 */

export const DEEP_INVENTORY_SCRIPT = `(() => {
  const SELECTORS =
    'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const items = [];

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

  function region(el) {
    if (el.closest('[role="dialog"], [class*="modal"], [class*="drawer"], [class*="overlay"]'))
      return 'overlay';
    const nav = el.closest('nav, [role="navigation"]');
    if (nav) {
      const hint =
        nav.getAttribute('aria-label') ||
        (nav.className.match(/header|footer|mobile|mega|drawer|menu/i) || [])[0] ||
        'nav';
      return 'navigation:' + String(hint).slice(0, 40);
    }
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    if (el.closest('main, [role="main"]')) return 'main';
    if (el.closest('aside, [role="complementary"]')) return 'aside';
    return 'body';
  }

  function accessibleName(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (t) return t.slice(0, 120);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 120);
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label?.textContent) return label.textContent.trim().slice(0, 120);
    }
    const parentLabel = el.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim().slice(0, 120);
    if (el.tagName === 'INPUT' && el.placeholder) return el.placeholder.trim().slice(0, 120);
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY')
      return (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    return (el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('value') || '').trim().slice(0, 120);
  }

  function suggestSelector(el) {
    const testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1)
      return '#' + CSS.escape(el.id);
    const name = el.getAttribute('name');
    if (name && el.tagName === 'INPUT')
      return el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
    const aria = el.getAttribute('aria-label');
    if (aria)
      return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
    const href = el.getAttribute('href');
    if (el.tagName === 'A' && href)
      return 'a[href="' + href.replace(/"/g, '\\\\"') + '"]';
    return el.tagName.toLowerCase();
  }

  document.querySelectorAll(SELECTORS).forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role');
    const name = accessibleName(el);
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    const key = [tag, roleAttr || '', href || '', name, el.id || '', el.getAttribute('name') || ''].join('|');
    if (seen.has(key)) return;
    seen.add(key);

    const selector = suggestSelector(el);
    const testId = el.getAttribute('data-testid');
    const elName = el.getAttribute('name');
    const stableId =
      el.id &&
      document.querySelectorAll('#' + CSS.escape(el.id)).length === 1 &&
      !/^(react|ember|mui|css|radix)/i.test(el.id);

    let playwrightLocator = null;

    if (testId) {
      playwrightLocator = { kind: 'getByTestId', testId };
    }

    if (!playwrightLocator) {
      if (tag === 'button' || roleAttr === 'button') {
        if (name) playwrightLocator = { kind: 'getByRole', role: 'button', name };
      } else if (tag === 'a' || roleAttr === 'link') {
        if (name || href) playwrightLocator = { kind: 'getByRole', role: 'link', name: name || href };
      } else if (tag === 'input' || tag === 'textarea' || roleAttr === 'textbox' || tag === 'select') {
        if (name) playwrightLocator = { kind: 'getByLabel', name };
      } else if (name && (roleAttr || el.getAttribute('aria-label'))) {
        playwrightLocator = { kind: 'getByRole', role: roleAttr || tag, name };
      }
    }

    if (!playwrightLocator && stableId) {
      playwrightLocator = { kind: 'locator', selector: '#' + CSS.escape(el.id) };
    }

    if (!playwrightLocator && elName && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
      playwrightLocator = {
        kind: 'locator',
        selector: tag + '[name="' + elName.replace(/"/g, '\\\\"') + '"]',
      };
    }

    if (!playwrightLocator && el.getAttribute('placeholder')) {
      playwrightLocator = { kind: 'getByPlaceholder', name: el.getAttribute('placeholder') };
    } else if (!playwrightLocator && (tag === 'button' || tag === 'a') && name) {
      playwrightLocator = { kind: 'getByText', name };
    }

    if (!playwrightLocator) {
      playwrightLocator = { kind: 'locator', selector };
    }

    items.push({
      tag,
      role: roleAttr,
      type: el.getAttribute('type') || null,
      accessibleName: name,
      selector,
      playwrightLocator,
      placeholder: el.getAttribute('placeholder'),
      name: el.getAttribute('name'),
      testId,
      href,
      resolvedHref: el.tagName === 'A' ? el.href : null,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      visible: isVisible(el),
      region: region(el),
    });
  });

  const anchors = items.filter((i) => i.tag === 'a');
  const buttons = items.filter((i) => i.tag === 'button' || i.role === 'button');

  return {
    url: location.href,
    title: document.title,
    elementCount: items.length,
    visibleCount: items.filter((i) => i.visible).length,
    hiddenCount: items.filter((i) => !i.visible).length,
    anchorCount: anchors.length,
    buttonCount: buttons.length,
    elements: items,
    anchors,
    buttons,
  };
})()`;

export async function runDeepInventory(page) {
  return page.evaluate(DEEP_INVENTORY_SCRIPT);
}
