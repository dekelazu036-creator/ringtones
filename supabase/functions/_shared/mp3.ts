// MP3 check done on the server, on the bytes actually received.
// Not a full decoder: it walks the MPEG audio frame chain and refuses anything that is not a
// consistent MPEG-1/2/2.5 Layer III stream. Duration comes from the frames, not from the browser.

export type Mp3Result =
  | { ok: true; durationMs: number; frames: number; sampleRate: number; audioBytes: number }
  | { ok: false; reason: string };

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export const MP3_LIMITS = {
  maxId3Bytes: 512 * 1024,     // cover art etc.; more is not plausible for a ringtone
  minFrames: 4,
  minAudioShare: 0.9,          // frames must cover ≥90% of the bytes after the leading tag
  maxTrailingJunk: 2048,
};

type Header = { version: number; sampleRate: number; length: number; samples: number };

function parseHeader(b: Uint8Array, i: number): Header | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;          // 11-bit sync
  const version = (b[i + 1] >> 3) & 3;                                    // 0=2.5, 2=2, 3=1, 1=reserved
  const layer = (b[i + 1] >> 1) & 3;                                      // 1 = Layer III
  const brIdx = (b[i + 2] >> 4) & 15;
  const srIdx = (b[i + 2] >> 2) & 3;
  const pad = (b[i + 2] >> 1) & 1;
  if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const kbps = (version === 3 ? BITRATES_V1 : BITRATES_V2)[brIdx];
  const sampleRate = RATES[version][srIdx];
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + pad;
  if (length < 24) return null;
  return { version, sampleRate, length, samples };
}

function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;   // "ID3"
  if ((b[6] | b[7] | b[8] | b[9]) & 0x80) return -1;                                  // not syncsafe
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  const footer = b[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

function isTrailingTag(b: Uint8Array, i: number): boolean {
  const rest = b.length - i;
  if (rest === 128 && b[i] === 0x54 && b[i + 1] === 0x41 && b[i + 2] === 0x47) return true;            // ID3v1 "TAG"
  const ape = [0x41, 0x50, 0x45, 0x54, 0x41, 0x47, 0x45, 0x58];                                          // "APETAGEX"
  if (rest >= 32 && rest <= 65536 && ape.every((c, k) => b[i + k] === c)) return true;   // bounded: no smuggled payloads
  return false;
}

export function checkMp3(bytes: Uint8Array): Mp3Result {
  if (bytes.length < 128) return { ok: false, reason: 'too_small' };
  const tag = id3v2Size(bytes);
  if (tag < 0) return { ok: false, reason: 'bad_id3' };
  if (tag > MP3_LIMITS.maxId3Bytes) return { ok: false, reason: 'id3_too_large' };
  if (tag >= bytes.length) return { ok: false, reason: 'no_audio' };

  let i = tag;
  // some encoders pad between the tag and the first frame
  let skipped = 0;
  while (i < bytes.length && bytes[i] === 0 && skipped < 4096) { i++; skipped++; }

  let frames = 0, samples = 0, audioBytes = 0, version = -1, sampleRate = 0;
  while (i < bytes.length) {
    const h = parseHeader(bytes, i);
    if (!h) break;
    if (version === -1) { version = h.version; sampleRate = h.sampleRate; }
    else if (h.version !== version || h.sampleRate !== sampleRate) return { ok: false, reason: 'inconsistent_stream' };
    if (i + h.length > bytes.length) {                       // last frame cut short: accept, but don't count it
      audioBytes += bytes.length - i; i = bytes.length; break;
    }
    frames++; samples += h.samples; audioBytes += h.length; i += h.length;
  }
  if (frames < MP3_LIMITS.minFrames) return { ok: false, reason: 'not_mp3' };
  if (i < bytes.length && !isTrailingTag(bytes, i) && bytes.length - i > MP3_LIMITS.maxTrailingJunk) {
    return { ok: false, reason: 'corrupt' };
  }
  if (audioBytes < (bytes.length - tag) * MP3_LIMITS.minAudioShare && !isTrailingTag(bytes, i)) {
    return { ok: false, reason: 'not_mostly_audio' };
  }
  return { ok: true, durationMs: Math.round((samples * 1000) / sampleRate), frames, sampleRate, audioBytes };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}
