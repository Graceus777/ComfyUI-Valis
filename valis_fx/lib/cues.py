"""Cues: what tells an effect *when*. Every effect in the Valis library listens to named lanes of events (times in
seconds, each with a velocity) and, optionally, continuous curves (0..1 per frame). The same object comes from:

  * a Valis score (.json from the score engine: every kick, stroke and note it wrote),
  * any music (onset/beat analysis: low/mid/high band hits, beats and downbeats, loudness and brightness curves),
  * YuE2's sheet music (the ABC it plans before it sings: every note of every voice, aligned to its audio),
  * a voice (syllable onsets, see ValisScoreFromAudio),
  * a soundless cue sheet: plain text, seconds or bar:beat, single cues or `every` grids. No song needed.

Lanes from different sources merge, so a film can run a YuE2 song and a hand-written cue sheet at once.
"""
import json
import math
import re

import numpy as np


def _resample(v, src_fps, dst_fps):
    """A per-frame curve at src_fps as one at dst_fps (the same seconds), linearly."""
    v = np.asarray(v, np.float32)
    if abs(src_fps - dst_fps) < 1e-6 or len(v) < 2:
        return v
    n = max(2, int(round((len(v) - 1) * dst_fps / src_fps)) + 1)
    return np.interp(np.arange(n) / dst_fps, np.arange(len(v)) / src_fps, v).astype(np.float32)


class Cues:
    def __init__(self, lanes=None, vals=None, curves=None, duration=0.0, fps=24.0, bpm=None, meter=4, offset=0.0, meta=None):
        self.lanes = {k: np.asarray(sorted(v), np.float64) for k, v in (lanes or {}).items()}
        self.vals = {k: np.asarray(v, np.float64) for k, v in (vals or {}).items()}
        self.curves = {k: np.asarray(v, np.float32) for k, v in (curves or {}).items()}   # per frame at `fps`
        self.duration, self.fps, self.bpm, self.meter, self.offset = float(duration), float(fps), bpm, int(meter), float(offset)
        self.meta = meta or {}

    # ------------------------------------------------------------------ queries
    def times(self, lane):
        if lane is None:
            return np.zeros(0)
        if isinstance(lane, (list, tuple)):
            return np.sort(np.concatenate([self.times(l) for l in lane])) if lane else np.zeros(0)
        return self.lanes.get(lane, np.zeros(0))

    def vel(self, lane):
        t = self.times(lane)
        v = self.vals.get(lane) if isinstance(lane, str) else None
        return v if v is not None and len(v) == len(t) else np.ones(len(t))

    def env(self, lane, t, tau=.3, attack=.015, cap=1.5):
        """Sum of decaying pulses from every hit at or before t (a struck envelope)."""
        ts = self.times(lane)
        if len(ts) == 0:
            return 0.0
        j = np.searchsorted(ts, t, side="right")
        if j == 0:
            return 0.0
        lo = np.searchsorted(ts, t - tau * 8)
        dt = t - ts[lo:j]
        v = self.vel(lane)[lo:j] if isinstance(lane, str) else 1.0
        return float(min(cap, (v * (1 - np.exp(-dt / attack)) * np.exp(-dt / tau)).sum()))

    def since(self, lane, t):
        """Seconds since the last hit (inf if none yet), and its index."""
        ts = self.times(lane)
        j = np.searchsorted(ts, t, side="right") - 1
        return (t - ts[j], j) if j >= 0 else (math.inf, -1)

    def hits(self, lane, t0, t1):
        ts = self.times(lane)
        return ts[(ts >= t0) & (ts < t1)]

    def count(self, lane, t):
        return int(np.searchsorted(self.times(lane), t, side="right"))

    def curve(self, name, t):
        c = self.curves.get(name)
        if c is None or len(c) == 0:
            return 0.0
        x = t * self.fps
        i = int(np.clip(math.floor(x), 0, len(c) - 1)); j = min(i + 1, len(c) - 1)
        return float(c[i] + (c[j] - c[i]) * (x - math.floor(x)))

    def level(self, src, t, tau=.3):
        """One number for 'how much right now' from either a curve or a lane: lets any effect's amount be driven by
        a hit lane (struck) or a continuous curve (held), whichever the user names."""
        if isinstance(src, str) and src in self.curves:
            return self.curve(src, t)
        return self.env(src, t, tau)

    def at_bar(self, bar, beat=1.0):
        if not self.bpm:
            raise ValueError("cue sheet: bar:beat times need a bpm line first, e.g. 'bpm 108 4/4'")
        return self.offset + ((bar - 1) * self.meter + (beat - 1)) * 60.0 / self.bpm

    def key(self, t):
        """What a hit at time t is called when an effect seeds its random pattern from it (a crack, a burn hole): the
        time itself. Looping cues answer with the hit's place in the loop, so every pass draws the same pattern."""
        return t

    # ------------------------------------------------------------------ combining
    def merge(self, other, prefix="", replace=()):
        """Both cues' lanes in one. A lane in both is joined, hit by hit; one named in `replace` is other's alone (YuE2's
        sheet music has the exact beat grid: joined with the one heard from its audio, every beat fired twice)."""
        out = Cues(dict(self.lanes), dict(self.vals), dict(self.curves), max(self.duration, other.duration), self.fps,
                   self.bpm or other.bpm, self.meter if self.bpm else other.meter, self.offset if self.bpm else other.offset,
                   {**other.meta, **self.meta})
        for k, v in other.lanes.items():
            kk = prefix + k
            if kk in replace:
                out.lanes.pop(kk, None); out.vals.pop(kk, None)
            if kk in out.lanes:
                vv = np.concatenate([out.vel(kk), other.vel(k)]); tt = np.concatenate([out.lanes[kk], v]); o = np.argsort(tt)
                out.lanes[kk], out.vals[kk] = tt[o], vv[o]
            else:
                out.lanes[kk] = v
                if k in other.vals:
                    out.vals[kk] = other.vals[k]
        for k, v in other.curves.items():          # (a curve is a value per frame: at the other cues' rate, not these)
            out.curves[prefix + k] = _resample(v, other.fps, self.fps)
        return out

    def with_sheet(self, ab, heard=True):
        """These cues with YuE2's sheet music (`ab`, aligned to the same audio) laid over them. The sheet is exact where
        the analysis guesses: its beat grid replaces the heard one (joined, every beat fired twice), its bar starts are
        the downbeats, and its tempo, meter and key stand (the analysis assumes 4/4: a 3/4 waltz came out in bars of four).
        heard: these cues came from the song's audio."""
        out = self.merge(ab, replace=("beat",) if heard else ())
        out.meta.update({k: v for k, v in ab.meta.items() if k in ("key", "meter_unit", "sections", "chords")})
        out.bpm, out.meter = ab.bpm or out.bpm, ab.meter or out.meter
        if heard and len(ab.times("bar")):
            out.lanes["downbeat"] = np.asarray(ab.times("bar"), np.float64); out.vals["downbeat"] = np.ones(len(out.lanes["downbeat"]))
        return out

    def shifted(self, dt):
        """Every cue moved by dt seconds (held curves too, so a shot starting at t0 can use .shifted(-t0))."""
        n = int(round(dt * self.fps))
        curves = {}
        for k, c in self.curves.items():
            if n < 0:
                curves[k] = c[min(-n, len(c)):] if -n < len(c) else c[-1:]
            elif n > 0:
                curves[k] = np.concatenate([np.full(n, c[0] if len(c) else 0, np.float32), c])
            else:
                curves[k] = c
        return Cues({k: v + dt for k, v in self.lanes.items()}, self.vals, curves, self.duration + dt, self.fps,
                    self.bpm, self.meter, self.offset + dt, self.meta)

    def window(self, t0, t1):
        """Only the hits in [t0, t1) (curves kept): one shot's effects should sound only during that shot."""
        lanes, vals = {}, {}
        for k, v in self.lanes.items():
            m = (v >= t0) & (v < t1)
            lanes[k] = v[m]; vals[k] = self.vel(k)[m]
        return Cues(lanes, vals, self.curves, self.duration, self.fps, self.bpm, self.meter, self.offset, self.meta)

    def to_json(self):
        return {"lanes": {k: [round(float(x), 4) for x in v] for k, v in self.lanes.items()},
                "vals": {k: [round(float(x), 3) for x in v] for k, v in self.vals.items()},
                "curves": {k: [round(float(x), 4) for x in v] for k, v in self.curves.items()},
                "duration": self.duration, "fps": self.fps, "bpm": self.bpm, "meter": self.meter, "offset": self.offset, "meta": self.meta}

    @classmethod
    def from_json(cls, d):
        if "events" in d:                         # a Valis score (score engine output)
            return cls.from_score(d)
        return cls(d.get("lanes"), d.get("vals"), d.get("curves"), d.get("duration", 0), d.get("fps", 24), d.get("bpm"),
                   d.get("meter", 4), d.get("offset", 0), d.get("meta"))

    # ------------------------------------------------------------------ sources
    @classmethod
    def from_score(cls, s):
        if isinstance(s, str):
            s = json.load(open(s))
        meter = int(str(s.get("meter", "4/4")).split("/")[0])
        curves = {k: v for k, v in (s.get("envelopes") or {}).items()}
        lanes = {k: v for k, v in s["events"].items() if isinstance(v, list) and (not v or isinstance(v[0], (int, float)))}
        # each hit's strength (make_score writes them beside the events, one per hit); a lane without them, or with a
        # different count (a hand-edited score), has hits of 1. The hits are sorted by time, and carry their strength along.
        vals = {}
        for k, v in list(lanes.items()):
            w = (s.get("velocities") or {}).get(k)
            if isinstance(w, list) and len(w) == len(v) and all(isinstance(x, (int, float)) for x in w):
                pairs = sorted(zip(v, w), key=lambda p: p[0])
                lanes[k], vals[k] = [p[0] for p in pairs], [p[1] for p in pairs]
        return cls(lanes, vals, curves, s.get("duration_seconds", 0), s.get("fps", 24), s.get("bpm"), meter, 0.0,
                   {"title": s.get("title"), "source": "valis score", **({"key": s["key"]} if s.get("key") else {})})

    @classmethod
    def from_schedule(cls, text, duration=None, fps=24.0):
        """A soundless cue sheet. One cue per line; '#' starts a comment.

            bpm 96 3/4                      # optional: lets you write bar:beat, and 'beat'/'bar' grid steps
            0.0     ignite                  # seconds, lane name
            2:1     shatter 1.0             # bar 2 beat 1, velocity 1.0
            4.25s   shockwave 0.6
            every 1 beat  from 3:1 to 7:1  pulse 0.5
            every 1/2 beat from 5:1 to 6:1 flicker
            every 0.25s from 10 to 12      strobe
            ramp opacity 2.0 0.0 6.0 1.0    # a held curve: name t0 v0 t1 v1 (linear); several ramps chain

        Lanes are free names: effects are told which lane(s) to listen to."""
        c = cls(fps=fps)
        lanes, vals, ramps = {}, {}, {}

        def tparse(tok):
            tok = tok.strip()
            if ":" in tok:
                b, bt = tok.split(":")
                return c.at_bar(float(b), float(bt))
            return float(tok.rstrip("s"))

        def step_parse(num, unit):
            if "/" in num:
                a, b = num.split("/", 1)
                n = float(a) / float(b)
            else:
                n = float(num)
            beat = 60.0 / c.bpm if c.bpm else None
            if unit in ("beat", "beats", "bar", "bars") and not beat:
                raise ValueError(f"cue sheet: 'every {num} {unit}' needs a bpm line first, e.g. 'bpm 108 4/4'")
            if unit in ("beat", "beats"):
                return n * beat
            if unit in ("bar", "bars"):
                return n * beat * c.meter
            return float(n)

        for raw in text.splitlines():
            line = raw.split("#")[0].strip()
            if not line:
                continue
            tok = line.split()
            word = tok[0].lower()                          # the words of the sheet are not case-sensitive ("BPM 120"); lane names are
            try:
                if word == "bpm":
                    c.bpm = float(tok[1])
                    if len(tok) > 2:
                        c.meter = int(tok[2].split("/")[0])
                    continue
                if word == "offset":
                    c.offset = float(tok[1]); continue
                if word == "ramp":
                    name, t0, v0, t1, v1 = tok[1], tparse(tok[2]), float(tok[3]), tparse(tok[4]), float(tok[5])
                    ramps.setdefault(name, []).append((t0, v0, t1, v1)); continue
                if word == "every":
                    m = re.match(r"every\s+([\d./]+)\s*(s|beat|beats|bar|bars)?\s+(?:from\s+(\S+)\s+)?(?:to\s+(\S+)\s+)?(\S+)(?:\s+([\d.]+))?$", line, re.I)
                    if not m:
                        raise ValueError(f"cue sheet: can't read '{raw}'")
                    step = step_parse(m.group(1), (m.group(2) or "s").lower())
                    if not step > 0:
                        raise ValueError(f"cue sheet: '{raw.strip()}' steps by nothing")
                    t0 = tparse(m.group(3)) if m.group(3) else 0.0
                    t1 = tparse(m.group(4)) if m.group(4) else (duration or t0 + 8)
                    if m.group(4) and t1 < t0 - 1e-6:
                        raise ValueError(f"cue sheet: '{raw.strip()}' ends before it starts")
                    v = float(m.group(6)) if m.group(6) else 1.0
                    tt = np.arange(t0, t1 - 1e-6, step)       # (a range of no length, or a shot shorter than its start, is no hits)
                    lanes.setdefault(m.group(5), []).extend(tt.tolist()); vals.setdefault(m.group(5), []).extend([v] * len(tt))
                    continue
                t = tparse(tok[0]); lane = tok[1]
                v = float(tok[2]) if len(tok) > 2 else 1.0
            except (ValueError, IndexError) as e:
                if str(e).startswith("cue sheet:"):
                    raise
                raise ValueError(f"cue sheet: can't read '{raw.strip()}': a line is a time (seconds, or bar:beat) and a lane name, "
                                 "or bpm, offset, ramp or every") from None
            lanes.setdefault(lane, []).append(t); vals.setdefault(lane, []).append(v)
        end = duration or max([max(v) for v in lanes.values() if len(v)] + [r[2] for rs in ramps.values() for r in rs] + [1.0]) + 1.0
        n = int(math.ceil(end * fps)) + 1
        curves = {}
        for name, rs in ramps.items():
            cv = np.zeros(n, np.float32); tt = np.arange(n) / fps
            for (t0, v0, t1, v1) in sorted(rs):
                k = (tt >= t0) & (tt <= t1)
                cv[k] = v0 + (v1 - v0) * (tt[k] - t0) / max(t1 - t0, 1e-6)
                cv[tt > t1] = v1
            curves[name] = cv
        for k in list(lanes):
            o = np.argsort(lanes[k]); lanes[k] = np.asarray(lanes[k])[o]; vals[k] = np.asarray(vals[k])[o]
        out = cls(lanes, vals, curves, end, fps, c.bpm, c.meter, c.offset, {"source": "cue sheet"})
        return out

    @classmethod
    def from_audio(cls, y, sr, fps=24.0, bpm_hint=None):
        """Any music: band onsets (low = 'kick', mid = 'snare', high = 'hat', all = 'onset'), a beat grid ('beat',
        'downbeat' guessed from low-band weight), and curves ('loud', 'bright', 'low', 'mid', 'high')."""
        from .audio import analyse
        return analyse(y, sr, fps, bpm_hint)

    @classmethod
    def from_abc(cls, abc, y=None, sr=None, fps=24.0):
        """YuE2 sheet music: every note of every voice as lanes ('melody', 'chord', 'bass', 'note', 'bar', 'beat'),
        pitch as velocity-ish values. If the audio is given, the sheet is aligned to it (tempo and first downbeat)."""
        from .abc import cues_from_abc
        return cues_from_abc(abc, y, sr, fps)
