"""YuE2's sheet music → cues. YuE2 plans a song as ABC notation (a vocal line, an instrumental line, chord symbols,
section comments) before it renders the audio, so Valis can fire effects on the notes the song was written with,
not on a guess from the waveform. Handles what YuE2 writes: L/M/Q/K fields (also mid-tune, per voice), chord
symbols, notes with accidentals and octave marks, lengths like 8, 3/2, /2, ties, rests z/x, multi-bar rests Z4,
[chords], inline [M:..] and % section comments."""
import re

import numpy as np

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARPS = "FCGDAEB"
KEY_SHARPS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5,
              "Gb": -6, "Cb": -7}
REL_MINOR = {"Am": "C", "Em": "G", "Bm": "D", "F#m": "A", "C#m": "E", "G#m": "B", "D#m": "F#", "A#m": "C#", "Dm": "F",
             "Gm": "Bb", "Cm": "Eb", "Fm": "Ab", "Bbm": "Db", "Ebm": "Gb", "Abm": "Cb"}


def key_accidentals(k):
    k = k.strip().split()[0] if k.strip() else "C"
    k = k.replace("min", "m").replace("maj", "")
    major = REL_MINOR.get(k, k)
    n = KEY_SHARPS.get(major, 0)
    acc = {}
    if n > 0:
        for c in SHARPS[:n]:
            acc[c] = 1
    elif n < 0:
        for c in SHARPS[::-1][:-n]:
            acc[c] = -1
    return acc


def frac(s, default=1.0):
    if not s:
        return default
    if "/" in s:
        a, b = s.split("/", 1)
        a = float(a) if a else 1.0
        b = float(b) if b else 2.0
        return a / b
    return float(s)


TOKEN = re.compile(r'"(?P<chord>[^"]*)"|\[(?P<field>[A-Za-z]):(?P<fval>[^\]]*)\]|(?P<multi>\[[^\]]+\])(?P<mlen>\d*/?\d*)'
                   r'|(?P<acc>\^\^|\^|__|_|=)?(?P<note>[A-Ga-g])(?P<oct>[,\']*)(?P<len>\d*/?\d*)(?P<tie>-?)'
                   r'|(?P<rest>[zx])(?P<rlen>\d*/?\d*)|Z(?P<bars>\d*)|(?P<bar>\|+\]?|:\||\|:)|(?P<broken>[<>]+)')


def parse(abc):
    """→ dict(bpm, beat_unit, voices={name: [(t_whole, dur_whole, midi)]}, chords=[(t_whole, name)],
    bars=[t_whole], sections=[(t_whole, name)], meter=(num, den))."""
    head = {"L": "1/8", "M": "4/4", "Q": "1/4=120", "K": "C"}
    voices, chords, bars, sections = {}, [], [], []
    state = {}           # per voice: t (whole notes), L, M, last pitch (for ties), key accidentals
    cur = None
    started = False

    def vs(name):
        if name not in state:
            state[name] = {"t": 0.0, "L": frac(head["L"]), "M": head["M"], "tie": None, "acc": key_accidentals(head["K"])}
            voices[name] = []
        return state[name]

    def meter_len(m):
        if m in ("C", "C|"):
            return 1.0
        a, b = m.split("/")
        return float(a) / float(b)

    pending_section = None
    for raw in abc.splitlines():
        line = raw.rstrip()
        if not line:
            continue
        if line.startswith("%"):
            name = line[1:].strip()
            if name:
                pending_section = name
            continue
        m = re.match(r"^([A-Za-z]):\s*(.*)$", line)
        if m:
            f, val = m.group(1), m.group(2).strip()
            if f == "V":
                name = val.split()[0] if val else "1"
                if started or cur is not None:
                    cur = name; vs(name)
                else:
                    vs(name)             # a declaration in the header
                if started:
                    cur = name
                continue
            if f == "K":
                head["K"] = val; started = True
                for s in state.values():
                    s["acc"] = key_accidentals(val)
                continue
            if f in ("L", "M", "Q"):
                if cur is not None and started:
                    if f == "L":
                        state[cur]["L"] = frac(val)
                    elif f == "M":
                        state[cur]["M"] = val
                    else:
                        head["Q"] = val
                else:
                    head[f] = val
                    for s in state.values():
                        if f == "L":
                            s["L"] = frac(val)
                        if f == "M":
                            s["M"] = val
                continue
            if f in ("X", "T", "C", "w", "W", "N", "R", "S", "O", "A", "B", "D", "G", "H", "I", "P", "Z"):
                continue
        if not started:
            continue
        if cur is None:
            cur = next(iter(state)) if state else "1"
        s = vs(cur)
        if pending_section is not None:
            sections.append((s["t"], pending_section)); pending_section = None
        bar_acc = {}
        broken = None
        for mt in TOKEN.finditer(line):
            g = mt.groupdict()
            if g["chord"] is not None:
                chords.append((s["t"], g["chord"])); continue
            if g["field"]:
                if g["field"] == "M":
                    s["M"] = g["fval"].strip()
                elif g["field"] == "L":
                    s["L"] = frac(g["fval"].strip())
                elif g["field"] == "K":
                    s["acc"] = key_accidentals(g["fval"])
                continue
            if g["bar"]:
                bar_acc = {}
                if cur == next(iter(voices)):
                    bars.append(s["t"])
                continue
            if g["broken"]:
                broken = g["broken"]; continue
            if g["bars"] is not None and mt.group(0).startswith("Z"):
                n = int(g["bars"]) if g["bars"] else 1
                if cur == next(iter(voices)):
                    for k in range(n):
                        bars.append(s["t"] + k * meter_len(s["M"]))
                s["t"] += n * meter_len(s["M"]); s["tie"] = None; continue
            if g["rest"]:
                s["t"] += frac(g["rlen"]) * s["L"]; s["tie"] = None; continue
            if g["multi"]:
                notes = re.findall(r"(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)(\d*/?\d*)", g["multi"])
                d = frac(g["mlen"]) * (frac(notes[0][3]) if notes else 1) * s["L"]
                for acc, n, octs, _ in notes:
                    voices[cur].append((s["t"], d, _pitch(acc, n, octs, s["acc"], bar_acc)))
                s["t"] += d; s["tie"] = None; continue
            if g["note"]:
                d = frac(g["len"]) * s["L"]
                if broken:
                    d *= .5 if broken.startswith("<") else 1.5; broken = None
                p = _pitch(g["acc"], g["note"], g["oct"], s["acc"], bar_acc)
                if s["tie"] == p and voices[cur]:
                    t0, d0, p0 = voices[cur][-1]; voices[cur][-1] = (t0, d0 + d, p0)
                else:
                    voices[cur].append((s["t"], d, p))
                s["tie"] = p if g["tie"] else None
                s["t"] += d
    qb, qv = head["Q"].split("=") if "=" in head["Q"] else ("1/4", head["Q"])
    return {"bpm": float(re.findall(r"[\d.]+", qv)[0]), "beat_unit": frac(qb), "voices": voices, "chords": chords,
            "bars": sorted(set(round(b, 6) for b in bars)), "sections": sections,
            "meter": tuple(int(x) for x in head["M"].split("/")) if "/" in head["M"] else (4, 4), "key": head["K"]}


def _pitch(acc, n, octs, keyacc, bar_acc):
    base = NOTE[n.upper()] + (72 if n.islower() else 60)
    base += 12 * octs.count("'") - 12 * octs.count(",")
    if acc:
        a = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[acc]
        bar_acc[(n.upper(), octs)] = a
    else:
        a = bar_acc.get((n.upper(), octs), keyacc.get(n.upper(), 0))
    return base + a


def cues_from_abc(abc, y=None, sr=None, fps=24.0):
    from .cues import Cues
    P = parse(abc)
    sec_per_whole = 60.0 / P["bpm"] / P["beat_unit"]
    T = lambda w: w * sec_per_whole
    lanes, vals = {}, {}
    names = list(P["voices"])
    allnotes = []
    for i, name in enumerate(names):
        notes = P["voices"][name]
        lane = "melody" if "voc" in name.lower() or i == 0 and len(names) > 1 and "ins" not in name.lower() else ("ins" if "ins" in name.lower() else name.lower())
        tt = [T(n[0]) for n in notes]
        lanes[lane] = tt; vals[lane] = [n[2] for n in notes]          # MIDI pitch, made a strength below
        allnotes += [(T(n[0]), T(n[1]), n[2], lane) for n in notes]
    allnotes.sort()
    if not lanes.get("melody") and lanes.get("ins"):     # an instrumental: the tune is whatever plays it
        lanes["melody"], vals["melody"] = list(lanes["ins"]), list(vals["ins"])
    if allnotes:
        lanes["note"] = [n[0] for n in allnotes]; vals["note"] = [n[2] for n in allnotes]
        low = [n for n in allnotes if n[2] < 55]
        high = [n for n in allnotes if n[2] >= 67]
        lanes["bass"] = [n[0] for n in low]; vals["bass"] = [n[2] for n in low]
        lanes["lead"] = [n[0] for n in high]; vals["lead"] = [n[2] for n in high]
        lanes["long"] = [n[0] for n in allnotes if n[1] >= 60 / P["bpm"] * 2]          # held notes (2+ beats)
    ch = [(T(t), c) for t, c in P["chords"]]
    changes = [(t, c) for k, (t, c) in enumerate(ch) if k == 0 or c != ch[k - 1][1]]
    names_c = sorted(set(c for _, c in changes))
    lanes["chord"] = [t for t, _ in changes]; vals["chord"] = [names_c.index(c) for _, c in changes]
    lanes["bar"] = ([0.0] if not P["bars"] or P["bars"][0] > 1e-6 else []) + [T(b) for b in P["bars"]]       # bar starts (the downbeats)
    beat = 60.0 / P["bpm"]
    end = max([n[0] + n[1] for n in allnotes] + [T(b) for b in P["bars"]] + [0])
    lanes["beat"] = list(np.arange(0, end, beat))
    lanes["section"] = [T(t) for t, _ in P["sections"]]
    # a note's strength, not its pitch: an effect fired on 'melody' scaled by the MIDI number (60 and up) was pinned at
    # full. Higher notes of a lane hit a little harder (0.6 to 1.0), so the sound design still picks the top notes first.
    # (a chord change is a hit of 1: its value was the chord's index, so the first chord fired at nothing)
    for k in list(vals):
        p = np.asarray(vals[k], float)
        if k == "chord" or not len(p):
            vals[k] = [1.0] * len(p); continue
        lo, hi = p.min(), p.max()
        vals[k] = list(.6 + .4 * (p - lo) / (hi - lo)) if hi > lo else [1.0] * len(p)
    meta = {"source": "YuE2 ABC", "sections": [(round(T(t), 3), n) for t, n in P["sections"]], "chords": names_c,
            "key": P["key"], "bpm": P["bpm"], "meter_unit": P["meter"][1]}
    c = Cues(lanes, vals, None, end, fps, P["bpm"], P["meter"][0], 0.0, meta)
    if y is not None:
        off, scale = align(c, y, sr)
        # YuE2 plans the whole song but may render less of it: only what the audio holds
        keep = {k: (np.asarray(v) * scale + off) < len(y) / sr + .25 for k, v in c.lanes.items()}
        c = Cues({k: (np.asarray(v) * scale + off)[keep[k]] for k, v in c.lanes.items()},
                 {k: np.asarray(v)[keep[k]] if k in keep and len(v) == len(keep[k]) else v for k, v in c.vals.items()}, None, min(end * scale + off, len(y) / sr),
                 fps, P["bpm"] / scale, P["meter"][0], off, {**meta, "aligned": {"offset": round(off, 3), "scale": round(scale, 4)}})
    return c


def align(c, y, sr):
    """Find the offset and tempo scale that best line the sheet's note onsets up with the audio's onset envelope.
    YuE2 renders the plan from t = 0, but not always at the written tempo (a slow sheet can come back ~15% faster),
    so the scale is searched from 0.75 to 1.25, coarse then fine, with a gentle preference for the plan as written."""
    from .audio import _mono, _stft_mag, _flux, SR, HOP, frame_time
    x = _mono(y, sr)
    f, M = _stft_mag(x)
    env = _flux(M); env = env / (env.max() + 1e-9)
    env = np.convolve(env, np.ones(5) / 5, "same")
    fr = SR / HOP
    on = np.asarray(c.lanes.get("note", []))
    if len(on) < 4:
        return 0.0, 1.0

    def score(scale, off):
        idx = np.round((on * scale + off - float(frame_time(0))) * fr).astype(int)      # (the envelope's frame k is the sound at frame_time(k))
        idx = idx[(idx >= 0) & (idx < len(env))]
        if len(idx) < max(4, len(on) // 3):
            return -1.0
        return env[idx].mean() - .01 * abs(off) - .05 * abs(scale - 1)

    best = max(((score(sc, of), sc, of) for sc in np.arange(.75, 1.2501, .01) for of in np.arange(-.5, 3.0, .04)))
    _, sc0, of0 = best
    best = max(((score(sc, of), sc, of) for sc in np.arange(sc0 - .01, sc0 + .0101, .0025) for of in np.arange(of0 - .06, of0 + .061, .01)))
    return float(best[2]), float(best[1])
