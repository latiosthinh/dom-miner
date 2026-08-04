// @ts-nocheck
/**
 * UI state expansion before compact/deep reads.
 * Same intent as manual-e2e page-discovery.md §0 — open collapsed nav/menus
 * so compact observe does not miss children that deep finds as hidden.
 */

export async function expandUi(page) {
  return page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const opened = [];

    window.scrollTo(0, document.body.scrollHeight);
    await delay(200);
    window.scrollTo(0, 0);
    await delay(200);

    const search = document.querySelector(
      'a[aria-label="Search"], button[aria-label="Search"], [data-testid*="search" i]',
    );
    if (search) {
      try {
        search.click();
        opened.push('search');
      } catch (_) {}
      await delay(250);
    }

    document.querySelectorAll('details:not([open])').forEach((d) => {
      d.setAttribute('open', 'open');
      opened.push('details');
    });

    const safeHref = (el) => {
      const h = (el.getAttribute('href') || '').trim().toLowerCase();
      return !h || h === '#' || h.startsWith('javascript:');
    };

    document.querySelectorAll('[aria-expanded="false"]').forEach((el) => {
      if (el.tagName === 'A' && !safeHref(el)) return;
      try {
        el.click();
        opened.push('aria-expanded:' + (el.getAttribute('aria-label') || el.tagName).slice(0, 40));
      } catch (_) {}
    });
    await delay(300);

    document
      .querySelectorAll(
        'nav a, nav button, [role="navigation"] a, [role="navigation"] button, header a, header button',
      )
      .forEach((el) => {
        if (el.closest('footer')) return;
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      });
    await delay(400);

    const expandLabels =
      /menu|more|show|expand|open|navigation|categories|services|about|products|organisation|organization|investors/i;
    document.querySelectorAll('a, button, [role="button"], [role="menuitem"], summary').forEach((el) => {
      const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim();
      if (!expandLabels.test(label) || label.length > 60) return;
      if (el.closest('footer')) return;
      if (el.tagName === 'A' && !safeHref(el)) return;
      try {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        if (el.getAttribute('aria-expanded') === 'false' || el.tagName === 'SUMMARY') {
          el.click();
          opened.push('label:' + label.slice(0, 40));
        }
      } catch (_) {}
    });
    await delay(500);

    document
      .querySelectorAll('nav li, nav .menu, [class*="submenu" i], [class*="dropdown" i]')
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          el.style.setProperty('display', 'block', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
          el.removeAttribute('hidden');
          el.setAttribute('aria-hidden', 'false');
          opened.push('force-show');
        }
      });
    await delay(200);

    return {
      ok: true,
      openedCount: opened.length,
      opened: opened.slice(0, 40),
      anchorCount: document.querySelectorAll('a[href]').length,
      buttonCount: document.querySelectorAll('button').length,
    };
  });
}
