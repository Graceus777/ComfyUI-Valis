"""Valis sound design (v2, music-first). Every effect can bring a sound, synthesised (no samples) and placed on the
same cues as the picture, but the song leads:

  * in the song's key: tonal sounds (bells, swells, shimmer, the ghosts' hum) take their pitches from the ABC's K: line;
  * never the same twice: every hit is synthesised fresh with its own pitch, length, tone, pan and room;
  * under the music: each hit's loudness is measured (K-weighted, as LUFS) and set against the music's own loudness at
    that moment (LEVEL, in dB under it), and the whole effect bus is held at least 6 LU under the music;
  * sparse: a dense lane (every melody note) only sounds on its accents, at most every few beats, a few times a shot;
  * one room: a single reverb (the film's `space`) for every sound, so they sit in the same place.

    sd = SoundDesign(cues, duration, key="Bb", space="hall")
    sd.for_stack(effects)                  # each library effect brings its own sound, on its own lanes
    sd.hits("bell", on="bell")             # or place any design by name on any lane
    sd.bed("rain", gain=.5, by="storm")    # beds follow a curve (or are constant), far under the music
    sd.write("mix.wav", music=song, music_sr=sr)

A design is a function (rng, vel, key, beat, **kw) -> (stereo float32 (n, 2), at): `at` is the moment inside the sound
that lands on the cue (a whoosh's peak, a swell's end, a bell's strike)."""
import math
import re

import numpy as np
import scipy.signal as ss

SR = 48000


# ------------------------------------------------------------------------------------------------ primitives
def _n(sec):
    return max(1, int(sec * SR))


def noise(sec, rng, color="white"):
    x = rng.standard_normal(_n(sec)).astype(np.float32)
    if color == "pink":
        b, a = [0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400]
        x = ss.lfilter(b, a, x).astype(np.float32) * 4
    elif color == "brown":
        x = np.cumsum(x).astype(np.float32); x = ss.lfilter([1, -1], [1, -.995], x).astype(np.float32) * .05
    return x


def lp(x, fc, o=2):
    return ss.sosfilt(ss.butter(o, min(fc, SR * .45), "low", fs=SR, output="sos"), x, axis=0).astype(np.float32)


def hp(x, fc, o=2):
    return ss.sosfilt(ss.butter(o, max(fc, 10), "high", fs=SR, output="sos"), x, axis=0).astype(np.float32)


def bp(x, lo, hi, o=2):
    return ss.sosfilt(ss.butter(o, [max(lo, 10), min(hi, SR * .45)], "band", fs=SR, output="sos"), x, axis=0).astype(np.float32)


def peq(x, f, gain_db, q=.8):
    """A peaking EQ (RBJ biquad)."""
    A = 10 ** (gain_db / 40); w = 2 * math.pi * f / SR; al = math.sin(w) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w), 1 - al * A]; a = [1 + al / A, -2 * math.cos(w), 1 - al / A]
    return ss.lfilter(b, a, x, axis=0).astype(np.float32)


def sweep_filter(x, f0, f1, kind="low", q=.9, block=256, curve=2.0):
    """A filter whose cutoff glides from f0 to f1 (exponentially), block by block with carried state."""
    n = len(x)
    u = (np.arange(0, n, block) / max(n - 1, 1)) ** (1 / curve)
    return track_filter(x, f0 * (f1 / f0) ** u, kind, block=block)


def track_filter(x, fcs, kind="low", bw=1.0, block=256):
    """A 2nd-order filter following one centre/cutoff per block (fcs); 'band' is `bw` octaves wide."""
    out = np.zeros_like(x); zi = None
    for k, i in enumerate(range(0, len(x), block)):
        fc = float(np.clip(fcs[min(k, len(fcs) - 1)], 30, SR * .42))
        if kind == "band":
            lo, hi = fc / 2 ** (bw / 2), min(fc * 2 ** (bw / 2), SR * .45)
            b, a = ss.butter(1, [lo / (SR / 2), hi / (SR / 2)], "band")
        else:
            b, a = ss.butter(2, fc / (SR / 2), kind)
        if zi is None:
            zi = np.zeros(max(len(a), len(b)) - 1)
        out[i:i + block], zi = ss.lfilter(b, a, x[i:i + block], zi=zi)
    return out.astype(np.float32)


def env_exp(sec, tau, attack=.002):
    t = np.arange(_n(sec)) / SR
    return ((1 - np.exp(-t / max(attack, 1e-5))) * np.exp(-t / tau)).astype(np.float32)


def env_ar(sec, a, r):
    t = np.arange(_n(sec)) / SR
    return (np.minimum(1, t / max(a, 1e-5)) * np.clip((sec - t) / max(r, 1e-5), 0, 1)).astype(np.float32)


def env_peak(sec, peak, rise=2.5, fall=1.6):
    """Smooth rise to `peak` (fraction of sec) and a smooth fall to zero: a pass-by."""
    u = np.arange(_n(sec)) / _n(sec)
    up = np.sin(np.pi / 2 * np.clip(u / peak, 0, 1)) ** rise
    dn = np.cos(np.pi / 2 * np.clip((u - peak) / (1 - peak), 0, 1)) ** fall
    return np.where(u < peak, up, dn).astype(np.float32)


def fade(x, a=.004, r=.02):
    """Declick: short fade in and out."""
    n = len(x); na, nr = min(_n(a), n // 2), min(_n(r), n // 2)
    g = np.ones(n, np.float32); g[:na] = np.linspace(0, 1, na); g[n - nr:] = np.linspace(1, 0, nr)
    return x * (g[:, None] if x.ndim > 1 else g)


def sine_glide(f0, f1, sec, curve=2.0, phase=0.0):
    t = np.arange(_n(sec)) / SR
    u = (t / sec) ** (1 / curve)
    f = f0 * (f1 / f0) ** u
    return np.sin(phase + 2 * np.pi * np.cumsum(f) / SR).astype(np.float32)


def modal(freqs, decays, amps, sec, rng=None, beat_hz=0.0):
    """A struck resonant body: decaying sines (glass, metal, wood). beat_hz > 0 splits each mode into a slightly
    detuned pair, the slow warble of a real bell."""
    t = np.arange(_n(sec)) / SR
    out = np.zeros_like(t, dtype=np.float32)
    for f, d, a in zip(freqs, decays, amps):
        if f >= SR * .45:
            continue
        ph = rng.uniform(0, 2 * np.pi) if rng is not None else 0
        e = np.exp(-t / d)
        if beat_hz:
            db = beat_hz * (rng.uniform(.4, 1.6) if rng is not None else 1)
            m = .5 * (np.sin(2 * np.pi * (f - db / 2) * t + ph) + np.sin(2 * np.pi * (f + db / 2) * t + ph * 1.3))
        else:
            m = np.sin(2 * np.pi * f * t + ph)
        out += (a * m * e).astype(np.float32)
    return out


def stereo(x, pan=0.0, width=0.0, rng=None):
    l = math.cos((pan + 1) * math.pi / 4); r = math.sin((pan + 1) * math.pi / 4)
    out = np.stack([x * l, x * r], 1).astype(np.float32)
    if width > 0:
        d = int(width * .012 * SR)
        out[:, 1] = np.concatenate([np.zeros(d, np.float32), out[:-d, 1]]) if d else out[:, 1]
    return out


def pan_sweep(x, p0, p1):
    p = np.linspace(p0, p1, len(x))
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1).astype(np.float32)


def tail(x, sec):
    return np.concatenate([x, np.zeros((_n(sec),) + x.shape[1:], np.float32)])


# ------------------------------------------------------------------------------------------------ loudness (BS.1770)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def kweight(x):
    return ss.lfilter(*_K2, ss.lfilter(*_K1, x, axis=0), axis=0)


def short_term(x, win=.4, hop=.1):
    """K-weighted loudness (LUFS) of `win`-second windows every `hop` seconds: (times of window centres, LUFS)."""
    x = x if x.ndim > 1 else x[:, None]
    p = (kweight(x) ** 2).sum(1)
    w, h = _n(win), _n(hop)
    c = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, max(len(p) - w, 0) + 1, h)
    ms = (c[starts + w] - c[starts]) / w if len(p) >= w else np.array([p.mean()])
    t = (starts + w / 2) / SR if len(p) >= w else np.array([len(p) / 2 / SR])
    return t, -0.691 + 10 * np.log10(ms + 1e-12)


def lufs(x):
    """Integrated loudness, gated (absolute -70, relative -10)."""
    _, L = short_term(x, .4, .1)
    L = L[L > -70]
    if not len(L):
        return -70.0
    rel = 10 * np.log10(np.mean(10 ** (L / 10))) - 10
    L = L[L > rel]
    return float(10 * np.log10(np.mean(10 ** (L / 10)))) if len(L) else -70.0


def hit_loudness(x):
    """A sound's loudness where it is loudest (its 400 ms peak), so a hit can be set against the music."""
    _, L = short_term(x, .4, .05)
    return float(L.max())


# ------------------------------------------------------------------------------------------------ the song's key
_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_MODES = {"maj": [0, 2, 4, 5, 7, 9, 11], "ion": [0, 2, 4, 5, 7, 9, 11], "min": [0, 2, 3, 5, 7, 8, 10],
          "aeo": [0, 2, 3, 5, 7, 8, 10], "dor": [0, 2, 3, 5, 7, 9, 10], "phr": [0, 1, 3, 5, 7, 8, 10],
          "lyd": [0, 2, 4, 6, 7, 9, 11], "mix": [0, 2, 4, 5, 7, 9, 10], "loc": [0, 1, 3, 5, 6, 8, 10]}


class Key:
    """A tonic and a mode: hz(degree, octave) gives scale pitches (degree 0 = tonic, 4 = fifth; octave 4 = middle)."""

    def __init__(self, tonic=2, mode="min"):
        self.tonic, self.mode = int(tonic) % 12, mode
        self.scale = _MODES.get(mode, _MODES["min"])

    @classmethod
    def parse(cls, s):
        if isinstance(s, Key):
            return s
        m = re.match(r"\s*([A-Ga-g])([#b]?)\s*([A-Za-z]*)", s or "")
        if not m:
            return cls()
        pc = _NOTE[m.group(1).upper()] + {"#": 1, "b": -1}.get(m.group(2), 0)
        md = m.group(3).lower()
        mode = "min" if md in ("m", "mi", "min", "minor") else (md[:3] if md[:3] in _MODES else "maj")
        return cls(pc, mode)

    @classmethod
    def from_abc(cls, text):
        for line in (text or "").splitlines():
            if line.strip().startswith("K:"):
                return cls.parse(line.strip()[2:])
        return cls()

    def hz(self, degree=0, octave=4):
        o, d = divmod(int(degree), 7)
        midi = 12 * (octave + 1 + o) + self.tonic + self.scale[d]
        return 440.0 * 2 ** ((midi - 69) / 12)

    def chord(self, octave=4, degrees=(0, 2, 4)):
        return [self.hz(d, octave) for d in degrees]

    def low(self, lo=40.0, hi=80.0, degree=0):
        """The scale degree moved into [lo, hi) Hz (a sub, a hum)."""
        f = self.hz(degree, 1)
        while f < lo:
            f *= 2
        while f >= hi:
            f /= 2
        return f

    def __repr__(self):
        names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
        return f"Key({names[self.tonic]} {self.mode})"


# ------------------------------------------------------------------------------------------------ designs
def _u(rng, a, b):
    return float(rng.uniform(a, b))


def d_bell(rng, vel=1.0, key=None, beat=.5, f=None, dur=None, dark=0.0):
    """A cast bronze bell: hum, prime, minor-third tierce, quint, nominal and the upper partials, each mode a beating
    pair with its own decay, struck by a soft clapper. Tuned to the key's tonic (nominal) unless f is given; every
    strike moves the clapper a little (different partial balance) and detunes slightly."""
    key = key or Key()
    nom = f or key.hz(0, 3) * 2 ** (_u(rng, -8, 8) / 1200)
    while nom < 160:
        nom *= 2
    while nom > 420:
        nom /= 2
    dur = dur or _u(rng, 5.5, 8.0)
    ratios = [.5, 1.0, 1.2, 1.5, 2.0, 2.5, 2.66, 3.0, 4.0, 5.33]
    decays = [9.0, 5.5, 4.2, 2.6, 3.6, 1.6, 1.3, .9, .55, .35]
    amps = [.28, .5, .55, .3, 1.0, .35, .3, .22, .14, .08]       # hum and prime held back: a film bell, not a sub
    bright = .45 + .55 * vel
    fs = [nom / 2 * r * (1 + _u(rng, -.003, .003)) for r in ratios]
    am = [a * _u(rng, .7, 1.3) * (bright ** (k / 3)) for k, a in enumerate(amps)]
    ds = [d * dur / 7 * _u(rng, .85, 1.15) for d in decays]
    x = modal(fs, ds, am, dur, rng, beat_hz=1.1)
    clank = bp(noise(.03, rng), 1800, 5200) * env_exp(.03, .004, .0005) * .25 * vel
    x[:len(clank)] += clank
    if dark:
        x = lp(x, 900 + 3000 * (1 - dark))
    return fade(stereo(x, _u(rng, -.25, .25), .25), .001, .3), .0


def d_whoosh(rng, vel=1.0, key=None, beat=.5, dur=None, f=None, pan=None):
    """Air passing: pink noise through a resonance that bends down as it passes (doppler), swelling to a peak that
    lands on the cue, panned across. Length about a beat and a half; softer hits are darker."""
    dur = (dur or float(np.clip(beat * 1.5, .5, 1.4))) * _u(rng, .8, 1.25)
    peak = _u(rng, .55, .72)
    n = _n(dur); blk = 256; nb = (n + blk - 1) // blk
    u = np.arange(nb) / max(nb - 1, 1)
    fc = (f or _u(rng, 500, 1300)) * (.55 + .6 * vel)
    bend = _u(rng, .5, 1.1)
    fcs = fc * 2 ** (bend * -np.tanh((u - peak) / _u(rng, .12, .22)))
    src = noise(dur, rng, "pink")
    x = track_filter(src, fcs, "band", bw=_u(rng, 1.2, 2.0)) * 1.6 + bp(noise(dur, rng, "pink"), 90, 300) * .15
    x = x * env_peak(dur, peak, _u(rng, 2.0, 3.2), _u(rng, 1.2, 2.0))
    p0 = pan if pan is not None else rng.choice([-1, 1]) * _u(rng, .35, .8)
    out = pan_sweep(x, p0, -p0 * _u(rng, .4, 1.0))
    return fade(out), peak * dur


def d_swell(rng, vel=1.0, key=None, beat=.5, dur=None):
    """A reverse reverb into the hit: a soft chord in the key is struck into a long room, the room is played backwards,
    so it rises out of nothing and stops on the cue."""
    key = key or Key()
    dur = (dur or float(np.clip(beat * 2, 1.0, 2.4))) * _u(rng, .85, 1.15)
    voicing = [(0, 4), (0, 2, 4), (0, 4, 7), (2, 4, 7)][rng.integers(0, 4)]
    oct_ = int(rng.integers(3, 5))
    t = np.arange(_n(.6)) / SR
    src = np.zeros(len(t), np.float32)
    for fq in key.chord(oct_, voicing):
        src += (np.sin(2 * np.pi * fq * t + _u(rng, 0, 6)) * np.exp(-t / .25)).astype(np.float32)
    src += bp(noise(.6, rng, "pink"), 600, 4000) * env_exp(.6, .08) * .4
    ir = _ir(dur * 1.1, dur * .9, 5000 + 3000 * vel, int(rng.integers(1e6)))
    y = np.stack([ss.fftconvolve(src, ir[:, c])[:_n(dur)] for c in range(2)], 1).astype(np.float32)
    y = y[::-1].copy()
    y *= (np.linspace(0, 1, len(y)) ** 1.5)[:, None]
    return fade(y, .05, .012), dur


def d_boom(rng, vel=1.0, key=None, beat=.5, dur=None):
    """A deep, round hit (no grit): a sub on the key's tonic that sags a few cents, its octave, and a felt mallet."""
    key = key or Key()
    f = key.low(38, 62) * 2 ** (_u(rng, -10, 10) / 1200)
    dur = dur or _u(rng, 1.6, 2.6)
    sub = sine_glide(f * 1.04, f * _u(rng, .95, .98), dur, 1.3) * env_exp(dur, _u(rng, .45, .75), .006)
    oct2 = sine_glide(f * 2.06, f * 1.98, .7, 1.3) * env_exp(.7, _u(rng, .12, .22), .004) * .3
    mallet = lp(noise(.06, rng), _u(rng, 220, 420), 4) * env_exp(.06, .014, .001) * .6 * vel
    x = sub.copy(); x[:len(oct2)] += oct2; x[:len(mallet)] += mallet
    return fade(stereo(x, 0, .15), .001, .2), .006


def d_shimmer(rng, vel=1.0, key=None, beat=.5, dur=None):
    """Light: a high, quiet chord in the key that blooms and hangs (detuned pairs, a slow tremolo), voiced anew each time."""
    key = key or Key()
    dur = (dur or float(np.clip(beat * 3, 1.6, 3.5))) * _u(rng, .85, 1.2)
    t = np.arange(_n(dur)) / SR
    degs = list(rng.choice([0, 2, 4, 7, 9, 11], size=int(rng.integers(3, 5)), replace=False))
    x = np.zeros(len(t), np.float32)
    for d in degs:
        fq = key.hz(int(d), int(rng.integers(5, 7)))
        a = _u(rng, .5, 1.0) / len(degs)
        cents = _u(rng, 2, 6)
        tr = 1 + .25 * np.sin(2 * np.pi * _u(rng, .3, 1.2) * t + _u(rng, 0, 6))
        for s in (-1, 1):
            x += (a * np.sin(2 * np.pi * fq * 2 ** (s * cents / 1200) * t + _u(rng, 0, 6)) * tr).astype(np.float32)
    att = _u(rng, .15, .4)
    x *= env_ar(dur, att, dur * .6)
    x = lp(x, 7000)
    return fade(stereo(x, _u(rng, -.4, .4), .6)), .05


_VOWELS = {"oo": (320, 800, 2300), "oh": (520, 860, 2450), "ah": (720, 1100, 2550), "eh": (540, 1700, 2500), "mm": (260, 1000, 2200)}


def d_ghost(rng, vel=1.0, key=None, beat=.5, dur=None):
    """A ghost: a breathy, far-off sung vowel on a note of the key (formant-filtered breath and a soft voice), swelling
    and leaving. Vowel, note and length change every time."""
    key = key or Key()
    dur = (dur or float(np.clip(beat * 2.5, 1.2, 2.8))) * _u(rng, .85, 1.2)
    n = _n(dur); t = np.arange(n) / SR
    v = _VOWELS[list(_VOWELS)[rng.integers(0, len(_VOWELS))]]
    f0 = key.hz(int(rng.choice([0, 2, 4, 7])), 4) * (1 + .006 * np.sin(2 * np.pi * _u(rng, 4.5, 5.5) * t))
    ph = 2 * np.pi * np.cumsum(f0) / SR
    voice = sum((1 / k) * np.sin(k * ph) for k in range(1, 9)).astype(np.float32) * .35
    src = voice * _u(rng, .4, .8) + noise(dur, rng, "pink") * .5
    x = sum(g * bp(src, f / 1.12, f * 1.12) for f, g in zip(v, (1.0, .6, .25)))
    peak = _u(rng, .3, .5)
    x = x * env_peak(dur, peak, 2.0, 1.3)
    return fade(pan_sweep(x, _u(rng, -.6, .6), _u(rng, -.6, .6))), peak * dur


def d_slip(rng, vel=1.0, key=None, beat=.5, dur=None):
    """Another time cuts in: a film gate catching (a few soft clicks, slowing), the air of a reel flapping, and a
    faint tape-slowed note of the key."""
    key = key or Key()
    dur = dur or _u(rng, .5, .9)
    n = _n(dur); t = np.arange(n) / SR
    x = np.zeros(n, np.float32)
    rate = _u(rng, 14, 22); p = 0.0; k = 0
    while p < dur * .7 and k < int(rng.integers(3, 7)):
        i = int(p * SR); L = 160
        if i + L < n:
            x[i:i + L] += (bp(noise(L / SR, rng), 1500, 5000) * np.exp(-np.arange(L) / 30)).astype(np.float32) * .5 * .8 ** k
        p += 1 / rate * (1 + .18 * k) * _u(rng, .9, 1.1); k += 1
    flap = bp(noise(dur, rng, "pink"), 250, 1400) * (.5 + .5 * np.sin(2 * np.pi * _u(rng, 7, 12) * t)) * env_ar(dur, .02, dur * .7) * .35
    fq = key.hz(int(rng.choice([0, 4])), 4)
    tape = np.sin(2 * np.pi * np.cumsum(fq * (1 - _u(rng, .06, .12) * (t / dur) ** 2)) / SR).astype(np.float32)
    tape = lp(tape, 1800) * env_ar(dur, .03, dur * .6) * .12
    return fade(stereo(lp(x + flap + tape, 6000), _u(rng, -.3, .3), .4)), .0


def d_lens(rng, vel=1.0, key=None, beat=.5, dur=None):
    """Gravity: a low pressure on the tonic that sinks an octave, and air drawn past toward the centre."""
    key = key or Key()
    dur = dur or _u(rng, 1.4, 2.2)
    f = key.low(55, 110)
    sub = sine_glide(f, f / 2 * _u(rng, .95, 1.0), dur, 1.4) * env_ar(dur, .12, dur * .7)
    fifth = sine_glide(f * 1.5, f * .75, dur, 1.4) * env_ar(dur, .2, dur * .6) * .25
    air, _ = d_whoosh(rng, .5 * vel, key, beat, dur * .8, f=_u(rng, 900, 1600))
    out = stereo(sub + fifth, 0, .3)
    out[:len(air)] += air * .6
    return fade(out, .01, .2), .12


def d_frost(rng, vel=1.0, key=None, beat=.5, dur=None):
    """Ice: tiny crystalline grains on high notes of the key, thickening then thinning, over a breath of hiss."""
    key = key or Key()
    dur = dur or _u(rng, 1.6, 2.6)
    n = _n(dur); out = np.zeros((n, 2), np.float32)
    for i in range(int(_u(rng, 40, 90) * vel)):
        tt = rng.uniform(0, 1) ** .7 * dur * .85
        fq = key.hz(int(rng.integers(0, 7)), int(rng.integers(6, 8)))
        L = _u(rng, .03, .12)
        g = np.sin(2 * np.pi * fq * np.arange(_n(L)) / SR) * np.exp(-np.arange(_n(L)) / (_n(L) / 4))
        o = int(tt * SR)
        if o + len(g) < n:
            out[o:o + len(g)] += stereo(g.astype(np.float32) * _u(rng, .03, .12), _u(rng, -1, 1))
    out += stereo(hp(noise(dur, rng), 7000) * env_ar(dur, dur * .5, .5) * .02, 0, .8)
    return fade(out), .0


def d_crackle(rng, vel=1.0, key=None, beat=.5, dur=2.0, rate=None):
    """Fire: sparse crackles (filtered impulses) over a soft roar."""
    rate = rate or _u(rng, 25, 45)
    n = _n(dur); x = np.zeros(n, np.float32)
    for p in rng.integers(0, max(n - 2000, 1), rng.poisson(rate * dur)):
        L = int(rng.uniform(40, 400)); a = rng.uniform(.2, 1.0)
        x[p:p + L] += (rng.standard_normal(L) * np.exp(-np.arange(L) / (L / 4)) * a).astype(np.float32)
    x = bp(x, 900, 7000)
    roar = lp(noise(dur, rng, "brown"), 400) * .5
    return fade(stereo((x * .6 + roar) * env_ar(dur, .15, .6), 0, .5)), .0


def d_candle(rng, vel=1.0, key=None, beat=.5):
    pop = bp(noise(.05, rng), 1000, 5000) * env_exp(.05, .01) * .4
    flut = lp(noise(.8, rng, "pink"), _u(rng, 400, 800)) * env_ar(.8, .05, .5) * .3
    x = flut.copy(); x[:len(pop)] += pop
    return fade(stereo(x * vel, _u(rng, -.5, .5))), .0


def d_ignite(rng, vel=1.0, key=None, beat=.5):
    """Match strike, a soft flare and a second of crackle."""
    strike = bp(noise(.06, rng), 2000, 7000) * env_exp(.06, .015, .0005)
    w, _ = d_whoosh(rng, .7 * vel, key, beat, .6, f=_u(rng, 500, 900))
    c, _ = d_crackle(rng, .7 * vel, key, beat, 1.4)
    out = np.zeros((max(len(w), len(c) + 400) + 100, 2), np.float32)
    out[:len(strike)] += stereo(strike)
    out[:len(w)] += w; out[400:400 + len(c)] += c
    return fade(out), .0


def d_heartbeat(rng, vel=1.0, key=None, beat=.5):
    def thump(f, tau):
        return (sine_glide(f, f * .62, .3) * env_exp(.3, tau)).astype(np.float32)
    x = np.zeros(_n(.7), np.float32)
    a = thump(_u(rng, 56, 66), _u(rng, .06, .09)); x[:len(a)] += a
    b = thump(_u(rng, 50, 58), .06) * _u(rng, .55, .8); o = _n(_u(rng, .2, .26)); x[o:o + len(b)] += b[:len(x) - o]
    return fade(stereo(lp(x, 160) * vel)), .0


def d_thunder(rng, vel=1.0, key=None, beat=.5, dur=None, near=.6):
    """A far crack rolling into thunder: band-limited noise in rumbling bursts."""
    dur = dur or _u(rng, 4.5, 7.0)
    n = _n(dur); t = np.arange(n) / SR
    crack = bp(noise(.1, rng), 1200, 6000) * env_exp(.1, .02, .0005) * 1.2 * near
    rumble = lp(noise(dur, rng, "brown"), _u(rng, 160, 260)) * 3
    bursts = np.zeros(n, np.float32)
    for k in range(rng.integers(4, 9)):
        c = rng.uniform(.05, dur * .6); w = rng.uniform(.2, 1.0)
        bursts += np.exp(-((t - c) / w) ** 2).astype(np.float32) * rng.uniform(.4, 1)
    x = rumble * (bursts / (bursts.max() + 1e-6)) * np.exp(-t / (dur * .5)).astype(np.float32)
    x[:len(crack)] += crack
    return fade(stereo(x * vel, 0, .6)), .0


def d_shatter(rng, vel=1.0, key=None, beat=.5, fall=None):
    """Glass: a light crack, a cluster of pings on high notes of the key, then a few shards landing."""
    key = key or Key()
    fall = fall or _u(rng, 1.0, 1.8)
    out = np.zeros((_n(fall + 1.5), 2), np.float32)
    crack = bp(noise(.02, rng), 2500, 8000) * env_exp(.02, .004, .0002)
    out[:len(crack)] += stereo(crack)
    for k in range(int(_u(rng, 12, 20) * vel)):
        f = key.hz(int(rng.integers(0, 7)), int(rng.integers(6, 8))); d = _u(rng, .05, .3)
        p = modal([f, f * 2.76], [d, d * .5], [1, .3], d * 4, rng) * _u(rng, .08, .3)
        o = int(rng.exponential(.04) * SR)
        if o + len(p) < len(out):
            out[o:o + len(p)] += stereo(p, _u(rng, -.8, .8))
    for k in range(int(_u(rng, 8, 16) * vel)):
        tt = .25 + rng.uniform(0, 1) ** .7 * fall
        f = key.hz(int(rng.integers(0, 7)), int(rng.integers(5, 7))); d = _u(rng, .03, .15)
        p = modal([f, f * 2.3], [d, d * .5], [1, .4], d * 4, rng) * _u(rng, .04, .15)
        o = int(tt * SR)
        if o + len(p) < len(out):
            out[o:o + len(p)] += stereo(p, _u(rng, -.9, .9))
    return fade(out), .0


def d_tear(rng, vel=1.0, key=None, beat=.5, dur=None):
    """Something tearing open: filtered noise rising through a band, with an uneven (not buzzing) grain, a low breath under it."""
    dur = dur or _u(rng, 1.0, 1.6)
    n = _n(dur)
    grain = lp(np.abs(rng.standard_normal(n)).astype(np.float32), _u(rng, 25, 60)) * 2.5
    rip = sweep_filter(noise(dur, rng), _u(rng, 300, 600), _u(rng, 2500, 4000), "low") * grain * env_ar(dur, .05, .35)
    low = lp(noise(dur, rng, "brown"), 180) * env_ar(dur, .3, .5) * .6
    return fade(stereo(rip + low, _u(rng, -.3, .3), .5)), .1


def d_stutter(rng, vel=1.0, key=None, beat=.5, dur=None):
    """A codec catching: one grain of air repeated a few times, each fainter and a little lower."""
    g = lp(bp(noise(.04, rng), 300, 4000), 3500) * np.hanning(_n(.04)).astype(np.float32)
    reps = int(rng.integers(4, 9)); gap = _u(rng, .045, .07)
    out = np.zeros(_n(reps * gap + .1), np.float32)
    for k in range(reps):
        gg = ss.resample(g, int(len(g) * (1 + .06 * k))).astype(np.float32) * .78 ** k
        i = _n(k * gap); out[i:i + len(gg)] += gg[:len(out) - i]
    return fade(stereo(out, _u(rng, -.4, .4))), .0


def d_tick(rng, vel=1.0, key=None, beat=.5):
    L = _u(rng, .004, .01)
    x = bp(noise(L, rng), _u(rng, 1500, 3000), _u(rng, 4000, 7000)) * env_exp(L, L / 3, .0003)
    return fade(stereo(x, _u(rng, -.7, .7)), .0005, .002), .0


DESIGNS = {"bell": d_bell, "whoosh": d_whoosh, "swell": d_swell, "boom": d_boom, "shimmer": d_shimmer, "ghost": d_ghost,
           "slip": d_slip, "lens": d_lens, "frost": d_frost, "crackle": d_crackle, "candle": d_candle, "ignite": d_ignite,
           "heartbeat": d_heartbeat, "thunder": d_thunder, "shatter": d_shatter, "tear": d_tear, "stutter": d_stutter,
           "tick": d_tick}
ALIASES = {"impact": "boom", "echo": "ghost", "timeslip": "slip", "datamosh": "stutter", "glitch": "tick", "reverse_swell": "swell"}

# how loud each design sits, in dB under the music's own short-term loudness at that moment (story sounds like a
# bell or thunder are features; the effect sounds are underneath)
LEVEL = {"bell": -6, "thunder": -6, "heartbeat": -10, "boom": -12, "lens": -13, "whoosh": -14, "swell": -14,
         "tear": -15, "shatter": -14, "ghost": -15, "slip": -16, "shimmer": -16, "frost": -17, "crackle": -16,
         "ignite": -14, "candle": -18, "stutter": -18, "tick": -20}
# how much of each goes to the film's room
SEND = {"bell": .45, "thunder": .3, "heartbeat": .1, "boom": .45, "lens": .4, "whoosh": .2, "swell": .1, "tear": .3,
        "shatter": .4, "ghost": .6, "slip": .3, "shimmer": .5, "frost": .4, "crackle": .15, "ignite": .2, "candle": .15,
        "stutter": .2, "tick": .2}
# pacing: at least this many beats between two of the same sound, and at most this many in one shot
PACE = {"bell": (2, 4), "thunder": (8, 2), "heartbeat": (1, 99), "boom": (4, 2), "lens": (4, 2), "whoosh": (2, 3),
        "swell": (4, 2), "tear": (4, 2), "shatter": (8, 1), "ghost": (4, 2), "slip": (2, 3), "shimmer": (4, 2),
        "frost": (4, 2), "crackle": (2, 4), "ignite": (4, 2), "candle": (2, 4), "stutter": (2, 3), "tick": (1, 6)}
# a dense lane only sounds on its accents: hits at or above this quantile of the lane's velocities
ACCENT = {"heartbeat": 0.0, "thunder": 0.0, "bell": 0.0, "crackle": .3}

# which designs an effect brings with it: (design, lane attribute, options)
EFFECT_SOUNDS = {
    "Shatter": [("swell", "on", dict(gain=.8)), ("shatter", "on", {})],
    "Tear": [("tear", "on", {})],
    "TimeSlip": [("slip", "on", {})],
    "Lens": [("lens", "on", {})],
    "Datamosh": [("stutter", "on", {})],
    "Echo": [("ghost", "on", {})],
    "Frost": [("frost", "on", {})],
    "Glitch": [("tick", "on", {})],
    "DoubleExposure": [("whoosh", "on", dict(limit=2))],
    "Punch": [("boom", "on", dict(gain=.7))],
    "Shockwave": [("swell", "on", dict(gain=.8)), ("boom", "on", {})],
    "Rays": [("shimmer", "on", {})],
    "Split": [("slip", "on", dict(gain=.8))],
    "Eras": [("slip", "on", dict(gain=.7))],
    "Projector": [("slip", "burn", dict(gain=.6))],
}


# ------------------------------------------------------------------------------------------------ beds
def bed_wind(rng, dur):
    t = np.arange(_n(dur)) / SR
    x = noise(dur, rng, "pink")
    gust = (.5 + .5 * np.sin(2 * np.pi * .07 * t + 1) * np.sin(2 * np.pi * .19 * t)).astype(np.float32)
    x = lp(x, 300) * .4 + bp(x, 600, 2000) * gust * .25
    return stereo(x, 0, .9)


def bed_rain(rng, dur):
    x = hp(noise(dur, rng), 1500) * .18
    drops = np.zeros(_n(dur), np.float32)
    for p in rng.integers(0, len(drops) - 300, int(dur * 220)):
        drops[p:p + 120] += (rng.standard_normal(120) * np.exp(-np.arange(120) / 20)).astype(np.float32) * rng.uniform(.05, .3)
    return stereo(x + bp(drops, 2000, 9000), 0, .9)


def bed_sea(rng, dur):
    t = np.arange(_n(dur)) / SR
    swell = (.35 + .65 * (.5 + .5 * np.sin(2 * np.pi * t / 7.5)) ** 3).astype(np.float32)
    x = lp(noise(dur, rng, "pink"), 700) * swell * .6 + bp(noise(dur, rng), 1500, 5000) * swell ** 2 * .05
    return stereo(x, 0, .9)


def bed_fire(rng, dur):
    return d_crackle(rng, .8, None, .5, dur, rate=25)[0]


def bed_room(rng, dur):
    return stereo(lp(noise(dur, rng, "brown"), 120) * .5 + lp(noise(dur, rng, "pink"), 400) * .03, 0, .9)


def bed_neon(rng, dur):
    t = np.arange(_n(dur)) / SR
    hum = (np.sin(2 * np.pi * 60 * t) * .3 + np.sin(2 * np.pi * 120 * t) * .15 + np.sin(2 * np.pi * 180 * t) * .05).astype(np.float32)
    return stereo(hum * .25 + bp(noise(dur, rng), 3000, 6000) * .02, 0, .2)


BEDS = {"wind": bed_wind, "rain": bed_rain, "sea": bed_sea, "fire": bed_fire, "room": bed_room, "neon": bed_neon}
BED_LEVEL = -24          # a bed at gain .5 sits this many dB under the music's average loudness


# ------------------------------------------------------------------------------------------------ rooms
SPACES = {"room": dict(rt60=.9, dark=7000, pre=.008), "hall": dict(rt60=2.4, dark=6000, pre=.02),
          "cathedral": dict(rt60=4.5, dark=4500, pre=.035), "open": dict(rt60=1.3, dark=5000, pre=.01, slap=(.32, .25)),
          "water": dict(rt60=3.2, dark=1600, pre=.03), "dry": dict(rt60=.4, dark=8000, pre=.004)}


def _ir(sec, rt60, dark, seed, pre=.02, slap=None):
    r = np.random.default_rng(seed); n = _n(sec); t = np.arange(n) / SR
    ir = np.zeros((n, 2), np.float32)
    for c in range(2):
        nz = r.standard_normal(n).astype(np.float32) * np.exp(-6.91 * t / rt60).astype(np.float32)
        nz = lp(nz, dark)
        for k in range(6):                                   # early reflections
            i = _n(pre + r.uniform(.003, .045))
            if i < n:
                nz[i] += r.uniform(.3, .8) * r.choice([-1, 1]) * 3
        if slap:
            i = _n(slap[0] * r.uniform(.95, 1.05))
            if i < n:
                nz[i:] += nz[:n - i] * slap[1]
        ir[:, c] = np.concatenate([np.zeros(_n(pre), np.float32), nz])[:n]
    return ir / (np.sqrt((ir ** 2).sum(0)).max() + 1e-9)


def _limit(x, ceiling=.95, release=.25, block=.005):
    """A look-ahead peak limiter: the gain drops (one block early) to keep |x| under ceiling and recovers over `release`."""
    n = len(x)
    if n == 0:
        return x
    b = max(1, int(block * SR)); nb = (n + b - 1) // b
    pk = np.pad(np.abs(x).max(1), (0, nb * b - n)).reshape(nb, b).max(1)
    need = np.minimum(1.0, ceiling / (pk + 1e-9))
    need = np.minimum(need, np.concatenate([need[1:], need[-1:]]))
    g = np.empty(nb, np.float32); cur = 1.0; k = math.exp(-block / release)
    for i in range(nb):
        cur = need[i] if need[i] < cur else min(need[i], 1 - (1 - cur) * k)
        g[i] = cur
    gs = np.interp(np.arange(n), np.arange(nb) * b + b / 2, g).astype(np.float32)
    return np.clip(x * gs[:, None], -ceiling, ceiling)


def _smooth_gain(gr_db, hop, attack=.05, release=.5):
    out = np.empty_like(gr_db); cur = 0.0
    ka, kr = math.exp(-hop / attack), math.exp(-hop / release)
    for i, g in enumerate(gr_db):
        k = ka if g < cur else kr
        cur = g + (cur - g) * k
        out[i] = cur
    return out


# ------------------------------------------------------------------------------------------------ the designer
class SoundDesign:
    def __init__(self, cues, duration, seed=1, key=None, space="hall", beat=None, allow=None):
        self.cues, self.duration = cues, float(duration)
        self.rng = np.random.default_rng(seed)
        mk = (getattr(cues, "meta", None) or {}).get("key")
        self.key = Key.parse(key) if key else (Key.parse(mk) if mk else Key())
        bpm = getattr(cues, "bpm", None)
        self.beat = float(beat or (60.0 / bpm if bpm else .5))
        self.space = space if space in SPACES else "hall"
        self.allow = set(allow) if allow is not None else None
        self.events = []          # (t on the cue, sound, at, level dB under the music, send)
        self.beds = []            # (sound, level dB under the music's average, send)
        self._placed = []         # (design, time) already placed

    # ---- placing
    def place(self, x, t, level=-14.0, send=.3, at=0.0, pre=None):
        """One sound with its `at` moment on time t, `level` dB under the music there."""
        self.events.append((float(t), np.asarray(x, np.float32), float(pre if pre is not None else at), float(level), float(send)))
        return self

    def sound(self, design, t, gain=1.0, vel=1.0, **kw):
        design = ALIASES.get(design, design)
        if self.allow is not None and design not in self.allow:
            return self
        if any(d == design and abs(t - u) < .25 for d, u in self._placed):     # two effects asking for one sound
            return self
        self._placed.append((design, float(t)))
        x, at = DESIGNS[design](self.rng, float(vel), self.key, self.beat, **kw)
        lvl = LEVEL.get(design, -14) + 20 * math.log10(max(gain, 1e-4)) - 6 * (1 - float(np.clip(vel, 0, 1)))
        return self.place(x, t, lvl, SEND.get(design, .3), at)

    def hits(self, design, on, gain=1.0, pre=None, vel=True, every=1, min_gap=None, limit=None, accent=None, **kw):
        """Sound `design` on lane `on`, but only on its accents: the strongest hits first, at least PACE beats apart
        (or min_gap seconds), at most `limit` of them (PACE's per-shot count when called for one shot's window)."""
        design = ALIASES.get(design, design)
        if self.allow is not None and design not in self.allow:
            return self
        ts = np.asarray(self.cues.times(on), float)
        vs = np.asarray(self.cues.vel(on) if isinstance(on, str) else np.ones(len(ts)), float)
        keep = (ts >= -.05) & (ts < self.duration)
        ts, vs = ts[keep][::every], vs[keep][::every]
        if not len(ts):
            return self
        vmax = vs.max() if vs.max() > 0 else 1.0
        vn = vs / vmax
        gap_beats, cap = PACE.get(design, (2, 4))
        gap = min_gap if min_gap is not None else gap_beats * self.beat
        cap = limit if limit is not None else cap
        q = ACCENT.get(design, .5) if accent is None else accent
        thr = np.quantile(vn, q) if len(vn) > 3 and q > 0 else 0.0
        order = sorted(range(len(ts)), key=lambda i: (-(vn[i] + (.15 if i == 0 else 0)), ts[i]))
        chosen = []
        for i in order:
            if len(chosen) >= cap:
                break
            if vn[i] < thr and i != 0:
                continue
            if any(abs(ts[i] - ts[j]) < gap for j in chosen):
                continue
            chosen.append(i)
        for i in sorted(chosen):
            self.sound(design, ts[i], gain, vn[i] if vel else 1.0, **kw)
        return self

    def bed(self, name, gain=.5, by=None, fade_sec=1.0, fade=None):
        fade_sec = fade if fade is not None else fade_sec
        x = BEDS[name](self.rng, self.duration + 1)
        n = len(x)
        e = np.ones(n, np.float32)
        if by is not None:
            ts = np.arange(0, n / SR, 1 / 50)
            e = np.interp(np.arange(n) / SR, ts, [self.cues.level(by, t) for t in ts]).astype(np.float32)
        f = np.clip(np.arange(n) / (fade_sec * SR), 0, 1) * np.clip((self.duration - np.arange(n) / SR) / fade_sec, 0, 1)
        self.beds.append((x * (e * f)[:, None], BED_LEVEL + 20 * math.log10(max(gain, 1e-4) / .5), .2))
        return self

    def for_stack(self, effects, gain=1.0):
        for fx in effects:
            for design, attr, opt in EFFECT_SOUNDS.get(type(fx).__name__, []):
                lane = getattr(fx, attr, None)
                if lane and isinstance(lane, (str, list, tuple)):
                    o = dict(opt)
                    self.hits(design, lane, o.pop("gain", 1.0) * gain, limit=o.pop("limit", None), **o)
        return self

    # ---- rendering
    def render(self, music=None):
        """The effect bus (n, 2), each sound set against `music` (stereo at SR, already levelled) or, without music,
        against -20 LUFS."""
        n = _n(self.duration)
        dry = np.zeros((n + _n(8), 2), np.float32); wet = np.zeros_like(dry)
        if music is not None and len(music):
            tm, Lm = short_term(music, .4, .1)
            L_int = lufs(music)
            Lm = np.maximum(Lm, L_int - 10)
            ref = lambda t: float(Lm[(tm >= t - .2) & (tm <= t + .6)].max()) if ((tm >= t - .2) & (tm <= t + .6)).any() else L_int
            ref_avg = L_int
        else:
            ref = lambda t: -20.0
            ref_avg = -20.0
        for t, x, at, lvl, send in self.events:
            L = hit_loudness(x)
            g = 10 ** ((ref(t) + lvl - L) / 20)
            i = int(round((t - at) * SR)); x = x * g
            if i < 0:                                  # starts before the film: keep the end, faded in
                x = x[-i:].copy(); i = 0
                nf = min(len(x), _n(.08)); x[:nf] *= np.linspace(0, 1, nf)[:, None]
            j = min(len(dry), i + len(x))
            if j > i:
                dry[i:j] += x[:j - i] * (1 - send * .5); wet[i:j] += x[:j - i] * send
        for x, lvl, send in self.beds:
            g = 10 ** ((ref_avg + lvl - lufs(x)) / 20)
            m = min(len(dry), len(x))
            dry[:m] += x[:m] * g * (1 - send); wet[:m] += x[:m] * g * send
        sp = SPACES[self.space]
        ir = _ir(sp["rt60"] * 1.4, sp["rt60"], sp["dark"], 3, sp["pre"], sp.get("slap"))
        if np.abs(wet).max() > 0:
            wet = np.stack([ss.fftconvolve(wet[:, c], ir[:, c])[:len(wet)] for c in range(2)], 1).astype(np.float32)
        bus = dry + wet
        bus = hp(bus, 35)
        if self.space == "water":
            bus = lp(bus, 2200)
        if music is not None:
            bus = peq(bus, 2000, -3, .7)               # leave the voice its room
        return bus[:n]

    @property
    def bus(self):
        return self.render(None)

    def mix(self, music=None, music_sr=None, music_gain=.9, duck=0.0, master=.89, target_lufs=-16.0, under=6.0, **_):
        """The music levelled to -18 LUFS, the effects set against it and held at least `under` LU below it at every
        moment, then the whole film to `target_lufs` with a peak limiter. `duck` (0..1) dips the music under the
        effects (off by default: the song leads)."""
        n = _n(self.duration)
        m = None
        if music is not None:
            m = np.asarray(music, np.float32)
            if m.ndim == 1:
                m = np.stack([m, m], 1)
            if music_sr and music_sr != SR:
                g = math.gcd(int(music_sr), SR)
                m = ss.resample_poly(m, SR // g, int(music_sr) // g, axis=0).astype(np.float32)
            m = np.pad(m, ((0, max(0, n - len(m))), (0, 0)))[:n]
            Li = lufs(m)
            if Li > -70:
                m = m * 10 ** ((-18 - Li) / 20)
        fx = self.render(m)
        if m is not None and np.abs(fx).max() > 0:
            hop = .05
            tf, Lf = short_term(fx, .4, hop); tm, Lm = short_term(m, .4, hop)
            k = min(len(Lf), len(Lm))
            Lm_f = np.maximum(Lm[:k], lufs(m) - 12)
            gr = -np.maximum(0, Lf[:k] - (Lm_f - under))
            gr = _smooth_gain(gr, hop)
            gs = 10 ** (np.interp(np.arange(len(fx)) / SR, tf[:k], gr) / 20)
            fx = fx * gs[:, None].astype(np.float32)
            if duck:
                e = np.abs(fx).mean(1); e = ss.lfilter([.002], [1, -.998], e); e = e / (e.max() + 1e-9)
                m = m * (1 - duck * e)[:, None]
            out = m * music_gain + fx
            self.stems = (m * music_gain, fx)        # for checking the balance
        elif m is not None:                          # the effects make no sound here: the song alone
            out = m * music_gain + fx
        else:
            out = fx
        Lo = lufs(out)
        if Lo > -70:
            out = out * 10 ** ((target_lufs - Lo) / 20)
        return _limit(out.astype(np.float32), master)

    def write(self, path, **kw):
        import soundfile as sf
        out = self.mix(**kw)
        sf.write(path, out, SR)
        return path
