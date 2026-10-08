import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { checkMp3, sha256Hex } from '../_shared/mp3.ts';
import { concat, ffmpeg, id3Header, repoSound, sine, siteMp3 } from './fixtures.ts';

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('M1 site encoder output (lamejs 192k stereo, 44.1 kHz) is accepted with the right duration', () => {
  const r = checkMp3(siteMp3(44100, 20));
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) assert.ok(near(r.durationMs, 20000, 100), String(r.durationMs));
});
test('M2 site encoder at 48 kHz', () => {
  const r = checkMp3(siteMp3(48000, 5));
  assert.equal(r.ok, true); if (r.ok) assert.ok(near(r.durationMs, 5000, 100));
});
test('M3 every MP3 shipped in /sounds is accepted (ID3v2.4 tags, 160k)', () => {
  for (const f of ['boing.mp3', 'classic-ring.mp3', 'city-pulse.mp3', 'coin-up.mp3']) {
    const r = checkMp3(repoSound(f));
    assert.equal(r.ok, true, `${f}: ${JSON.stringify(r)}`);
  }
});
test('M4 ffmpeg variants: VBR, mono, MPEG-2 22.05 kHz, MPEG-2.5 8 kHz, Xing header, ID3v1 trailer', () => {
  const cases: [string, string[]][] = [
    ['vbr', [...sine(3), '-c:a', 'libmp3lame', '-q:a', '4', '-f', 'mp3']],
    ['mono', [...sine(3), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3']],
    ['mpeg2', [...sine(3), '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3']],
    ['mpeg25', [...sine(3), '-ar', '8000', '-c:a', 'libmp3lame', '-b:a', '16k', '-f', 'mp3']],
    ['id3v1', [...sine(3), '-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '0', '-write_id3v1', '1', '-metadata', 'title=x', '-f', 'mp3']],
  ];
  for (const [n, a] of cases) {
    const r = checkMp3(ffmpeg(a));
    assert.equal(r.ok, true, `${n}: ${JSON.stringify(r)}`);
    if (r.ok) assert.ok(near(r.durationMs, 3000, n === 'mpeg25' ? 250 : 120), `${n}: ${r.durationMs}`);   // ±3 frames (encoder delay + Xing frame)
  }
});
test('M5 non-MP3 audio and random data are refused', () => {
  const wav = ffmpeg([...sine(2), '-f', 'wav']);
  const ogg = ffmpeg([...sine(2), '-c:a', 'libvorbis', '-f', 'ogg']);
  const aac = ffmpeg([...sine(2), '-c:a', 'aac', '-f', 'adts']);
  const mp2 = ffmpeg([...sine(2), '-c:a', 'mp2', '-f', 'mp2']);              // MPEG Layer II, not III
  for (const [n, b] of [['wav', wav], ['ogg', ogg], ['aac', aac], ['mp2', mp2], ['random', new Uint8Array(randomBytes(50000))]] as const) {
    assert.equal(checkMp3(b as Uint8Array).ok, false, n);
  }
});
test('M6 an HTML/script file renamed to .mp3 with a fake ID3 header is refused', () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>'.repeat(200));
  assert.equal(checkMp3(concat(id3Header(10), html)).ok, false);
});
test('M7 payload smuggled after valid audio is refused', () => {
  const audio = siteMp3(44100, 2);
  const r = checkMp3(concat(audio, new Uint8Array(randomBytes(20000))));
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.reason, 'corrupt');
});
test('M8 oversized ID3 tag (data hiding) is refused', () => {
  assert.equal(checkMp3(concat(id3Header(600 * 1024), siteMp3(44100, 1))).ok, false);
});
test('M9 a stream that switches sample rate midway is refused', () => {
  assert.equal(checkMp3(concat(siteMp3(44100, 1), siteMp3(48000, 1))).ok, false);
});
test('M10 truncated last frame is tolerated (duration from complete frames)', () => {
  const a = siteMp3(44100, 3);
  const r = checkMp3(a.subarray(0, a.length - 100));
  assert.equal(r.ok, true);
});
test('M11 tiny inputs are refused', () => {
  assert.equal(checkMp3(new Uint8Array(0)).ok, false);
  assert.equal(checkMp3(siteMp3(44100, 0.01).subarray(0, 100)).ok, false);
});
test('M12 duration is measured, not trusted: 6-minute file reports > 300000 ms', () => {
  const r = checkMp3(ffmpeg([...sine(360), '-ac', '1', '-ar', '8000', '-c:a', 'libmp3lame', '-b:a', '8k', '-f', 'mp3']));
  assert.equal(r.ok, true); if (r.ok) assert.ok(r.durationMs > 300000);
});
test('M13 sha256Hex equals Node crypto', async () => {
  const b = siteMp3(44100, 1);
  assert.equal(await sha256Hex(b), createHash('sha256').update(b).digest('hex'));
});
test('M14 10 MiB worth of frames is checked within the CPU budget (< 200 ms here)', () => {
  const one = siteMp3(44100, 30);
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total + one.length < 10 * 1024 * 1024) { parts.push(one); total += one.length; }
  const big = concat(...parts);
  const t = performance.now();
  const r = checkMp3(big);
  const ms = performance.now() - t;
  assert.equal(r.ok, true);
  assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
});
