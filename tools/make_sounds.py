"""Generates SnipRing's official sound library from scratch (pure synthesis, no samples).
Every sound is original, so SnipRing owns it outright.
Output: sounds/<slug>.mp3 and sounds/catalog.json (metadata + waveform peaks).
Run:  python3 tools/make_sounds.py   (needs numpy, scipy, ffmpeg with libmp3lame)
"""
import json, os, subprocess, tempfile
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'sounds')
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- helpers
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def tl(d): return np.arange(int(d * SR)) / SR
def silence(d): return np.zeros((int(d * SR), 2))

def adsr(n, a=.005, d=.1, s=.6, r=.2):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    s_len = max(0, n - a - d - r)
    e = np.concatenate([np.linspace(0, 1, max(a, 1)), np.linspace(1, s, max(d, 1)), np.full(s_len, s), np.linspace(s, 0, max(r, 1))])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))

def expdec(n, tau): return np.exp(-np.arange(n) / SR / tau)

def tail(x, d=.03):
    """short fade at the very end of a note, so cut-off notes never click"""
    k = min(len(x), int(d * SR)); x = x.copy(); x[-k:] *= np.linspace(1, 0, k) ** 2
    return x

def lp(x, f, order=2): return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x, axis=0)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x, axis=0)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x, axis=0)

def stereo(m, pan=0.0):
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([m * l, m * r], axis=1)

def place(buf, snd, at):
    i = int(at * SR)
    if i >= len(buf): return buf
    end = min(len(buf), i + len(snd))
    buf[i:end] += snd[:end - i]
    return buf

def reverb(x, size=1.6, mix=.25, bright=6000):
    n = int(size * SR)
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * expdec(n, size / 5)[:, None]
    ir = lp(ir, bright)
    ir[:int(.012 * SR)] *= np.linspace(0, 1, int(.012 * SR))[:, None]
    wet = np.stack([fftconvolve(x[:, 0], ir[:, 0])[:len(x)], fftconvolve(x[:, 1], ir[:, 1])[:len(x)]], 1)
    wet *= np.max(np.abs(x)) / (np.max(np.abs(wet)) + 1e-9)
    return x * (1 - mix) + wet * mix

def finish(x, peak=.89, fade_in=.003, fade_out=.08, target_db=-15.0):
    x = x - np.mean(x, axis=0)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    x[:fi] *= np.linspace(0, 1, fi)[:, None]
    x[-fo:] *= np.linspace(1, 0, fo)[:, None]
    # loudness: match the RMS of the audible part to one target, then soft-limit the peaks
    m = np.max(np.abs(x), axis=1); w = int(.02 * SR)
    env = np.convolve(m, np.ones(w) / w, 'same'); act = env > .05 * env.max()
    rms = np.sqrt(np.mean(x[act] ** 2)) + 1e-9
    g = min(10 ** (target_db / 20) / rms, 2.2 * peak / (np.max(np.abs(x)) + 1e-9))
    x = x * g
    return np.tanh(x / peak) * peak

# ---------------------------------------------------------------- instruments (mono)
def bell(f, d, ratio=3.5, index=3.0, tau=.6):
    t = tl(d); e = expdec(len(t), tau)
    return tail(np.sin(2 * np.pi * f * t + index * e * np.sin(2 * np.pi * f * ratio * t)) * e)

def marimba(f, d=1.2):
    t = tl(d); out = np.zeros(len(t))
    for k, (mult, amp, tau) in enumerate([(1, 1, .5), (3.93, .35, .12), (9.2, .12, .04)]):
        out += amp * np.sin(2 * np.pi * f * mult * t) * expdec(len(t), tau)
    out[:int(.002 * SR)] *= np.linspace(0, 1, int(.002 * SR))
    return tail(out, .06)

def epiano(f, d=1.5):
    t = tl(d); e = expdec(len(t), .9)
    mod = 1.8 * expdec(len(t), .25) * np.sin(2 * np.pi * f * t)
    tone = np.sin(2 * np.pi * f * t + mod) + .3 * np.sin(2 * np.pi * 2 * f * t) * expdec(len(t), .3)
    return tail(tone * e * adsr(len(t), .003, .05, 1, .15))

def pluck(f, d=1.0, damp=.996):
    n = int(d * SR); p = max(2, int(SR / f)); buf = rng.uniform(-1, 1, p); out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = damp * .5 * (buf[i % p] + buf[(i + 1) % p])
    return tail(lp(out, 6000))

def square(f, d, duty=.5, a=.002, r=.03):
    t = tl(d); w = np.where((t * f) % 1 < duty, 1.0, -1.0)
    return w * adsr(len(t), a, .02, .8, r) * .5

def tri(f, d):
    t = tl(d); return (2 * np.abs(2 * ((t * f) % 1) - 1) - 1)

def pad(freqs, d, a=1.2, r=1.5, detune=.006, bright=2500):
    t = tl(d); out = np.zeros((len(t), 2))
    for f in freqs:
        for k, dt in enumerate((-detune, 0, detune)):
            ph = rng.uniform(0, 2 * np.pi)
            saw = 2 * ((t * f * (1 + dt) + ph / (2 * np.pi)) % 1) - 1
            out += stereo(saw, (k - 1) * .6)
    out = lp(out, bright, 2)
    return out * adsr(len(t), a, .5, .85, r)[:, None] / (len(freqs) * 3)

def kick(d=.4):
    t = tl(d); f = 45 + 110 * np.exp(-t / .045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * expdec(len(t), .16) + .3 * lp(rng.standard_normal(len(t)), 3000) * expdec(len(t), .004)

def snare(d=.25):
    t = tl(d)
    return .6 * bp(rng.standard_normal(len(t)), 1500, 9000) * expdec(len(t), .07) + .4 * np.sin(2 * np.pi * 190 * t) * expdec(len(t), .05)

def hat(d=.06, tau=.015):
    return hp(rng.standard_normal(int(d * SR)), 7000, 4) * expdec(int(d * SR), tau) * .5

def noise_sweep(d, f0, f1, q=.4):
    n = int(d * SR); out = np.zeros(n); x = rng.standard_normal(n); blk = 512
    for i in range(0, n, blk):
        fc = f0 * (f1 / f0) ** (i / n)
        out[i:i + blk] = bp(x[i:i + blk + 2048], fc * (1 - q), min(fc * (1 + q), SR / 2 - 100))[:len(out[i:i + blk])]
    return out

def chirp(f0, f1, d, shape=2.0):
    t = tl(d); f = f0 + (f1 - f0) * (t / d) ** shape
    return np.sin(2 * np.pi * np.cumsum(f) / SR)

# ---------------------------------------------------------------- sounds
def seq(notes, inst, step, total, vel=None, gain=1.0, pan=0.0, **kw):
    """notes: list of midi or None (rest) or tuples (chords); one per step"""
    buf = silence(total)
    for i, n in enumerate(notes):
        if n is None: continue
        for m in (n if isinstance(n, tuple) else (n,)):
            v = vel[i % len(vel)] if vel else 1
            place(buf, stereo(inst(mtof(m), **kw) * v * gain, pan), i * step)
    return buf

S = {}  # slug -> (array, meta)

def add(slug, x, meta):
    S[slug] = (finish(x, fade_out=meta.pop('fade_out', .08)), meta)

# --- notifications
def glass_ping():
    b = silence(1.6)
    place(b, stereo(bell(mtof(88), 1.4, 3.01, 1.2, .35), -.2), 0)
    place(b, stereo(bell(mtof(95), 1.2, 3.01, 1.0, .3) * .7, .2), .11)
    return reverb(b, 1.4, .3, 9000)
add('glass-ping', glass_ping(), dict(type='text', he='פינג זכוכית', en='Glass ping', moods=['minimal', 'luxury'], tags=['glass', 'bell', 'short', 'clean'],
    dhe='שני צלילי זכוכית קצרים ונקיים. התראה אלגנטית שלא מפריעה.', den='Two short, clean glass tones. An elegant alert that never annoys.'))

def soft_pop():
    t = tl(.25); f = 300 + 900 * np.exp(-t / .02)
    pop = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), .05)
    b = silence(.6); place(b, stereo(pop, 0), 0); place(b, stereo(pop * .5, .3), .09)
    return reverb(b, .6, .15)
add('soft-pop', soft_pop(), dict(type='text', he='פופ רך', en='Soft pop', moods=['minimal', 'happy'], tags=['bubble', 'pop', 'cute'],
    dhe='בועה קטנה שמתפוצצת. קליל, חמוד וקצר.', den='A tiny bubble popping. Light, cute and short.'))

def twin_chime():
    b = silence(2.0)
    place(b, stereo(marimba(mtof(79), 1.6), -.3), 0); place(b, stereo(marimba(mtof(84), 1.6), .3), .16)
    return reverb(b, 1.8, .3)
add('twin-chime', twin_chime(), dict(type='text', he='צלצול כפול', en='Twin chime', moods=['calm', 'minimal'], tags=['chime', 'marimba', 'soft'],
    dhe='שני צלילי מרימבה עולים. רך ונעים לאוזן.', den='Two rising marimba notes. Soft and easy on the ear.'))

def neon_blip():
    b = silence(.9)
    for i, m in enumerate([84, 91, 96]):
        place(b, stereo(lp(square(mtof(m), .07, .25), 5000), (i - 1) * .4), i * .055)
    return reverb(b, .9, .25, 7000)
add('neon-blip', neon_blip(), dict(type='text', he='בליפ ניאון', en='Neon blip', moods=['futuristic', 'minimal'], tags=['electronic', 'digital', 'synth', 'cyberpunk'],
    dhe='שלושה בליפים דיגיטליים מהירים. התראה עתידנית ונקייה.', den='Three quick digital blips. A clean, futuristic alert.'))

def coin_up():
    b = silence(.8)
    place(b, stereo(square(mtof(83), .08, .5)), 0); place(b, stereo(square(mtof(88), .45, .5, r=.3)), .08)
    return lp(b, 5000)
add('coin-up', coin_up(), dict(type='text', he='מטבע', en='Coin up', moods=['happy', 'funny'], tags=['8-bit', 'retro', 'gaming', 'coin'],
    dhe='צליל איסוף מטבע בסגנון משחקי שנות ה־80.', den='A coin pickup in classic 80s video game style.'))

def wood_knock():
    b = silence(.7)
    for i, at in enumerate([0, .13]):
        t = tl(.12); k = np.sin(2 * np.pi * (520 - i * 60) * t) * expdec(len(t), .018) + .3 * bp(rng.standard_normal(len(t)), 800, 3000) * expdec(len(t), .006)
        place(b, stereo(k, .2 * (i * 2 - 1)), at)
    return reverb(b, .5, .15)
add('wood-knock', wood_knock(), dict(type='text', he='נקישת עץ', en='Wood knock', moods=['minimal', 'calm'], tags=['wood', 'knock', 'natural'],
    dhe='שתי נקישות עץ עדינות, כמו דפיקה קלה בדלת.', den='Two gentle wood knocks, like a light tap on the door.'))

def rising_spark():
    b = silence(1.4)
    for i, m in enumerate([72, 76, 79, 84, 88]):
        place(b, stereo(bell(mtof(m), .7, 2.0, 1.5, .2) * (.6 + i * .1), (i - 2) * .3), i * .06)
    return reverb(b, 1.2, .3, 9000)
add('rising-spark', rising_spark(), dict(type='text', he='ניצוץ עולה', en='Rising spark', moods=['energetic', 'happy'], tags=['sparkle', 'arpeggio', 'magic'],
    dhe='ארפג׳ו נוצץ שעולה מהר. מרגיש כמו הצלחה קטנה.', den='A sparkling arpeggio rising fast. Feels like a small win.'))

def velvet_drop():
    t = tl(.4); f = 1400 * np.exp(-t / .05) + 500
    drop = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), .08) * adsr(len(t), .004, .05, 1, .05)
    b = silence(2.0); place(b, stereo(drop, -.1), 0); place(b, stereo(drop * .45, .3), .22)
    return reverb(b, 2.0, .45, 5000)
add('velvet-drop', velvet_drop(), dict(type='text', he='טיפת קטיפה', en='Velvet drop', moods=['luxury', 'calm'], tags=['water', 'drop', 'smooth'],
    dhe='טיפת מים עמוקה עם הד רך. יוקרתי ושקט.', den='A deep water drop with a soft echo. Quiet and luxurious.'))

# --- ringtones
def marimba_morning():
    step, bars = .2, 6
    mel = [72, 76, 79, 76, 81, 79, 76, 72, 74, 77, 81, 77, 79, 76, 72, None] * 2 + [72, 76, 79, 84, 79, 76, 72, None] * 2
    total = len(mel) * step + 1.5
    b = seq(mel, marimba, step, total, vel=[1, .7, .8, .7], gain=.9, pan=-.1)
    bass = [48, None, None, None, 53, None, None, None, 55, None, None, None, 48, None, None, None] * 3
    b += seq(bass, lambda f: marimba(f, 1.4), step, total, gain=.6, pan=.15)
    return reverb(b, 1.6, .22)
add('marimba-morning', marimba_morning(), dict(type='ring', he='מרימבה של בוקר', en='Marimba morning', moods=['happy', 'calm'], tags=['marimba', 'melody', 'bright'],
    dhe='מנגינת מרימבה שמחה ונקייה. רינגטון שאפשר לשמוע שוב ושוב.', den='A cheerful, clean marimba tune. A ringtone you can hear again and again.'))

def city_pulse():
    bpm = 118; beat = 60 / bpm; step = beat / 4; steps = 16 * 10; total = steps * step + 1
    b = silence(total)
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]
    for s in range(steps):
        at = s * step; bar = s // 16
        if s % 4 == 0: place(b, stereo(kick() * .9), at)
        if s % 8 == 4: place(b, stereo(snare() * .5, .1), at)
        if s % 2 == 1: place(b, stereo(hat() * .6, .35), at)
        ch = chords[bar % 4]
        if s % 16 == 0 and bar >= 1: b = place(b, pad([mtof(n) for n in ch], 16 * step, .05, .3, bright=1800) * .7, at)
        if bar >= 2:
            n = ch[s % 3] + 24 if s % 4 != 3 else ch[0] + 24
            place(b, stereo(lp(square(mtof(n), step * .8, .3), 3500) * .25, .4 * np.sin(s)), at)
        if s % 4 == 2:
            place(b, stereo(lp(tri(mtof(ch[0] - 12), step * 1.8), 400) * adsr(int(step * 1.8 * SR), .005, .1, .7, .05) * .7), at)
    return reverb(b, 1.0, .12)
add('city-pulse', city_pulse(), dict(type='ring', he='דופק עירוני', en='City pulse', moods=['energetic'], tags=['electronic', 'beat', 'bass', 'synth'],
    dhe='ביט אלקטרוני עם בס וארפג׳ו שנבנה בהדרגה. אנרגטי ומודרני.', den='An electronic beat with bass and an arpeggio that builds up. Energetic and modern.'))

def golden_hour():
    total = 24
    b = silence(total)
    prog = [(50, 57, 62, 66), (47, 54, 59, 62), (43, 50, 55, 59), (45, 52, 57, 61)]
    for i, ch in enumerate(prog * 2):
        place(b, pad([mtof(n) for n in ch], 3.4, 1.0, 1.2, bright=2200) * .9, i * 3)
    mel = [(0, 74), (1.5, 76), (3, 78), (4.5, 81), (6, 79), (7.5, 78), (9, 76), (10.5, 74), (12, 74), (13.5, 76), (15, 78), (16.5, 83), (18, 81), (19.5, 78), (21, 74)]
    for at, m in mel:
        place(b, stereo(bell(mtof(m), 2.0, 2.0, 1.2, .9) * .35, .2), at + .2)
    return reverb(b, 3.0, .38, 5000)
add('golden-hour', golden_hour(), dict(type='ring', he='שעת זהב', en='Golden hour', moods=['luxury', 'cinematic', 'calm'], tags=['pad', 'bell', 'ambient', 'elegant'],
    dhe='אקורדים רחבים ומנגינת פעמונים איטית. יוקרתי וקולנועי.', den='Wide chords and a slow bell melody. Luxurious and cinematic.', fade_out=1.5))

def retro_arcade():
    step = .11
    mel = [76, 76, None, 76, None, 72, 76, None, 79, None, None, None, 67, None, None, None,
           72, None, None, 67, None, None, 64, None, None, 69, None, 71, None, 70, 69, None,
           67, 76, 79, 81, None, 77, 79, None, 76, None, 72, 74, 71, None, None, None] * 2
    total = len(mel) * step + .6
    b = seq(mel, lambda f: square(f, step * .9, .25), step, total, gain=.5)
    bass = [48, None, 55, None] * (len(mel) // 4)
    b += seq(bass, lambda f: tri(f, step * 1.8) * adsr(int(step * 1.8 * SR), .002, .05, .6, .03) * .5, step, total)
    return b
add('retro-arcade', retro_arcade(), dict(type='ring', he='ארקייד', en='Retro arcade', moods=['happy', 'funny'], tags=['8-bit', 'chiptune', 'gaming', 'retro'],
    dhe='מנגינת 8־ביט מקורית, כמו מכונת משחקים ישנה.', den='An original 8-bit tune, like an old arcade machine.'))

def lofi_call():
    bpm = 82; beat = 60 / bpm; total = beat * 4 * 7 + 1.5
    b = silence(total)
    chords = [(53, 57, 60, 64), (52, 55, 59, 62), (50, 53, 57, 60), (55, 59, 62, 65)]
    for bar in range(7):
        ch = chords[bar % 4]; at = bar * 4 * beat
        for k, n in enumerate(ch): place(b, stereo(epiano(mtof(n), 2.4) * .3, (k - 1.5) * .25), at + k * .018)
        for k, n in enumerate(ch): place(b, stereo(epiano(mtof(n), 1.2) * .18, (k - 1.5) * .25), at + 2.5 * beat + k * .018)
        for q in range(4):
            if q in (0, 2): place(b, stereo(lp(kick(), 1200) * .6), at + q * beat + (.03 if q == 2 else 0))
            if q in (1, 3): place(b, stereo(lp(snare(), 4000) * .35, .1), at + q * beat)
            for e in range(2): place(b, stereo(hat(.05, .01) * .3, .3), at + q * beat + e * beat / 2 + (.04 if e else 0))
    b = lp(b, 6500)
    b += stereo(lp(rng.standard_normal(len(b)), 3000) * .006, 0)  # vinyl-ish hiss
    return reverb(b, 1.4, .2, 4000)
add('lofi-call', lofi_call(), dict(type='ring', he='שיחה רגועה', en='Lo-fi call', moods=['calm', 'relaxing'], tags=['lofi', 'piano', 'chill', 'beat'],
    dhe='אקורדי פסנתר חשמלי עם ביט לו־פיי רך. רגוע ונעים.', den='Electric piano chords over a soft lo-fi beat. Calm and pleasant.', fade_out=1.2))

def classic_ring():
    b = silence(16)
    for cycle in range(5):
        at = cycle * 3
        for burst in range(2):
            t = tl(.4); tone = (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)) * (np.sin(2 * np.pi * 20 * t) > 0)
            place(b, stereo(lp(tone, 4000) * .45 * adsr(len(t), .003, .01, 1, .02)), at + burst * .6)
    return reverb(b, .5, .1)
add('classic-ring', classic_ring(), dict(type='ring', he='צלצול קלאסי', en='Classic ring', moods=['minimal'], tags=['phone', 'retro', 'old school', 'telephone'],
    dhe='צלצול טלפון ישן, בקצב המוכר של שני צלצולים והפסקה.', den='An old telephone ring, in the familiar rhythm of two rings and a pause.'))

# --- alarms
def sunrise():
    total = 28; b = silence(total)
    ch = [mtof(n) for n in (48, 55, 60, 64, 67)]
    b = place(b, pad(ch, 26, 8, 2, bright=1500) * 1.0, 0)
    for i in range(22):
        at = 4 + i * 1.0; m = [72, 76, 79, 84, 79, 76][i % 6] + (12 if i > 14 else 0)
        place(b, stereo(bell(mtof(m), 1.6, 3.0, .8, .5) * (.15 + .6 * i / 22), np.sin(i) * .5), at)
    env = np.linspace(.25, 1, len(b)) ** 1.5
    return reverb(b * env[:, None], 2.5, .35, 6000)
add('sunrise', sunrise(), dict(type='alarm', he='זריחה', en='Sunrise', moods=['calm', 'relaxing'], tags=['morning', 'gentle', 'pad', 'chimes'],
    dhe='מתחיל שקט מאוד ומתגבר לאט, כדי להעיר בעדינות.', den='Starts very quietly and slowly grows, to wake you up gently.', fade_out=1.0))

def wake_beeps():
    total = 26; b = silence(total); at = 0.0; i = 0
    while at < total - 1:
        n = 2 if at < 8 else 3 if at < 16 else 4
        for k in range(n):
            t = tl(.09); beep = np.sin(2 * np.pi * 2000 * t) * adsr(len(t), .002, .01, 1, .01)
            place(b, stereo(beep * (.5 + .5 * min(1, at / 16))), at + k * .14)
        at += 1.0 if at < 8 else .8 if at < 16 else .7; i += 1
    return b
add('wake-beeps', wake_beeps(), dict(type='alarm', he='ביפים', en='Wake beeps', moods=['energetic', 'minimal'], tags=['digital', 'beep', 'clock', 'classic'],
    dhe='ביפים של שעון דיגיטלי שמאיצים ומתחזקים. לא תמשיכו לישון.', den='Digital clock beeps that speed up and get louder. You will not sleep through it.'))

def morning_chirps():
    total = 26; b = silence(total)
    b += stereo(lp(rng.standard_normal(len(b)), 900) * .01, 0)
    at = .5
    while at < total - 1.5:
        pan = rng.uniform(-.8, .8); base = rng.uniform(2800, 4200)
        for k in range(rng.integers(2, 6)):
            d = rng.uniform(.05, .12); c = chirp(base * rng.uniform(.9, 1.1), base * rng.uniform(1.2, 1.6), d, 1.5)
            c *= adsr(len(c), .004, .02, .7, .02) * rng.uniform(.25, .5) * (.4 + .6 * at / total)
            place(b, stereo(c, pan), at + k * rng.uniform(.09, .16))
        at += rng.uniform(.5, 1.6)
    return reverb(b, 1.8, .3, 9000)
add('morning-chirps', morning_chirps(), dict(type='alarm', he='ציוצי בוקר', en='Morning chirps', moods=['calm', 'relaxing'], tags=['nature', 'birds', 'morning', 'forest'],
    dhe='ציוצים של ציפורים (מסונתזים) שמתרבים עם הזמן. כמו להתעורר ביער.', den='Synthesised bird chirps that grow over time. Like waking up in a forest.', fade_out=1.0))

def deep_alert():
    total = 24; b = silence(total)
    for i in range(int(total / 1.5)):
        at = i * 1.5; t = tl(1.2)
        pulse = (np.sin(2 * np.pi * 55 * t) + .5 * np.sin(2 * np.pi * 110 * t)) * expdec(len(t), .5) * adsr(len(t), .01, .1, .9, .2)
        place(b, stereo(pulse * .8), at)
        if i >= 4:
            place(b, stereo(bell(mtof(64 + (i % 2) * 3), 1.0, 1.41, 2.0, .4) * .25, .3 * (-1) ** i), at + .75)
    rise = noise_sweep(total, 200, 3000, .3) * np.linspace(0, 1, int(total * SR)) ** 2 * .25
    b += stereo(rise, 0)
    return reverb(b, 2.2, .3, 3500)
add('deep-alert', deep_alert(), dict(type='alarm', he='התראה עמוקה', en='Deep alert', moods=['dark', 'cinematic'], tags=['bass', 'tension', 'epic'],
    dhe='פולסים של בס עמוק עם מתח שעולה. דרמטי ורציני.', den='Deep bass pulses with rising tension. Dramatic and serious.', fade_out=.8))

# --- sound effects
def whoosh():
    x = noise_sweep(1.1, 300, 5000, .5) * np.sin(np.linspace(0, np.pi, int(1.1 * SR))) ** 2
    m = np.stack([x * np.linspace(1, .2, len(x)), x * np.linspace(.2, 1, len(x))], 1)
    return reverb(m, .8, .2)
add('whoosh', whoosh(), dict(type='sfx', he='ווש', en='Whoosh', moods=['cinematic'], tags=['transition', 'swoosh', 'fast', 'air'],
    dhe='משב אוויר מהיר שעובר משמאל לימין. מעולה למעברים בסרטונים.', den='A fast rush of air moving left to right. Great for video transitions.'))

def laser():
    t = tl(.35); f = 3000 * np.exp(-t / .08) + 200
    z = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * expdec(len(t), .12) * .4
    return reverb(stereo(lp(z, 7000)), .5, .2)
add('laser-zap', laser(), dict(type='sfx', he='לייזר', en='Laser zap', moods=['futuristic', 'funny'], tags=['gaming', 'sci-fi', 'zap', 'shot'],
    dhe='יריית לייזר בסגנון מדע בדיוני.', den='A sci-fi style laser shot.'))

def success():
    b = silence(1.5)
    for i, m in enumerate([72, 76, 79, 84]):
        place(b, stereo(marimba(mtof(m), 1.0) + .4 * np.pad(bell(mtof(m + 12), .6, 2, .8, .2), (0, int(.4 * SR))), (i - 1.5) * .3), i * .09)
    return reverb(b, 1.2, .25)
add('success', success(), dict(type='sfx', he='הצלחה', en='Success', moods=['happy'], tags=['win', 'achievement', 'positive', 'ui'],
    dhe='ארפג׳ו שמח שמסמן שמשהו הצליח.', den='A happy arpeggio that says something worked.'))

def error_buzz():
    b = silence(.7)
    for k in range(2):
        t = tl(.18); z = lp(np.sign(np.sin(2 * np.pi * 110 * t)) * .5 + .3 * np.sign(np.sin(2 * np.pi * 116 * t)), 2500) * adsr(len(t), .004, .02, .9, .03)
        place(b, stereo(z * .6), k * .24)
    return b
add('error-buzz', error_buzz(), dict(type='sfx', he='שגיאה', en='Error buzz', moods=['funny', 'minimal'], tags=['wrong', 'fail', 'buzzer', 'ui'],
    dhe='זמזום כפול של "טעות". מצחיק בסרטונים.', den='A double "wrong answer" buzz. Funny in videos.'))

def drum_roll():
    total = 3.2; b = silence(total); at = 0; i = 0
    while at < 2.4:
        place(b, stereo(snare(.12) * (.25 + .5 * at / 2.4), .2 * np.sin(i)), at); at += .045; i += 1
    place(b, stereo(kick(.6) * 1.0), 2.45)
    crash = hp(rng.standard_normal(int(.8 * SR)), 4000) * expdec(int(.8 * SR), .25) * .5
    place(b, stereo(crash, .2), 2.45)
    return reverb(b, 1.2, .2)
add('drum-roll', drum_roll(), dict(type='sfx', he='תיפוף והכרזה', en='Drum roll', moods=['funny', 'cinematic'], tags=['drums', 'reveal', 'announcement', 'ta-da'],
    dhe='תיפוף שמתגבר ונגמר במכה. מושלם לחשיפה או להכרזה.', den='A building drum roll ending with a hit. Perfect for a reveal or announcement.'))

def boing():
    t = tl(.7); f = 180 + 120 * np.sin(2 * np.pi * 9 * t) * np.exp(-t / .25) + 80 * np.exp(-t / .1)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), .25)
    return reverb(stereo(s), .4, .1)
add('boing', boing(), dict(type='sfx', he='בוינג', en='Boing', moods=['funny'], tags=['spring', 'cartoon', 'bounce', 'comedy'],
    dhe='קפיץ מצויר שקופץ. קלאסיקה של קומדיה.', den='A cartoon spring bouncing. A comedy classic.'))

# --- intro / outro
def logo_sting():
    total = 4.5; b = silence(total)
    b += stereo(noise_sweep(total, 400, 8000, .2) * np.clip(np.linspace(-.2, 1, int(total * SR)), 0, 1) ** 3 * .0, 0)
    rise = noise_sweep(1.2, 300, 6000, .4) * np.linspace(0, 1, int(1.2 * SR)) ** 2 * .5
    place(b, stereo(rise), 0)
    place(b, stereo(kick(1.2) * 1.0 + lp(rng.standard_normal(int(1.2 * SR)), 300) * expdec(int(1.2 * SR), .3) * .6), 1.2)
    place(b, pad([mtof(n) for n in (38, 45, 50, 57, 62, 66)], 3.2, .02, 2.0, bright=3000) * 1.2, 1.2)
    for i, m in enumerate([86, 90, 93, 98]):
        place(b, stereo(bell(mtof(m), 2.0, 3.0, .6, .6) * .3, (i - 1.5) * .4), 1.25 + i * .07)
    return reverb(b, 2.8, .35, 7000)
add('logo-sting', logo_sting(), dict(type='intro', he='פתיח לוגו', en='Logo sting', moods=['cinematic', 'luxury'], tags=['intro', 'impact', 'brand', 'reveal'],
    dhe='עלייה, מכה עמוקה ונצנוץ. פתיח קצר ללוגו או לסרטון.', den='A rise, a deep hit and a shimmer. A short opener for a logo or video.', fade_out=.8))

def podcast_outro():
    total = 12; b = silence(total)
    prog = [(57, 60, 64), (53, 57, 60), (55, 59, 62), (48, 52, 55, 60)]
    for i, ch in enumerate(prog):
        for k, n in enumerate(ch): place(b, stereo(epiano(mtof(n), 3.2) * .3, (k - 1) * .3), i * 2.6 + k * .02)
    for i, m in enumerate([76, 74, 72, 71, 72]):
        place(b, stereo(marimba(mtof(m), 1.5) * .35, .3), i * 2.0 + .5)
    return reverb(b, 2.2, .3, 5000)
add('podcast-outro', podcast_outro(), dict(type='outro', he='סיום פודקאסט', en='Podcast outro', moods=['calm', 'happy'], tags=['outro', 'podcast', 'piano', 'ending'],
    dhe='אקורדים חמים שנסגרים לאט. סיום נעים לפודקאסט או לסרטון.', den='Warm chords that slowly resolve. A pleasant ending for a podcast or video.', fade_out=2.5))

# ---------------------------------------------------------------- write
def peaks(x, n=96):
    m = np.max(np.abs(x), axis=1); size = max(1, len(m) // n)
    p = [float(np.max(m[i * size:(i + 1) * size])) for i in range(n)]
    top = max(p) or 1
    return [round(v / top, 3) for v in p]

def main():
    os.makedirs(OUT, exist_ok=True)
    cat = []
    order = list(S.keys())
    for slug in order:
        x, meta = S[slug]
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: tmp = f.name
        wavfile.write(tmp, SR, (x * 32767).astype(np.int16))
        mp3 = os.path.join(OUT, slug + '.mp3')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '160k',
                        '-metadata', 'title=' + meta['en'], '-metadata', 'artist=SnipRing', mp3], check=True)
        os.remove(tmp)
        cat.append(dict(slug=slug, title_he=meta['he'], title_en=meta['en'], description_he=meta['dhe'], description_en=meta['den'],
                        type=meta['type'], duration_ms=int(len(x) / SR * 1000), moods=meta['moods'], tags=meta['tags'],
                        origin='official', license='snipring-standard', audio_path='sounds/' + slug + '.mp3', peaks=peaks(x)))
        print(f"{slug:18s} {meta['type']:6s} {len(x)/SR:5.1f}s {os.path.getsize(mp3)//1024:4d}KB")
    with open(os.path.join(OUT, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(cat, f, ensure_ascii=False, separators=(',', ':'))
    print(len(cat), 'sounds')

if __name__ == '__main__':
    main()
