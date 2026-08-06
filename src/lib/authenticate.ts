// @ts-nocheck
/**
 * Handle authenticated login flow before DOM exploration.
 * Supports auto-detection of common login forms and explicit login URLs.
 */

/**
 * @param {import('playwright-core').Page} page
 * @param {{ username: string, password: string }} credential
 * @param {{ loginUrl?: string, usernameSelector?: string, passwordSelector?: string, submitSelector?: string }} opts
 */
export async function authenticate(page, credential, opts = {}) {
  const {
    loginUrl,
    usernameSelector = 'input[name="username"], input[name="email"], input[type="email"], input[type="text"]',
    passwordSelector = 'input[type="password"]',
    submitSelector = 'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login")',
  } = opts;

  if (loginUrl) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1000);
  }

  const result = {
    ok: false,
    method: 'none',
    errors: [],
  };

  try {
    // Try filling the most common form pattern
    const usernameInput = await page.$(usernameSelector.split(',')[0].trim());
    const passwordInput = await page.$(passwordSelector);

    if (usernameInput && passwordInput) {
      await usernameInput.fill(credential.username);
      await passwordInput.fill(credential.password);

      const submitBtn = await page.$(submitSelector.split(',')[0].trim());
      if (submitBtn) {
        await submitBtn.click();
      } else {
        // Try pressing Enter on the password field
        await passwordInput.press('Enter');
      }

      await page.waitForTimeout(2000);
      result.ok = true;
      result.method = 'form';
      return result;
    }

    // Fallback: try any visible input[type="text"] or input[type="email"]
    const anyText = await page.$('input[type="text"]:visible, input[type="email"]:visible');
    const anyPassword = await page.$('input[type="password"]:visible');

    if (anyText && anyPassword) {
      await anyText.fill(credential.username);
      await anyPassword.fill(credential.password);
      await anyPassword.press('Enter');
      await page.waitForTimeout(2000);
      result.ok = true;
      result.method = 'form-fallback';
      return result;
    }

    result.errors.push('No login form detected');
    return result;
  } catch (err) {
    result.errors.push(String(err?.message || err));
    return result;
  }
}

/**
 * Auto-detect if the current page is a login page.
 */
export async function isLoginPage(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    const hasPasswordField = document.querySelector('input[type="password"]');
    const hasLoginText = /sign in|log in|login|authenticate/.test(text);
    const hasLoginForm = document.querySelector('form');
    return Boolean(hasPasswordField && (hasLoginText || hasLoginForm));
  });
}
