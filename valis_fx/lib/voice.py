"""The voice turns too. Numpy/scipy only (so it runs inside ComfyUI's own Python):

    pitch_shift(x, sr, ratio)            WSOLA time-stretch + resample: pitch moves, length stays
    formant_shift(x, sr, ratio)          the spectral envelope (cepstrally smoothed) warped along frequency
    monster(x, sr, ...)                  the vampire: pitch down, formants down (a bigger throat), a sub-octave
                                         shadow, a slow growl, a dark room
    turn(x, sr, at, ...)                 the take's voice until `at` (the turn word), the monster after it, with a
                                         40 ms crossfade, so the voice turns on the same frame as the face.
A ChatterboxVC conversion (installed in ComfyUI) can be fed in as `x` to change *who* is speaking first; Valis then
changes *what* is speaking."""
import numpy as np
import scipy.signal as ss


def wsola(x, rate, sr, win=.03, tol=.012):
    """Time-scale by `rate` (>1 faster/shorter) with waveform-similarity overlap-add."""
    N = int(win * sr) & ~1
    hop_out = N // 2
    hop_in = hop_out * rate
    T = int(tol * sr)
    w = np.hanning(N).astype(np.float32)
    n_out = int(len(x) / rate) + N
    y = np.zeros(n_out + N, np.float32); norm = np.zeros_like(y)
    xp = np.concatenate([np.zeros(T, np.float32), x.astype(np.float32), np.zeros(N + T + int(hop_in) + 1, np.float32)])
    pos_in, prev = 0.0, None
    k = 0
    while True:
        o = k * hop_out
        c = int(pos_in) + T
        if c + N + T >= len(xp) or o + N >= len(y):
            break
        if prev is None:
            best = c
        else:
            seg = xp[c - T:c + N + T]
            corr = np.correlate(seg, prev, "valid")
            best = c - T + int(np.argmax(corr))
        frame = xp[best:best + N]
        y[o:o + N] += frame * w; norm[o:o + N] += w
        prev = xp[best + hop_out:best + hop_out + N] if best + hop_out + N <= len(xp) else frame
        pos_in += hop_in; k += 1
    y = y / np.maximum(norm, 1e-3)
    return y[:int(len(x) / rate)]


def pitch_shift(x, sr, ratio):
    if abs(ratio - 1) < 1e-3:
        return x.astype(np.float32)
    # time-scale to len * ratio (same pitch), then resample back to len samples: every cycle now spans 1/ratio
    # as many samples, so the pitch moves by `ratio` and the length is kept
    st = wsola(x, 1.0 / ratio, sr)
    from fractions import Fraction
    fr = Fraction(ratio).limit_denominator(200)
    y = ss.resample_poly(st, fr.denominator, fr.numerator).astype(np.float32)
    out = np.zeros(len(x), np.float32); m = min(len(x), len(y)); out[:m] = y[:m]
    return out


def _env(mag, lifter=40):
    c = np.fft.irfft(np.log(mag + 1e-7), axis=0)
    c[lifter:-lifter] = 0
    return np.exp(np.fft.rfft(c, axis=0).real)


def formant_shift(x, sr, ratio, nfft=1024):
    if abs(ratio - 1) < 1e-3:
        return x.astype(np.float32)
    f, t, Z = ss.stft(x, sr, nperseg=nfft, noverlap=nfft * 3 // 4)
    mag, ph = np.abs(Z), np.angle(Z)
    E = _env(mag)
    src = mag / (E + 1e-7)
    k = np.arange(len(f))
    src_idx = np.clip(k / ratio, 0, len(f) - 1)            # E'(f) = E(f / ratio): formants move by `ratio`
    E2 = np.stack([np.interp(src_idx, k, E[:, j]) for j in range(E.shape[1])], 1)
    _, y = ss.istft(src * E2 * np.exp(1j * ph), sr, nperseg=nfft, noverlap=nfft * 3 // 4)
    out = np.zeros(len(x), np.float32); m = min(len(x), len(y)); out[:m] = y[:m]
    return out


def _bp(x, lo, hi, sr, o=2):
    return ss.sosfilt(ss.butter(o, [lo, hi], "band", fs=sr, output="sos"), x).astype(np.float32)


def monster(x, sr, pitch=.74, formant=.86, sub=.5, growl=.12, room=.3):
    x = x.astype(np.float32)
    main = formant_shift(pitch_shift(x, sr, pitch), sr, formant / pitch)
    low = formant_shift(pitch_shift(x, sr, pitch * .68), sr, formant * .9 / (pitch * .68))
    low = ss.sosfilt(ss.butter(4, 900, "low", fs=sr, output="sos"), low).astype(np.float32)
    t = np.arange(len(x)) / sr
    g = np.tanh(6 * _bp(main, 250, 2600, sr)) * (.55 + .45 * np.sin(2 * np.pi * 31 * t))
    v = main * .9 + low * sub + g.astype(np.float32) * growl
    v = v / (np.abs(v).max() + 1e-9) * (np.abs(x).max() + 1e-9)
    if room:
        r = np.random.default_rng(5); n = int(2.6 * sr); tt = np.arange(n) / sr
        ir = (r.standard_normal(n) * np.exp(-6.91 * tt / 2.6)).astype(np.float32)
        ir = ss.sosfilt(ss.butter(2, 4000, "low", fs=sr, output="sos"), ir).astype(np.float32); ir /= np.abs(ir).sum() / 6
        wet = ss.fftconvolve(v, ir)[:len(v)].astype(np.float32)
        v = v * (1 - room) + wet * room
    return v


def turn_time(score, default=0.0):
    """Where the voice turns when nothing says: the score's first impact, else `default`. (A score whose impact lane
    is empty has the lane and no hit in it.)"""
    hits = ((score or {}).get("events") or {}).get("impact")
    return float(hits[0]) if hits is not None and len(hits) else float(default)


def turn(x, sr, at, xfade=.04, **kw):
    """The original until `at` seconds, the monster after it."""
    x = x.astype(np.float32)
    m = monster(x, sr, **kw)
    t = np.arange(len(x)) / sr
    k = np.clip((t - at) / xfade, 0, 1).astype(np.float32)
    return x * np.sqrt(1 - k) + m * np.sqrt(k)
