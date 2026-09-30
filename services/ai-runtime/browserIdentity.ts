/**
 * How the browser worker presents itself when a person (or their own session) uses it on their own site.
 * Stock headless Chromium announces itself ("HeadlessChrome", navigator.webdriver = true), which many sites'
 * bot checks refuse with messages like "We couldn't verify this request". These settings make it look like
 * the ordinary Chrome it is, consistently across the login window and page reading (some sites tie the
 * session to the browser's user agent).
 *
 * This does not defeat a site's protection: it still runs from a data-centre address. If a site blocks that,
 * allow the worker's IP in the site's bot/WAF rules, or paste a session instead.
 */

export const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
export const IGNORE_DEFAULT_ARGS = ['--enable-automation'];

/** A normal desktop Chrome user agent for the browser's own version (no "Headless"). */
export function userAgentFor(version: string): string {
  const major = version.match(/\d+/)?.[0] ?? '120';
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export function contextIdentity(version: string): { userAgent: string; locale: string; timezoneId: string } {
  return { userAgent: userAgentFor(version), locale: 'en-US', timezoneId: process.env.NUCLEAS_BROWSER_TIMEZONE?.trim() || 'America/New_York' };
}

/** Runs in every page before its own scripts. */
export const HIDE_AUTOMATION_SCRIPT = "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });";
