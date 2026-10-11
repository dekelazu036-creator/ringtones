// Core 1.0 regression (M4): the guest flow must keep working with NO account, on phone and desktop sizes,
// in Hebrew (RTL) and English (LTR), light and dark, with zero Content-Security-Policy violations.
// Usage (needs Playwright, see run_harness.mjs): node tests/frontend/e2e_guest.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8092, BASE = `http://localhost:${PORT}`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
let fails = 0;
// page.waitForFunction relies on eval, which the site's CSP (rightly) forbids: poll with evaluate instead
async function until(page, fn, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('timeout waiting for ' + String(fn).slice(0, 80));
}
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); if (!cond) fails++; };

// every page counts CSP violations and JS errors; analytics are stubbed so nothing leaves the machine
const INIT = `window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.effectiveDirective+' '+e.blockedURI));`;
async function newPage(browser, opts) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...opts });
  await ctx.route(/cloud\.umami\.is|umami\.dev|facebook/, (r) => r.abort());
  await ctx.route(/supabase\.co/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e).slice(0, 160)));
  return page;
}

try {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/'); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  const browser = await chromium.launch();
  const variants = [
    { name: 'phone he dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'he-IL' },
    { name: 'desktop en light', viewport: { width: 1280, height: 800 }, colorScheme: 'light', locale: 'en-US' },
  ];
  for (const v of variants) {
    const { name, ...opts } = v;
    const page = await newPage(browser, opts);
    await page.goto(BASE + '/');
    const lang = v.locale.slice(0, 2);
    ok(`[${name}] language from the device (${lang}, ${lang === 'he' ? 'rtl' : 'ltr'})`,
      await page.evaluate(() => document.documentElement.lang + document.documentElement.dir) === lang + (lang === 'he' ? 'rtl' : 'ltr'));
    ok(`[${name}] no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok(`[${name}] accounts are optional: a sign-in button exists, nothing asks for it`, await page.evaluate(() => !!document.querySelector('.acctbtn') && !document.querySelector('dialog[open]') && !/account\.html/.test(location.pathname)));

    await page.click('#tryDemo');
    await until(page, () => !document.getElementById('export').disabled, 20000);
    await page.click('#export');
    await until(page, () => document.querySelectorAll('#mineList li').length > 0, 30000);
    ok(`[${name}] ringtone created and kept in My sounds`, true);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#dl')]);
    const bytes = readFileSync(await dl.path());
    const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    ok(`[${name}] MP3 download (${dl.suggestedFilename()})`, mp3 && bytes.length > 50_000 && /\.mp3$/.test(dl.suggestedFilename()), `${bytes.length} bytes`);

    await page.click('#lang');
    const other = lang === 'he' ? 'enltr' : 'hertl';
    ok(`[${name}] language toggle switches text direction`, await page.evaluate(() => document.documentElement.lang + document.documentElement.dir) === other);
    const csp = await page.evaluate(() => window.__csp);
    ok(`[${name}] zero CSP violations`, csp.length === 0, csp.join(', '));
    ok(`[${name}] no uncaught JS errors`, page.__errors.length === 0, page.__errors.join(' | '));
    await page.context().close();
  }

  // private beta: an invite link unlocks the account button on this device only, and the code leaves the address bar
  {
    const page = await newPage(browser, { viewport: { width: 390, height: 844 }, locale: 'he-IL' });
    await page.goto(BASE + '/?invite=ABCD-1234-ABCD-1234');
    await until(page, () => document.querySelector('.acctbtn') && !document.querySelector('.acctbtn').hidden, 5000).catch(() => {});
    const st = await page.evaluate(() => ({ btn: !document.querySelector('.acctbtn').hidden, url: location.search, code: localStorage.getItem('snipring-invite') }));
    ok('[invite] link shows the account button, stores the code, removes it from the address', st.btn && !/invite/.test(st.url) && st.code === 'ABCD-1234-ABCD-1234', JSON.stringify(st));
    const csp = await page.evaluate(() => window.__csp);
    ok('[invite] zero CSP violations', csp.length === 0, csp.join(', '));
    await page.context().close();
  }

  // Discover → "Use" opens the sound in the editor (rights-cleared catalogue only)
  const page = await newPage(browser, { viewport: { width: 390, height: 844 }, locale: 'en-US' });
  await page.goto(BASE + '/discover.html');
  await until(page, () => document.querySelectorAll('a.suse').length >= 20, 15000);
  ok('[discover] catalogue listed', await page.evaluate(() => document.querySelectorAll('a.suse').length) === 26);
  await page.fill('input[type=search]', 'glass');
  await page.waitForTimeout(400);
  ok('[discover] search narrows the list', await page.evaluate(() => [...document.querySelectorAll('a.suse')].filter((a) => a.offsetParent).length) < 26);
  const href = await page.evaluate(() => [...document.querySelectorAll('a.suse')].find((a) => a.offsetParent).getAttribute('href'));
  await page.goto(BASE + '/' + href.replace(/^\/?/, '').replace(/^\.\//, ''));
  await until(page, () => !document.getElementById('export').disabled, 20000);
  ok('[discover] "Use" opens the sound in the editor', true, href);
  const csp = await page.evaluate(() => window.__csp);
  ok('[discover] zero CSP violations', csp.length === 0, csp.join(', '));
  ok('[discover] no uncaught JS errors', page.__errors.length === 0, page.__errors.join(' | '));
  await browser.close();
} catch (e) {
  console.log('FAIL  harness error: ' + String(e).slice(0, 300)); fails++;
} finally { server.kill() }
console.log(fails ? `${fails} FAILED` : 'guest flow passed');
process.exit(fails ? 1 : 0);
