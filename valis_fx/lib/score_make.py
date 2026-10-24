"""Make a Valis score from cues: any music, YuE2's sheet music, a soundless cue sheet, or several merged (Valis Cues).

A score is what the Score tab draws and edits and what Valis Score (load) reads back: tempo and meter, every lane's hits
in seconds (with their strength), held curves at 24 per second, sections, and shots cut on whole bars, so a clip laid
on a shot starts and ends on the music.

    from valis_fx.lib.score_make import make_score
    score = make_score(cues, title="my song")
"""
import numpy as np

FPS = 24.0
SHOT_SECONDS = 107 / 24          # one MiniMax H3 clip


def _r(xs, n=4):
    return [round(float(x), n) for x in xs]


def make_score(c, title="untitled", shot_seconds=SHOT_SECONDS, section_bars=8, source="", bpm=0.0, meter=0):
    """bpm / meter: your own (0 = as the source says or the analysis hears). Music analysis assumes 4/4; a waltz needs
    meter 3."""
    bpm_in, meter_in = float(bpm or 0), int(meter or 0)
    lanes = {k: np.asarray(v, np.float64) for k, v in c.lanes.items() if len(v)}
    last = max([float(v.max()) for v in lanes.values()] + [0.0])
    dur = float(c.duration or 0) or last + 1.0
    beats = lanes.get("beat", np.zeros(0))
    bpm = bpm_in or float(c.bpm or 0)
    if not bpm and len(beats) > 2:
        bpm = 60.0 / float(np.median(np.diff(beats)))
    bpm = bpm or 120.0
    meter = meter_in or int(c.meter or 4)
    regrid = (meter_in and meter_in != int(c.meter or 4)) or (bpm_in and c.bpm and abs(bpm_in - float(c.bpm)) > .5)
    beat_s = 60.0 / bpm
    bar_s = beat_s * meter
    # bar lines: the downbeats if the source has them (music analysis, sheet music), else a grid from the first beat
    db = lanes.get("downbeat", lanes.get("bar", np.zeros(0)))
    if regrid:                                           # your tempo or meter: a grid from the first downbeat (or beat)
        t0 = float(db[0]) if len(db) else float(beats[0]) if len(beats) else 0.0
        db = np.arange(t0 % bar_s, dur, bar_s)
    if len(db) >= 2:
        bars = list(db)
        while bars[-1] + bar_s < dur - 1e-6:            # carry the grid to the end
            bars.append(bars[-1] + bar_s)
        first = bars[0]
        while first - bar_s > -1e-6:                     # and back to the start
            first -= bar_s
            bars.insert(0, first)
    else:
        t0 = float(beats[0]) if len(beats) else 0.0
        bars = list(np.arange(t0 % bar_s, dur, bar_s))
    bars = np.asarray(bars)
    n_bars = len(bars)
    # how loud each bar is (the loud curve, or how many hits it has)
    loud = c.curves.get("loud")
    energy = np.zeros(n_bars)
    for i, t in enumerate(bars):
        t1 = bars[i + 1] if i + 1 < n_bars else dur
        if loud is not None and len(loud):
            a, b = int(t * FPS), max(int(t * FPS) + 1, int(t1 * FPS))
            energy[i] = float(np.mean(loud[a:b])) if a < len(loud) else 0.0
        else:
            energy[i] = sum(int(((v >= t) & (v < t1)).sum()) for v in lanes.values())
    # sections: phrases of `section_bars` bars, named by how loud they are against the song
    sections = []
    if n_bars:
        ph = [(i, min(n_bars, i + section_bars)) for i in range(0, n_bars, section_bars)]
        e = np.array([energy[a:b].mean() for a, b in ph])
        lo, hi = np.percentile(e, 30), np.percentile(e, 70)
        for k, (a, b) in enumerate(ph):
            start, end = float(bars[a]), float(bars[b]) if b < n_bars else dur
            if k == 0 and len(ph) > 2 and e[k] <= np.median(e):
                name = "intro"
            elif k == len(ph) - 1 and len(ph) > 2 and e[k] < e.max():
                name = "outro"
            elif e[k] >= hi:
                name = "drop" if e[k] == e.max() else "chorus"
            elif e[k] <= lo:
                name = "breakdown" if 0 < k < len(ph) - 1 else "verse"
            elif k + 1 < len(ph) and e[k + 1] > e[k] * 1.15:
                name = "build"
            else:
                name = "verse"
            sections.append({"name": name, "start": round(start, 4), "end": round(end, 4)})
        if sections:
            sections[0]["start"] = 0.0
    # shots: as many whole bars as fit in one clip (a bar longer than a clip is one shot)
    per = max(1, int(np.floor(shot_seconds / bar_s + 1e-6)))
    shots = []
    for k, i in enumerate(range(0, n_bars, per)):
        t = max(0.0, float(bars[i]))
        if t >= dur - .25:
            break
        frames = int(round(min(per * bar_s, dur - t) * FPS))
        shots.append({"id": f"s{k + 1:02d}", "name": "", "start_bar": i, "start_frame": int(round(t * FPS)), "frames": frames})
    events = {k: _r(v) for k, v in lanes.items()}
    events["bar"] = _r(bars)
    if "beat" not in events:
        events["beat"] = _r(np.arange(bars[0] if n_bars else 0.0, dur, beat_s))
    vels = {k: [round(float(x), 3) for x in c.vel(k)] for k in lanes}
    env = {k: [round(float(x), 3) for x in v] for k, v in c.curves.items()}
    if "mix" not in env and loud is not None:
        env["mix"] = env.get("loud")
    return {"valis_score": 1, "title": title, "made_by": "Valis Score (make)", "source": source or c.meta.get("source", ""),
            "bpm": round(bpm, 2), "meter": f"{meter}/4", "beat_seconds": round(beat_s, 5), "bar_seconds": round(bar_s, 5),
            "bars": n_bars, "duration_seconds": round(dur, 3), "fps": FPS, "key": c.meta.get("key", ""),
            "events": events, "velocities": vels, "envelopes": env, "sections": sections, "shots": shots}
