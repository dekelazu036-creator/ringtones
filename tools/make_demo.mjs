// Records the "Watch how it works" demo videos (media/how-he.mp4, media/how-en.mp4 + posters) from the REAL site,
// so they always match the current design. Phone-sized, dark, captions per step, intro and end cards.
// Needs Playwright (npm i --no-save playwright@1.47.2 && npx playwright install chromium) and ffmpeg.
// Usage: node tools/make_demo.mjs            (serves the repo locally on port 8093; no network needed)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = 8093, BASE = `http://localhost:${PORT}`;
const W = 360, H = 640;                       // CSS pixels; recorded at 2x = 720x1280
const TXT = {
  he: { title: ['איך הופכים', '<b>שיר</b> לרינגטון?'], s1: '1. בוחרים שיר או סרטון', s2: '2. הפזמון מסומן אוטומטית', s3: '3. לוחצים <b>צור רינגטון</b>',
        s4: '4. <b>שימוש כצלצול</b> וסיימתם', end: ['בחינם. בלי הרשמה.', 'השיר לא עוזב את הטלפון.'], dir: 'rtl' },
  en: { title: ['How to turn', 'a <b>song</b> into a ringtone'], s1: '1. Pick a song or video', s2: '2. The chorus is found for you', s3: '3. Tap <b>Create ringtone</b>',
        s4: '4. <b>Use as ringtone</b> and you are done', end: ['Free. No sign-up.', 'Your song never leaves your phone.'], dir: 'ltr' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a full-screen card in the site's own colours and fonts (rendered by Chromium, so Hebrew shapes correctly)
function card(lines, small, dir) {
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${BASE}/fonts/fonts.css"><style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#0A0B0D;color:#F2F4EF;font-family:"IBM Plex Sans Hebrew",system-ui,sans-serif}
  .c{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:0 28px;box-sizing:border-box}
  .logo{font-family:Karantina,sans-serif;font-size:64px;font-weight:700;line-height:1;direction:ltr}.logo span{color:#C7FF3D}
  h1{font-size:30px;line-height:1.25;margin:0;font-weight:600}h1 b{color:#C7FF3D;font-weight:700}
  p{margin:0;color:#CBD0C6;font-size:18px;line-height:1.5}.url{margin-top:6px;color:#C7FF3D;font-weight:600;direction:ltr}
  </style></head><body><div class="c"><div class="logo">Snip<span>Ring</span></div>
  ${lines.map((l) => `<h1>${l}</h1>`).join('')}${small.map((l) => `<p>${l}</p>`).join('')}${small.length ? '<p class="url">snipring.com</p>' : ''}</div></body></html>`;
}

async function caption(page, html, dir) {
  await page.evaluate(([h, d]) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div'); el.id = '__cap';
      el.setAttribute('style', 'position:fixed;left:12px;right:12px;top:10px;z-index:9999;padding:12px 16px;border-radius:16px;' +
        'background:rgba(10,11,13,.92);border:1px solid #C7FF3D;color:#F2F4EF;font:600 17px/1.35 "IBM Plex Sans Hebrew",system-ui;' +
        'text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .25s');
      document.body.appendChild(el);
    }
    el.dir = d; el.innerHTML = h.replace(/<b>/g, '<b style="color:#C7FF3D">');
  }, [html, dir]);
}

async function record(browser, lang, out) {
  const t = TXT[lang];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'dark', locale: lang === 'he' ? 'he-IL' : 'en-US',
    isMobile: true, hasTouch: true, recordVideo: { dir: out, size: { width: 720, height: 1280 } } });
  await ctx.route(/cloud\.umami\.is|umami\.dev|facebook|supabase\.co/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('snipring-theme', 'dark'); localStorage.setItem('snipring-device', 'iphone') } catch (e) {} });
  const page = await ctx.newPage();
  await page.setContent(card(t.title, [], t.dir)); await sleep(2600);
  await page.goto(BASE + '/'); await page.waitForSelector('#tryDemo'); await sleep(600);
  await caption(page, t.s1, t.dir); await sleep(1700);
  await page.click('#tryDemo');
  for (let i = 0; i < 100 && await page.evaluate(() => document.getElementById('export').disabled); i++) await sleep(100);
  await caption(page, t.s2, t.dir);
  await page.evaluate(() => document.getElementById('wave')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) || window.scrollTo({ top: 260, behavior: 'smooth' }));
  await sleep(3200);
  await caption(page, t.s3, t.dir); await sleep(1300);
  await page.click('#export');
  for (let i = 0; i < 150 && await page.evaluate(() => document.getElementById('dl').hidden); i++) await sleep(100);
  await page.evaluate(() => document.getElementById('dl').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(900);
  await caption(page, t.s4, t.dir); await sleep(3000);
  await page.setContent(card([t.title[1]], t.end, t.dir)); await sleep(3000);
  const video = page.video(); await ctx.close();
  return video.path();
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/'); break } catch { await sleep(100) } }
  const browser = await chromium.launch();
  for (const lang of ['he', 'en']) {
    const tmp = mkdtempSync(join(tmpdir(), 'snipdemo-'));
    const webm = await record(browser, lang, tmp);
    const mp4 = join(ROOT, 'media', `how-${lang}.mp4`), jpg = join(ROOT, 'media', `how-${lang}.jpg`);
    // drop the first blank frames, H.264 for every phone, no audio track, fast start for streaming
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.3', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
      '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-vf', 'scale=720:1280', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg]);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`media/how-${lang}.mp4 + .jpg`);
  }
  await browser.close();
} finally { server.kill() }
