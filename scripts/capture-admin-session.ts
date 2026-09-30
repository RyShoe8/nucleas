/**
 * Capture a signed-in session for a Nucleas company's Admin account. Nothing is typed into Nucleas and no
 * password is stored: a browser window opens, you log in to your own site (2FA and SSO work), and only that
 * site's cookies are sent to Nucleas with the one-time code shown in Company → Admin account.
 *
 *   npx tsx scripts/capture-admin-session.ts --site https://example.com --server https://os.nucleas.example --code ABCD1234EF
 *
 * Requires playwright (`npx playwright install chromium`). Log in as the least-privileged user that can open
 * the pages you will ask about; Nucleas only reads pages with the session and blocks every write.
 */
import readline from 'readline';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? '') : '';
}

async function main() {
  const site = arg('site');
  const server = arg('server').replace(/\/+$/, '');
  const code = arg('code');
  if (!site || !server || !code) {
    console.error('Usage: npx tsx scripts/capture-admin-session.ts --site https://example.com --server https://os.nucleas.example --code CODE');
    process.exit(1);
  }
  const host = new URL(site).hostname;
  const playwright = (await import(/* webpackIgnore: true */ 'playwright' as string)) as {
    chromium: { launch: (o: { headless: boolean }) => Promise<{ newContext: () => Promise<{ newPage: () => Promise<{ goto: (u: string) => Promise<unknown> }>; cookies: () => Promise<{ domain: string }[]> }>; close: () => Promise<void> }> };
  };
  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(site);
  console.log(`\nA browser window opened at ${site}. Log in there, then come back here and press Enter.`);
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });
  const cookies = (await context.cookies()).filter((c) => {
    const d = c.domain.replace(/^\./, '').toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
  await browser.close();
  if (!cookies.length) {
    console.error(`No cookies were set for ${host}. Did you log in?`);
    process.exit(1);
  }
  const response = await fetch(`${server}/api/os/admin-account/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, storageState: { cookies } }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; host?: string; cookies?: number };
  if (!response.ok) {
    console.error(body.error ?? `Nucleas answered ${response.status}.`);
    process.exit(1);
  }
  console.log(`Done: ${body.cookies} cookie(s) for ${body.host} were saved to Nucleas. You can close this window.`);
}

void main();
