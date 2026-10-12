/* SnipRing smart cut: chorus finder + beat grid. Classic script, loaded by index.html before its inline
   code (the functions are globals); the Node tests load it the same way. Everything runs on the device. */
/* Chorus finder: chroma self-similarity + loudness.
   A chorus is the loud part of a song that repeats, so we look for the window
   whose harmony recurs elsewhere in the song most strongly. */
function fftMag(re, im) { // in-place radix-2, returns nothing
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function songFeatures(song, hopSec) {
  const sr0 = song.sampleRate, a = song.getChannelData(0), b = song.numberOfChannels > 1 ? song.getChannelData(1) : a;
  const dec = Math.max(1, Math.round(sr0 / 11025)), sr = sr0 / dec;
  const n = Math.floor(song.length / dec), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = i * dec; for (let k = 0; k < dec; k++) s += a[o + k] + b[o + k]; x[i] = s / (2 * dec); }
  const N = 4096, hop = Math.round(sr * hopSec), F = Math.max(1, Math.floor((n - N) / hop) + 1);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const pc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f >= 80 && f <= 4000) pc[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12; }
  const chroma = new Float32Array(F * 12), rms = new Float32Array(F), re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < F; f++) {
    const o = f * hop; let e = 0;
    for (let i = 0; i < N; i++) { const v = x[o + i] || 0; e += v * v; re[i] = v * win[i]; im[i] = 0; }
    rms[f] = Math.sqrt(e / N);
    fftMag(re, im);
    const c = chroma.subarray(f * 12, f * 12 + 12);
    for (let k = 1; k < N / 2; k++) if (pc[k] >= 0) c[pc[k]] += Math.hypot(re[k], im[k]);
    let mx = 0; for (let i = 0; i < 12; i++) { c[i] = Math.sqrt(c[i]); mx += c[i] / 12; }
    for (let i = 0; i < 12; i++) c[i] -= mx;              // centre: keep only which notes stand out
    let nn = 0; for (let i = 0; i < 12; i++) nn += c[i] * c[i]; nn = Math.sqrt(nn) || 1;
    for (let i = 0; i < 12; i++) c[i] /= nn;
  }
  return { chroma, rms, F, hopSec };
}

/* returns up to 3 candidate starts (seconds), best first */
function chorusCandidates(song, winSec) {
  const hopSec = 0.5, { chroma, rms, F } = songFeatures(song, hopSec);
  const W = Math.max(4, Math.min(F - 1, Math.round(winSec / hopSec)));
  if (F < W * 2 + 2) return [{ t: 0, score: 0 }];
  // similarity matrix (cosine of unit chroma vectors), contrast-stretched
  const S = new Float32Array(F * F);
  for (let i = 0; i < F; i++) for (let j = i; j < F; j++) {
    let d = 0; for (let k = 0; k < 12; k++) d += chroma[i * 12 + k] * chroma[j * 12 + k];
    d = Math.max(0, d); S[i * F + j] = S[j * F + i] = d;
  }
  // loudness, normalised 0..1
  let rmax = 0; for (let i = 0; i < F; i++) rmax = Math.max(rmax, rms[i]);
  const loud = new Float32Array(F + 1); for (let i = 0; i < F; i++) loud[i + 1] = loud[i] + rms[i] / (rmax || 1);
  const minLag = Math.round(W * 0.8), score = new Float32Array(F - W + 1);
  const sims = new Float32Array(F);
  for (let i = 0; i + W <= F; i++) {
    sims.fill(-1);
    for (let j = 0; j + W <= F; j++) {
      if (Math.abs(i - j) < minLag) continue;
      let v = 0; for (let k = 0; k < W; k++) v += S[(i + k) * F + j + k];
      sims[j] = v / W;
    }
    // the two strongest repeats at clearly different places (a chorus comes back 2-3 times)
    let j1 = -1; for (let j = 0; j < F; j++) if (sims[j] > (j1 < 0 ? -1 : sims[j1])) j1 = j;
    let j2 = -1; for (let j = 0; j < F; j++) if (Math.abs(j - j1) >= minLag && sims[j] > (j2 < 0 ? -1 : sims[j2])) j2 = j;
    const best = Math.max(0, j1 < 0 ? 0 : sims[j1]), second = Math.max(0, j2 < 0 ? 0 : sims[j2]);
    const L = (loud[i + W] - loud[i]) / W;
    score[i] = (best + second) * (0.6 + 0.4 * L);
  }
  const order = [...score.keys()].sort((p, q) => score[q] - score[p]), picked = [];
  for (const i of order) { if (picked.length >= 3) break; if (picked.every(p => Math.abs(p - i) >= W * 0.75)) picked.push(i); }
  return picked.map(i => {
    // snap to the strongest loudness rise within ±3 s (section boundary)
    let bi = i, bd = -1;
    for (let k = Math.max(2, i - 6); k <= Math.min(F - W, i + 6); k++) { const d = (rms[k] + (rms[k + 1] || 0)) - (rms[k - 1] + rms[k - 2]); if (d > bd) { bd = d; bi = k; } }
    return { t: bi * hopSec, score: score[i] };
  });
}

/* ---------------------------------------------------------------- beat grid (Create 2.0 smart cut)
   Real measurement, no AI: spectral-flux onsets → tempo by autocorrelation (with a soft prior around
   120 BPM) → beat phase → bar phase from the low-frequency onsets (kick drums land on the bar).
   Returns null when the song has no steady pulse (speech, ambient, rubato), so callers keep the old cut. */
function beatGrid(song, around, span) {
  const sr0 = song.sampleRate, a = song.getChannelData(0), b = song.numberOfChannels > 1 ? song.getChannelData(1) : a;
  const dec = Math.max(1, Math.round(sr0 / 11025)), sr = sr0 / dec;
  // analyse only `span` seconds around `around` (default: the whole song); times are returned for the whole song
  const D = song.length / sr0, W = Math.min(D, span || D), t0 = around == null ? 0 : Math.max(0, Math.min(D - W, around - W / 2));
  const base = Math.floor(t0 * sr0), n = Math.floor(Math.floor(W * sr0) / dec);
  const x = new Float32Array(n);                                  // mono, ~11 kHz, computed once
  for (let i = 0; i < n; i++) { let s = 0; const o = base + i * dec; for (let k = 0; k < dec; k++) s += (a[o + k] || 0) + (b[o + k] || 0); x[i] = s / (2 * dec); }
  const N = 512, hop = 128, F = Math.floor((n - N) / hop);
  if (F < 400) return null;                                       // under ~5 s: not enough to measure a pulse
  const fps = sr / hop, win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), NB = 6, prevB = new Float32Array(NB), bandOf = new Int8Array(N / 2);
  const edges = [0, 150, 300, 600, 1200, 2400, Infinity];
  for (let k = 0; k < N / 2; k++) { const f = k * sr / N; let j = 0; while (f >= edges[j + 1]) j++; bandOf[k] = j; }
  const bandE = new Float32Array(NB);
  const flux = new Float32Array(F), low = new Float32Array(F), chr = new Float32Array(F * 12);
  const pcK = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f >= 130 && f <= 2000) pcK[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12; }
  for (let f = 0; f < F; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fftMag(re, im);
    bandE.fill(0);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      bandE[bandOf[k]] += mag * mag;
      if (pcK[k] >= 0) chr[f * 12 + pcK[k]] += mag;
    }
    let fl = 0, lo = 0;
    for (let j = 0; j < NB; j++) {
      const m = Math.log1p(1000 * bandE[j]), d = m - prevB[j];
      if (d > 0) { fl += d; if (j === 0) lo += d; }
      prevB[j] = m;
    }
    flux[f] = fl; low[f] = lo;
  }
  // remove the slow loudness trend so only the attacks remain
  const L = Math.round(fps * 0.4), pre = new Float64Array(F + 1); for (let i = 0; i < F; i++) pre[i + 1] = pre[i] + flux[i];
  const on = new Float32Array(F);
  for (let i = 0; i < F; i++) { const s = Math.max(0, i - L), e = Math.min(F, i + L + 1); on[i] = Math.max(0, flux[i] - (pre[e] - pre[s]) / (e - s)); }
  // tempo: autocorrelation over 60..200 BPM, weighted toward 120 BPM (log-Gaussian, one octave wide)
  const minLag = Math.floor(fps * 60 / 200), maxLag = Math.ceil(fps * 60 / 60), ac = new Float32Array(maxLag + 2);
  for (let l = minLag - 1; l <= maxLag + 1; l++) { let s = 0; for (let i = l; i < F; i++) s += on[i] * on[i - l]; ac[l] = s / (F - l); }
  let best = -1, bestL = 0;
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = 60 * fps / l, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const v = ac[l] * w; if (v > best) { best = v; bestL = l; }
  }
  if (!bestL) return null;
  // (band-wise onsets keep kick and snare as strong as hi-hats, so no octave correction is needed: an earlier
  //  'double if the off-beats are strong' rule doubled slow songs with busy hi-hats — see tests/smartcut)

  // fine search of period AND phase together (±1%): a 0.2% period error drifts a third of a second over a song
  const score = (lag, ph) => { let s = 0; for (let t = ph; t < F - 1; t += lag) { const i = Math.round(t); s += (on[i] || 0) + 0.5 * ((on[i - 1] || 0) + (on[i + 1] || 0)); } return s; };
  let lag = bestL, ph0 = 0, top = -1, sum = 0, cnt = 0;
  for (let q = -20; q <= 20; q++) {
    const l = bestL * (1 + q * 0.0005);
    for (let ph = 0; ph < l; ph += 0.5) { const v = score(l, ph); sum += v; cnt++; if (v > top) { top = v; lag = l; ph0 = ph; } }
  }
  // last step: find each beat's real onset peak (±15% of a beat) and fit a straight line through all of them.
  // The slope is the exact period and the intercept the exact first beat, so nothing drifts along the song.
  {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0, k = 0;
    for (let t = ph0; t < F - 1; t += lag, k++) {
      const r = Math.max(1, Math.round(lag * 0.15)), c = Math.round(t);
      let bi = c, bv = -1; for (let i = Math.max(0, c - r); i <= Math.min(F - 1, c + r); i++) if (on[i] > bv) { bv = on[i]; bi = i; }
      if (bv <= 0) continue;
      const w = bv; sw += w; sk += w * k; st += w * bi; skk += w * k * k; skt += w * k * bi;
    }
    const den = sw * skk - sk * sk;
    if (sw > 0 && den > 0) {
      const p = (sw * skt - sk * st) / den, a0 = (st - p * sk) / sw;
      if (Math.abs(p - lag) < 0.02 * lag) { lag = p; ph0 = ((a0 % lag) + lag) % lag; }
    }
  }
  const period = lag / fps;
  // confidence: correlation of the onset curve with itself one beat later (0 = no pulse, a steady beat ≈ 0.3+)
  let mu = 0; for (let i = 0; i < F; i++) mu += on[i] / F;
  const R = Math.round(lag); let cov = 0, vr = 0;
  for (let i = 0; i < F; i++) { const d = on[i] - mu; vr += d * d; if (i >= R) cov += d * (on[i - R] - mu); }
  const conf = vr ? cov / vr : 0;
  // bar phase: chords change on the first beat of a bar, and the kick is usually strongest there.
  // Per beat: average chroma; novelty = how much the harmony changed from the previous beat.
  const beats = []; for (let t = ph0; t < F - 1; t += lag) beats.push(t);
  const bc = beats.map((t, i) => {
    const s0 = Math.max(0, Math.round(t)), s1 = Math.min(F, Math.round(beats[i + 1] ?? t + lag)), v = new Float32Array(12);
    for (let f = s0; f < s1; f++) for (let k = 0; k < 12; k++) v[k] += chr[f * 12 + k];
    let nn = 0; for (let k = 0; k < 12; k++) nn += v[k] * v[k]; nn = Math.sqrt(nn) || 1; for (let k = 0; k < 12; k++) v[k] /= nn;
    return v;
  });
  const nov = new Float32Array(4), att = new Float32Array(4);
  for (let i = 1; i < beats.length; i++) {
    let c = 0; for (let k = 0; k < 12; k++) c += bc[i][k] * bc[i - 1][k];
    nov[i % 4] += 1 - c;
    const j = Math.round(beats[i]); att[i % 4] += (low[j] || 0) + 0.5 * ((low[j - 1] || 0) + (low[j + 1] || 0));
  }
  const nmax = Math.max(...nov) || 1, amax = Math.max(...att) || 1;
  let bar = 0, bs = -1; for (let j = 0; j < 4; j++) { const v = nov[j] / nmax + 0.5 * att[j] / amax; if (v > bs) { bs = v; bar = j; } }
  // a frame stands for its window centre, plus the detector's fixed 11 ms latency (measured on sharp attacks, tests/smartcut)
  const first0 = t0 + (ph0 + N / 2 / hop) / fps + 0.011, first = first0 - Math.floor(first0 / period) * period, downbeat = first0 + bar * period;
  return { bpm: 60 / period, period, first, downbeat: downbeat - Math.floor(downbeat / (4 * period)) * 4 * period, conf };
}

/* nearest grid line to t: a bar line when one is within `barWin` seconds, else the nearest beat */
function snapToGrid(t, g, barWin) {
  if (!g) return t;
  const bar = 4 * g.period, kb = Math.round((t - g.downbeat) / bar), tb = g.downbeat + kb * bar;
  if (Math.abs(tb - t) <= (barWin == null ? 1.5 : barWin) && tb >= 0) return tb;
  const k = Math.round((t - g.first) / g.period), tt = g.first + k * g.period;
  return tt >= 0 ? tt : t;
}

/* the longest whole number of beats that fits in maxLen (and is at least minLen) */
function beatLen(maxLen, g, minLen) {
  if (!g) return maxLen;
  const n = Math.floor((maxLen + 1e-6) / g.period);
  const L = n * g.period;
  return L >= (minLen || 0) ? L : maxLen;
}

/* where does the section around t really start? Choose the bar line near t (up to 4 bars before, 1 after)
   with the strongest change into a louder, different-sounding part: loudness ratio after/before plus how
   much the chords change. A chorus begins on such a line, so the cut starts where a listener expects it. */
function sectionStart(song, g, t) {
  if (!g) return t;
  const sr = song.sampleRate, a = song.getChannelData(0), b = song.numberOfChannels > 1 ? song.getChannelData(1) : a;
  const bar = 4 * g.period, D = song.length / sr;
  const rmsSpan = (t0, t1) => { const s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(song.length, Math.floor(t1 * sr)); let e = 0, n = 0;
    for (let i = s0; i < s1; i += 4) { const v = (a[i] + b[i]) / 2; e += v * v; n++; } return n ? Math.sqrt(e / n) : 0; };
  const k0 = Math.round((t - g.downbeat) / bar);
  let bestT = snapToGrid(t, g, bar), bestS = -1;
  for (let k = k0 - 4; k <= k0 + 1; k++) {
    const tb = g.downbeat + k * bar;
    if (tb < bar || tb + 2 * bar > D) continue;
    const before = rmsSpan(tb - 2 * bar, tb), after = rmsSpan(tb, tb + 2 * bar);
    const near = 1 - 0.04 * Math.abs(k - k0);                       // prefer lines close to the detected part
    const sc = (after / (before + 1e-4)) * near;
    if (sc > bestS) { bestS = sc; bestT = tb; }
  }
  return bestT;
}
