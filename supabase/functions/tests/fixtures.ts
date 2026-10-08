// Test fixtures, generated at run time (no audio files committed).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// the exact encoder the site uses (vendor/lame.min.js, 192 kbps stereo, like index.html)
let lame: any = null;
export function siteMp3(sampleRate: number, seconds: number): Uint8Array {
  if (!lame) {
    const ctx: any = { console, Math, Int16Array, Int8Array, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Error };
    ctx.window = ctx; ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync(ROOT + 'vendor/lame.min.js', 'utf8'), ctx);
    lame = ctx.lamejs;
  }
  const enc = new lame.Mp3Encoder(2, sampleRate, 192);
  const n = Math.round(sampleRate * seconds), L = new Int16Array(n), R = new Int16Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  const out: number[] = [];
  for (let i = 0; i < n; i += 1152) out.push(...enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152)));
  out.push(...enc.flush());
  return Uint8Array.from(out.map((x) => x & 255));
}

export function ffmpeg(args: string[]): Uint8Array {
  return new Uint8Array(execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, 'pipe:1'], { maxBuffer: 64 << 20 }));
}
export const sine = (secs: number) => ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`];

export function repoSound(name: string): Uint8Array {
  return new Uint8Array(readFileSync(ROOT + 'sounds/' + name));
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function id3Header(payloadBytes: number): Uint8Array {
  const s = payloadBytes;
  const h = new Uint8Array(10 + s);
  h.set([0x49, 0x44, 0x33, 4, 0, 0, (s >> 21) & 127, (s >> 14) & 127, (s >> 7) & 127, s & 127]);
  return h;
}
