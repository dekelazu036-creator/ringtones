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
const W = 360, H = 640;                       // CSS pixels; recorded at 1x, upscaled to 720x1280
const TXT = {
  he: { title: ['איך הופכים', '<b>שיר</b> לרינגטון?'],
        s1: '1. בוחרים שיר או סרטון<br>מהטלפון', s2: '2. SnipRing מוצא את הפזמון<br>לבד', s3: '3. אפשר להאזין לקטע<br>לפני שיוצרים',
        s4: '4. לוחצים <b>צור רינגטון</b>', s5: '5. לוחצים <b>הגדר כרינגטון</b><br>ובוחרים <b>שימוש כצלצול</b>',
        end: ['בחינם. בלי הרשמה.', 'השיר לא עוזב את הטלפון.'], dir: 'rtl' },
  en: { title: ['How to turn', 'a <b>song</b> into a ringtone'],
        s1: '1. Pick a song or video<br>from your phone', s2: '2. SnipRing finds<br>the chorus for you', s3: '3. Listen to the part<br>before you create it',
        s4: '4. Tap <b>Create ringtone</b>', s5: '5. Tap <b>Set as ringtone</b><br>and choose <b>Use as Ringtone</b>',
        end: ['Free. No sign-up.', 'Your song never leaves your phone.'], dir: 'ltr' },
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
      el.setAttribute('style', 'position:fixed;left:14px;right:14px;top:14px;z-index:9999;padding:14px 16px;border-radius:18px;' +
        'background:rgba(10,11,13,.94);border:1.5px solid #C7FF3D;color:#F2F4EF;font:600 19px/1.35 "IBM Plex Sans Hebrew",system-ui;' +
        'text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.55);transition:opacity .3s,transform .3s');
      document.documentElement.appendChild(el);
    }
    el.style.opacity = '0'; el.style.transform = 'translateY(-6px)';
    // "N. text" -> a lime number badge (a plain "1." flips to ".1" in Hebrew)
    const m = /^(\d+)\.\s*/.exec(h), body = (m ? h.slice(m[0].length) : h).replace(/<b>/g, '<b style="color:#C7FF3D">');
    const badge = m ? `<span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#C7FF3D;color:#0A0B0D;font-size:17px;font-weight:700;vertical-align:middle;margin-inline-end:8px;unicode-bidi:isolate">${m[1]}</span>` : '';
    setTimeout(() => { el.dir = d; el.innerHTML = badge + body; el.style.opacity = '1'; el.style.transform = 'none'; }, 250);
  }, [html, dir]);
  await sleep(300);
}

// a finger-tap marker on an element: a lime ring that pulses twice (shows WHERE to tap)
async function tap(page, selector, ms = 1300) {
  await page.evaluate((sel) => {
    const t = document.querySelector(sel); if (!t) return;
    const r = t.getBoundingClientRect(), m = document.createElement('div');
    m.className = '__tap';
    m.setAttribute('style', `position:fixed;z-index:9998;left:${r.left + r.width / 2 - 26}px;top:${r.top + r.height / 2 - 26}px;width:52px;height:52px;` +
      'border-radius:50%;background:rgba(199,255,61,.35);border:3px solid #C7FF3D;box-shadow:0 0 0 0 rgba(199,255,61,.6);pointer-events:none;' +
      'animation:__tp .65s ease-out 2');
    if (!document.getElementById('__tapcss')) {
      const st = document.createElement('style'); st.id = '__tapcss';
      st.textContent = '@keyframes __tp{0%{transform:scale(.6);box-shadow:0 0 0 0 rgba(199,255,61,.6)}70%{transform:scale(1);box-shadow:0 0 0 18px rgba(199,255,61,0)}100%{transform:scale(1)}}';
      document.head.appendChild(st);
    }
    document.documentElement.appendChild(m);
    setTimeout(() => m.remove(), 1600);
  }, selector);
  await sleep(ms);
}

// smooth zoom on an element (scale the page around it), and back
async function zoom(page, selector, scale = 1.35) {
  await page.evaluate(([sel, k]) => {
    const t = document.querySelector(sel); if (!t) return;
    const r = t.getBoundingClientRect(), b = document.body;
    b.style.transition = 'transform .7s cubic-bezier(.2,.7,.2,1)';
    b.style.transformOrigin = `${r.left + r.width / 2 + scrollX}px ${r.top + r.height / 2 + scrollY}px`;
    b.style.transform = `scale(${k})`;
  }, [selector, scale]);
  await sleep(800);
}
async function unzoom(page) { await page.evaluate(() => { document.body.style.transform = 'none'; }); await sleep(800); }
async function center(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), selector);
  await sleep(700);
}

// intro/end cards as 720x1280 stills (recording a static page gives the wrong scale at the start of a capture)
async function stills(browser, lang, out) {
  const t = TXT[lang];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const shot = async (html, file) => { await page.setContent(html, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: file }); };
  await shot(card(t.title, [], t.dir), join(out, 'intro.png'));
  await shot(card([t.title[1]], t.end, t.dir), join(out, 'outro.png'));
  await ctx.close();
}

async function record(browser, lang, out) {
  const t = TXT[lang];
  // recording: frames exactly the viewport size (with a 2x device scale Playwright sometimes captures a quarter frame)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark', locale: lang === 'he' ? 'he-IL' : 'en-US',
    isMobile: true, hasTouch: true, recordVideo: { dir: out, size: { width: W, height: H } } });
  await ctx.route(/cloud\.umami\.is|umami\.dev|facebook|supabase\.co/, (r) => r.abort());
  await ctx.addInitScript(() => {
    try { localStorage.setItem('snipring-theme', 'dark'); localStorage.setItem('snipring-device', 'iphone') } catch (e) {}
    // like Safari on an iPhone: file sharing is available, so the site shows its "Set as ringtone" button
    navigator.share = async () => {}; navigator.canShare = () => true;
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForSelector('#tryDemo'); await sleep(900);
  // 1. pick a song (the sample song stands in for a file from the phone)
  await caption(page, t.s1, t.dir); await sleep(1400);
  await tap(page, 'label.file', 1500);
  await page.click('#tryDemo');
  for (let i = 0; i < 100 && await page.evaluate(() => document.getElementById('export').disabled); i++) await sleep(100);
  // 2. the chorus is selected automatically: zoom on the waveform
  await center(page, '#wavebox');
  await caption(page, t.s2, t.dir); await sleep(500);
  await zoom(page, '#wavebox', 1.3); await sleep(2600);
  await unzoom(page);
  // 3. listen first
  await center(page, '#play');
  await caption(page, t.s3, t.dir); await sleep(900);
  await tap(page, '#play', 900);
  await page.click('#play').catch(() => {}); await sleep(2200);
  await page.click('#play').catch(() => {}); await sleep(300);
  // 4. create
  await caption(page, t.s4, t.dir); await sleep(1100);
  await tap(page, '#export', 1100);
  await page.click('#export');
  for (let i = 0; i < 150 && await page.evaluate(() => document.getElementById('dl').hidden); i++) await sleep(100);
  // 5. set as ringtone (the phone's share sheet takes it from here)
  // the button lives in the fixed bar at the bottom: no scroll, no zoom, just show where to tap
  await caption(page, t.s5, t.dir); await sleep(1000);
  await tap(page, '#share', 1600);
  await tap(page, '#share', 1600);
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
    await stills(browser, lang, tmp);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-loop', '1', '-t', '2.8', '-i', join(tmp, 'intro.png'),
      '-ss', '0.8', '-i', webm,
      '-loop', '1', '-t', '3.2', '-i', join(tmp, 'outro.png'),
      '-filter_complex', '[0:v]scale=720:1280,fps=30,setsar=1[a];[1:v]scale=720:1280:flags=lanczos,fps=30,setsar=1[b];[2:v]scale=720:1280,fps=30,setsar=1[c];[a][b][c]concat=n=3:v=1:a=0[v]',
      '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.0', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg]);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`media/how-${lang}.mp4 + .jpg`);
  }
  await browser.close();
} finally { server.kill() }
