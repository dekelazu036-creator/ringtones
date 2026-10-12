// Smart cut quality bench (Create 2.0). Synthetic songs with KNOWN structure (tempo, beats, bars, chorus starts),
// rendered in Node, analysed by the real smartcut.js. No real songs (copyright); fixed seeds, so results are stable.
// Run: node --test tests/smartcut/eval.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { Math, Float32Array, Float64Array, Int8Array, Array, Number, console };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../../smartcut.js', import.meta.url), 'utf8'), ctx);
const { beatGrid, snapToGrid, beatLen, chorusCandidates, sectionStart } = ctx;

// ---------------------------------------------------------------- synthetic song
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; } // mulberry32
const SR = 22050;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// sections in bars; the chorus is louder, has its own chord loop and a melody, so it is what a listener calls the chorus
const FORM = [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['bridge', 4], ['chorus', 8]];
function makeSong(seed) {
  const r = rng(seed), bpm = 84 + Math.floor(r() * 66), beat = 60 / bpm, bar = 4 * beat;
  const lead = 0.1 + r() * 0.9;                                   // silence before the first downbeat
  const bars = FORM.reduce((n, [, b]) => n + b, 0), dur = lead + bars * bar + 1;
  const x = new Float32Array(Math.ceil(dur * SR));
  const add = (t0, len, fn) => { const s = Math.floor(t0 * SR), e = Math.min(x.length, s + Math.floor(len * SR)); for (let i = s; i < e; i++) x[i] += fn((i - s) / SR); };
  const root = 45 + Math.floor(r() * 7);
  const verseChords = [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]].map((c) => c.map((v) => v + root));
  const chorusChords = [[5, 9, 12], [0, 4, 7], [7, 11, 14], [9, 12, 16]].map((c) => c.map((v) => v + root));
  const chorusStarts = [];
  let t = lead, barNo = 0;
  for (const [name, nb] of FORM) {
    if (name === 'chorus') chorusStarts.push(t);
    const loud = name === 'chorus' ? 1 : name === 'intro' ? 0.45 : 0.6;
    for (let b = 0; b < nb; b++, barNo++, t += bar) {
      const ch = (name === 'chorus' ? chorusChords : verseChords)[b % 4];
      for (const m of ch) { const f = midi(m + 12); add(t, bar, (u) => loud * 0.07 * Math.sin(2 * Math.PI * f * u) * Math.min(1, u * 40)); }
      for (let q = 0; q < 4; q++) {
        const tb = t + q * beat;
        if (name !== 'intro' || q % 2 === 0) add(tb, 0.18, (u) => loud * 0.9 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-u * 30)) * u) * Math.exp(-u * 18)); // kick
        if (q % 2 === 1 && name !== 'intro') add(tb, 0.12, (u) => loud * 0.35 * (r() * 2 - 1) * Math.exp(-u * 30)); // snare
        add(tb + beat / 2, 0.04, (u) => loud * 0.08 * (r() * 2 - 1) * Math.exp(-u * 90));                                // hat on the off-beat
        if (name === 'chorus') { const f = midi(ch[q % 3] + 24); add(tb, beat * 0.9, (u) => 0.12 * Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 2)); } // melody
      }
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += (r() * 2 - 1) * 0.002;  // a little noise floor
  const song = { sampleRate: SR, length: x.length, numberOfChannels: 1, duration: x.length / SR, getChannelData: () => x };
  return { song, bpm, beat, bar, lead, chorusStarts, firstDownbeat: lead };
}
const wrapErr = (t, ref, period) => { const d = ((t - ref) % period + period) % period; return Math.min(d, period - d); };

const SEEDS = Array.from({ length: 16 }, (_, i) => 1000 + i * 7);
const songs = SEEDS.map(makeSong);
const grids = songs.map((s) => beatGrid(s.song));

test('S1 tempo within 2% on every steady song', () => {
  const bad = grids.map((g, i) => [g, songs[i]]).filter(([g, s]) => !g || Math.abs(g.bpm - s.bpm) / s.bpm > 0.02);
  assert.equal(bad.length, 0, bad.map(([g, s]) => `${s.bpm} -> ${g ? g.bpm.toFixed(1) : 'null'}`).join(', '));
});
test('S2 beat phase within 15 ms', () => {
  const errs = grids.map((g, i) => wrapErr(g.first, songs[i].lead, songs[i].beat));
  assert.ok(Math.max(...errs) < 0.015, 'max ' + Math.max(...errs).toFixed(3));
});
test('S3 the bar line (downbeat) is found on at least 14 of 16 songs', () => {
  const ok = grids.filter((g, i) => wrapErr(g.downbeat, songs[i].lead, songs[i].bar) < 0.04).length;
  assert.ok(ok >= 14, `${ok}/16`);
});
test('S4 confidence separates a pulse from no pulse (white noise)', () => {
  const r = rng(5), x = new Float32Array(SR * 30); for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * 0.3;
  const g = beatGrid({ sampleRate: SR, length: x.length, numberOfChannels: 1, duration: 30, getChannelData: () => x });
  const minSong = Math.min(...grids.map((g) => g.conf));
  assert.ok(!g || g.conf < minSong, `noise ${g && g.conf.toFixed(2)} vs songs min ${minSong.toFixed(2)}`);
  assert.ok(minSong > 0.2 && (!g || g.conf < 0.1), `songs min ${minSong.toFixed(2)}, noise ${g && g.conf.toFixed(2)}`);
});
test('S5 the smart cut starts exactly where a chorus starts (within 40 ms) far more often than before', () => {
  let before = 0, after = 0;
  songs.forEach((s, i) => {
    const c = chorusCandidates(s.song, 15)[0].t, near = Math.min(...s.chorusStarts.map((t) => Math.abs(t - c)));
    const snapped = sectionStart(s.song, grids[i], c), nearS = Math.min(...s.chorusStarts.map((t) => Math.abs(t - snapped)));
    if (near < 0.04) before++;
    if (nearS < 0.04) after++;
  });
  console.log(`   chorus cut starts exactly at a chorus: before ${before}/16, with smart cut ${after}/16`);
  assert.ok(after >= 14 && after > before, `before ${before}, after ${after}`);
});
test('S6 beatLen: whole beats, never longer than the cap, never below the minimum', () => {
  const g = { period: 0.5, first: 0, downbeat: 0 };
  assert.equal(beatLen(29.5, g, 3), 29.5);
  assert.equal(beatLen(29.4, g, 3), 29);
  const g2 = { period: 60 / 97, first: 0, downbeat: 0 };
  const L = beatLen(29.5, g2, 3);
  assert.ok(L <= 29.5 && Math.abs(L / g2.period - Math.round(L / g2.period)) < 1e-9);
  assert.equal(beatLen(2, { period: 3 }, 3), 2);                 // no whole beat fits above the minimum: keep the length
  assert.equal(snapToGrid(12.3, null, 1.5), 12.3);              // no grid: unchanged
});
