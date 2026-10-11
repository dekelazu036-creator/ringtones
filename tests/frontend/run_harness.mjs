// Runs the browser harnesses headless (Playwright Chromium) against a local static server.
// Usage: npm i --no-save playwright@1.47.2 && npx playwright install chromium && node tests/frontend/run_harness.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8091;
const HARNESSES = ['tests/frontend/library_harness.html'];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const stop = () => { try { server.kill() } catch {} };
let failed = 0;
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  const browser = await chromium.launch();
  for (const h of HARNESSES) {
    // "localhost" (not 127.0.0.1) so crypto.subtle / randomUUID run in a secure context, as on the real site
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/${h}`);
    const done = await page.waitForFunction(() => window.__done, null, { timeout: 60_000 }).then((x) => x.jsonValue()).catch(() => null);
    console.log(`== ${h}`);
    if (!done) { console.log('FAIL harness did not finish'); failed++; continue }
    if (done.out) console.log(done.out.join('\n')); else console.log(JSON.stringify(done));
    if (errors.length) console.log('page errors:', errors.join(' | '));
    failed += done.fails || 0;
  }
  await browser.close();
} finally { stop() }
console.log(failed ? `${failed} FAILED` : 'frontend harnesses passed');
process.exit(failed ? 1 : 0);
