"""Reading any music into cues (numpy/scipy only): band onsets, a beat grid with downbeats, and held curves.

Onsets: log-magnitude spectral flux per band, peak-picked against a running median (so a quiet verse still has
hits). Tempo: autocorrelation of the onset envelope with a gentle prior around 110 BPM. Beats: dynamic programming
(Ellis 2007) on the onset envelope. Downbeats: the beat phase whose beats carry the most low-band onset energy."""
import numpy as np
import scipy.signal as ss

SR = 22050
HOP = 256
NFFT = 2048
BANDS = {"kick": (30, 160), "snare": (160, 2600), "hat": (5000, 11000)}


def _mono(y, sr):
    y = np.asarray(y, np.float32)
    if y.ndim == 2:
        y = y.mean(1) if y.shape[1] <= 8 else y.mean(0)
    if sr != SR:
        g = np.gcd(int(sr), SR)
        y = ss.resample_poly(y, SR // g, int(sr) // g).astype(np.float32)
    return y / (np.abs(y).max() + 1e-9)


def _stft_mag(y):
    f, t, Z = ss.stft(y, SR, nperseg=NFFT, noverlap=NFFT - HOP, boundary=None, padded=True)
    return f, np.abs(Z).astype(np.float32)


def _flux(M):
    L = np.log1p(100 * M)
    d = np.diff(L, axis=1, prepend=L[:, :1])
    return np.maximum(d, 0).sum(0)


def _peaks(x, fr, min_gap=.07, k=1.4, win=1.2):
    """Adaptive peak picking: above (running median + k * running MAD) and a local max."""
    w = max(3, int(win * fr) | 1)
    med = ss.medfilt(x, w)
    mad = ss.medfilt(np.abs(x - med), w) + 1e-6
    thr = med + k * mad + .02 * x.max()
    pk, _ = ss.find_peaks(x, height=thr, distance=max(1, int(min_gap * fr)))
    return pk


def _tempo(env, fr, hint=None):
    e = env - env.mean()
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * fr / np.maximum(lags, 1)
    ok = (bpm > 50) & (bpm < 210)
    centre = hint or 110.0
    prior = np.exp(-.5 * (np.log2(bpm / centre) / .9) ** 2)
    sc = np.where(ok, ac * prior, -np.inf)
    lag = int(np.argmax(sc))
    # parabolic refinement
    if 1 <= lag < len(ac) - 1:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        lag = lag + .5 * (a - c) / (a - 2 * b + c + 1e-9)
    return 60 * fr / lag


def _beats(env, fr, bpm, tight=100.0):
    period = 60 * fr / bpm
    n = len(env)
    score = env.astype(np.float64).copy(); back = -np.ones(n, int)
    lo, hi = int(round(period * .5)), int(round(period * 2))
    for i in range(n):
        a, b = i - hi, i - lo
        if b <= 0:
            continue
        a = max(a, 0)
        prev = np.arange(a, b)
        pen = -tight * np.log((i - prev) / period) ** 2
        j = int(np.argmax(score[prev] + pen))
        score[i] = env[i] + score[prev[j]] + pen[j]; back[i] = prev[j]
    # end on the best of the last period
    i = int(np.argmax(score[max(0, n - int(period)):])) + max(0, n - int(period))
    out = []
    while i >= 0:
        out.append(i); i = back[i]
    return np.array(out[::-1])


def analyse(y, sr, fps=24.0, bpm_hint=None, meter=4):
    from .cues import Cues
    y = _mono(y, sr)
    dur = len(y) / SR
    f, M = _stft_mag(y)
    fr = SR / HOP
    lanes, vals, curves = {}, {}, {}
    env_all = _flux(M)
    env_all = env_all / (env_all.max() + 1e-9)
    for name, (lo, hi) in BANDS.items():
        band = M[(f >= lo) & (f < hi)]
        x = _flux(band); x = x / (x.max() + 1e-9)
        x = ss.lfilter([1], [1, -.3], x)
        pk = _peaks(x, fr, min_gap={"kick": .11, "snare": .09, "hat": .05}[name])
        lanes[name] = pk * HOP / SR; vals[name] = np.clip(x[pk] / (np.percentile(x[pk], 90) + 1e-9), 0, 1.5) if len(pk) else np.zeros(0)
    pk = _peaks(env_all, fr, .06)
    lanes["onset"] = pk * HOP / SR; vals["onset"] = env_all[pk]
    bpm = _tempo(ss.lfilter([1], [1, -.5], env_all), fr, bpm_hint)
    if bpm_hint and abs(np.log2(bpm / bpm_hint)) > .4:      # octave error vs the hint: fold toward it
        bpm *= 2 ** round(np.log2(bpm_hint / bpm))
    bi = _beats(env_all, fr, bpm)
    lanes["beat"] = bi * HOP / SR; vals["beat"] = env_all[bi]
    lowx = _flux(M[(f >= 30) & (f < 160)])
    ph = int(np.argmax([lowx[bi[k::meter]].sum() for k in range(meter)])) if len(bi) >= meter else 0
    lanes["downbeat"] = bi[ph::meter] * HOP / SR
    # curves at the video frame rate
    nfr = int(np.ceil(dur * fps)) + 1
    tt = np.arange(M.shape[1]) * HOP / SR
    tf = np.arange(nfr) / fps
    rms = np.sqrt((M ** 2).mean(0)); db = 20 * np.log10(rms + 1e-9)
    lo_, hi_ = np.percentile(db, 5), np.percentile(db, 99)
    curves["loud"] = np.interp(tf, tt, np.clip((db - lo_) / (hi_ - lo_ + 1e-9), 0, 1)).astype(np.float32)
    cen = (f[:, None] * M).sum(0) / (M.sum(0) + 1e-9)
    curves["bright"] = np.interp(tf, tt, np.clip((cen - 300) / 4000, 0, 1)).astype(np.float32)
    for name, (lo, hi) in {"low": (30, 160), "mid": (160, 2600), "high": (2600, 11000)}.items():
        e = M[(f >= lo) & (f < hi)].mean(0); e = ss.lfilter([.15], [1, -.85], e)
        curves[name] = np.interp(tf, tt, e / (np.percentile(e, 99) + 1e-9)).clip(0, 1.2).astype(np.float32)
    return Cues(lanes, vals, curves, dur, fps, float(bpm), meter, float(lanes["downbeat"][0]) if len(lanes["downbeat"]) else 0.0,
                {"source": "audio analysis", "bpm": round(float(bpm), 2)})
