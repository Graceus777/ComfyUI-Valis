"""Cues and sound, checked without ComfyUI or a GPU: cue-sheet errors, sheet-music strengths, one beat grid when a
song comes with its sheet music, the key heard in a song, and every effect that should be heard.

    python tests/check_cues.py        (needs numpy, scipy, opencv-python; exit code 1 on any failure)
"""
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from valis_fx.lib.cues import Cues  # noqa: E402
from valis_fx.lib.abc import cues_from_abc  # noqa: E402
from valis_fx.lib.audio import analyse, key_of, SR  # noqa: E402
from valis_fx.lib.sound import SoundDesign, Key  # noqa: E402
from valis_fx.lib import effects as E  # noqa: E402

passed = failed = 0


def ok(cond, name, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + str(detail) if detail else ''}")


# a cue sheet that counts in beats without a tempo says what's missing (it was a TypeError)
for sheet in ("every 1 beat from 0 to 4 kick", "every 1 bar kick", "2:1 kick"):
    try:
        Cues.from_schedule(sheet)
        ok(False, f"cue sheet '{sheet}' without bpm is refused")
    except ValueError as e:
        ok("bpm line" in str(e), f"cue sheet '{sheet}' without bpm names the bpm line", e)
    except Exception as e:  # noqa: BLE001
        ok(False, f"cue sheet '{sheet}' without bpm is a ValueError", repr(e))
ok(len(Cues.from_schedule("bpm 120 4/4\nevery 1 beat from 1:1 to 2:1 kick").times("kick")) == 4, "cue sheet: a beat grid with a bpm line")

# sheet music: a note's strength is 0.6 to 1, not its MIDI number; a chord change is a hit of 1
ABC = """X:1
T:t
M:6/8
L:1/8
Q:1/4=100
K:Dm
V:1 name=vocal
D2F A2d | c2A G2E | D6 |
V:2 name=bass
D,6 | A,,6 | D,6 |
"""
c = cues_from_abc(ABC)
for lane in ("melody", "note", "bass", "lead"):
    v = c.vel(lane)
    ok(len(v) and v.min() >= .6 - 1e-9 and v.max() <= 1 + 1e-9, f"sheet music: '{lane}' strengths in 0.6..1", v)
ok(c.meta.get("meter_unit") == 8 and c.meter == 6, "sheet music: 6/8 is kept as 6/8", (c.meter, c.meta.get("meter_unit")))

# the score writes the meter as written
from valis_fx.lib.score_make import make_score  # noqa: E402
ok(make_score(c)["meter"] == "6/8", "score: a 6/8 sheet is written 6/8", make_score(c)["meter"])
ok(make_score(Cues.from_schedule("bpm 100 4/4\nevery 1 beat from 1:1 to 9:1 beat"), meter=7)["meter"] == "7/8", "score: 7/8 picked in the Score tab is written 7/8")
ok(make_score(Cues.from_schedule("bpm 100 4/4\nevery 1 beat from 1:1 to 9:1 beat"), meter=3)["meter"] == "3/4", "score: a waltz is 3/4")

# a song with its sheet music: the sheet's beat grid alone (joined with the heard one, every beat fired twice)
heard = Cues({"beat": [0.0, .6, 1.2], "kick": [0.0]}, duration=2)
both = heard.merge(Cues({"beat": [.01, .61, 1.21], "bar": [0.0]}, duration=2), replace=("beat",))
ok(list(both.times("beat")) == [.01, .61, 1.21] and list(both.times("kick")) == [0.0], "merge: the sheet's beat replaces the heard one", both.times("beat"))
ok(len(heard.merge(Cues({"beat": [.3]}, duration=2)).times("beat")) == 4, "merge: other lanes still join")
WALTZ = """X:1
T:w
M:3/4
L:1/8
Q:1/4=150
K:Gm
V:1 name=vocal
G2 B2 d2 | c2 A2 F2 | G6 | D2 F2 A2 |
V:2 name=bass
G,6 | F,6 | G,6 | D,6 |
"""
song = Cues({"beat": np.arange(0, 6, .4), "downbeat": np.arange(0, 6, 1.6), "kick": [0.0]}, duration=6, bpm=150, meter=4, meta={"key": "D minor"})
ws = song.with_sheet(cues_from_abc(WALTZ))
sc = make_score(ws)
ok(sc["meter"] == "3/4" and abs(sc["bar_seconds"] - 1.2) < 1e-6, "sheet over a heard song: a 3/4 sheet is scored in bars of three", (sc["meter"], sc["bar_seconds"]))
ok(list(ws.times("downbeat")) == list(ws.times("bar")) and ws.meta["key"] == "Gm", "sheet over a heard song: its bars are the downbeats, its key stands", ws.meta.get("key"))

# the key of a song: a minor progression's chroma, and nothing for noise
rng = np.random.default_rng(1)


def chord(midis, dur=.5):
    t = np.arange(int(SR * dur)) / SR
    return sum(np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * t) * np.exp(-t * 3) for m in midis)


# G minor: i iv V i with the melody on the scale (G A Bb C D Eb F#)
prog = [[55, 58, 62, 67], [60, 63, 67, 72], [62, 66, 69, 74], [55, 58, 62, 67], [55, 62, 70], [57, 60, 63], [58, 62, 67], [54, 62, 69]] * 3
y = np.concatenate([chord(m) for m in prog]).astype(np.float32)
y = y / np.abs(y).max()
k = key_of(y)
ok(k == "G minor", "key: a G minor progression is heard as G minor", k)
ok(key_of(rng.standard_normal(SR * 4).astype(np.float32)) is None, "key: noise has no key")
ok(analyse(y, SR).meta.get("key") == k, "key: the music analysis carries it to the sound design")
ok(Key.parse("Eb minor").tonic == 3 and Key.parse("Eb minor").mode == "min" and Key.parse("F# major").mode == "maj", "key: the sound design reads the names")

# every effect with a sound is heard where it fires: Projector on its lane, Tear (driven by a level) where it opens
t = np.arange(24 * 8) / 24
loud = np.clip(np.sin(2 * np.pi * t / 4), 0, 1).astype(np.float32)          # two swells in 8 s
cues = Cues({"beat": np.arange(0, 8, .5)}, None, {"loud": loud}, 8.0, 24, 120)
for fx, name in ((E.Projector(on="beat"), "Projector"), (E.Tear(on=None, by="loud"), "Tear")):
    sd = SoundDesign(cues, 8.0, 1)
    sd.for_stack([fx])
    ok(len(sd._placed) > 0, f"sound: {name} is heard", len(sd._placed))
ok("_rise_loud" not in cues.lanes, "sound: the cues the render uses are left as they were")

# a hit that lands a hair after a frame (every 1 beat at 144 BPM: hit 7 is 4e-16 s after frame 70) is taken by that frame
# with a tiny negative age; a power of it was NaN, which also made cv2.remap crawl (37 s for an 8x8 map). Both effects
# clamp it: the displacement is finite (remap is watched, so a regression fails fast instead of crawling) and so is the frame
import cv2  # noqa: E402
from valis_fx.lib.core import Ctx  # noqa: E402
_remap = cv2.remap


def _checked_remap(src, mx, my, *a, **k):
    if not (np.isfinite(mx).all() and np.isfinite(my).all()):
        raise AssertionError("non-finite remap coordinates")
    return _remap(src, mx, my, *a, **k)


beats = Cues.from_schedule("bpm 144 4/4\nevery 1 beat kick")
late = [(i, float(h) - i / 24) for h in beats.times("kick") for i in [round(float(h) * 24)] if 0 < float(h) - i / 24 <= 1e-6]
ok(bool(late), "a hit lands a hair after a frame at 144 BPM", late)
if late:
    sheet = np.random.default_rng(2).integers(0, 255, (24, 24, 3), dtype=np.uint8)
    cv2.remap = _checked_remap
    for fx, name in ((E.Shockwave(on="kick"), "Shockwave"), (E.TimeSlip(mode="burn", on="kick"), "TimeSlip burn")):
        ctx = Ctx(beats, (24, 24), 80, 24.0).add_clip("a", frames=[sheet] * 80).add_clip("b", frames=[sheet] * 80)
        i, good = late[0][0], True
        try:
            for j in (i - 1, i, i + 1):
                ctx.begin(j)
                out = fx(ctx, ctx.a.copy())
                good = good and bool(np.isfinite(out).all())
                ctx.end(np.clip(out, 0, 1).astype(np.float32))
        except AssertionError as e:
            good = False
            print("   ", e)
        ok(good, f"{name}: a hit a hair after the frame gives a finite picture")
    cv2.remap = _remap

# analysis cues land on the sound, not half a window (46 ms) before it: kicks, snares, hats, onsets and beats of synthetic
# hits at known times are within a frame (42 ms; they were 54 to 63 ms early, about 1.5 frames)
rg = np.random.default_rng(5)
seconds = 12.0
yh = np.zeros(int(SR * seconds), np.float32)
when = {"kick": np.arange(0.5, seconds - .5, .5), "snare": np.arange(0.75, seconds - .5, 1.0), "hat": np.arange(0.625, seconds - .5, .25)}
tq = np.arange(int(.25 * SR)) / SR
sound = {"kick": np.sin(2 * np.pi * np.cumsum(120 * np.exp(-tq * 18) + 45) / SR) * np.exp(-tq * 14),
         "snare": rg.standard_normal(len(tq)) * np.exp(-tq * 22) * .8,
         "hat": np.diff(rg.standard_normal(int(.06 * SR) + 1)) * np.exp(-tq[:int(.06 * SR)] * 90) * .5}
for lane, ts in when.items():
    for tt_ in ts:
        i0 = int(round(tt_ * SR)); yh[i0:i0 + len(sound[lane])] += sound[lane].astype(np.float32)[:len(yh) - i0]
ch = analyse(yh, SR)
alltrue = np.concatenate(list(when.values()))
for lane in ("kick", "snare", "hat", "onset", "beat"):
    got = np.asarray(ch.lanes[lane], float)
    truth = when.get(lane, alltrue)
    if lane in when:
        med = float(np.median([got[np.argmin(np.abs(got - t_))] - t_ for t_ in truth]))
    else:                                                       # onsets and beats: against the nearest real hit
        med = float(np.median([t_ - truth[np.argmin(np.abs(truth - t_))] for t_ in got]))
    ok(abs(med) < .025, f"audio: {lane} cues land on the sound (median {med * 1000:.0f} ms)", med)

# the classic Score engine (Valis FX) and Valis Loop Cues start a shot at its score bar's own time: bar 0 is the first
# downbeat (0.42 s in this song), not t = 0, and the song under the shot starts at the shot's start_frame
from valis_fx.lib.score_make import bar_start  # noqa: E402
down = np.arange(0.42, 20.0, 2.0)                                # 120 BPM, 4/4, the first downbeat 0.42 s in
offbeat = Cues({"beat": np.arange(0.42, 20.0, .5), "downbeat": down}, None, {}, 20.0, 24, 120)
sc = make_score(offbeat)
ok(sc["events"]["bar"][0] > .4 and bar_start(sc, 0) > .4, "score: bar 0 is the first downbeat", (sc["events"]["bar"][:2], bar_start(sc, 0)))
ok(all(abs(bar_start(sc, s["start_bar"]) - s["start_frame"] / sc["fps"]) < 1e-9 for s in sc["shots"]),
   "score: a shot starts where its bar does (Valis FX and Valis Loop Cues use that, not bar * bar_seconds)",
   [(s["start_bar"], bar_start(sc, s["start_bar"]), s["start_frame"] / sc["fps"]) for s in sc["shots"][:3]])
ok(abs(bar_start(sc, 3) - 3 * sc["bar_seconds"]) > .4, "score: counting bar_seconds from 0 is what was wrong")
ok(bar_start({"bar_seconds": 1.5}, 4) == 6.0, "score: a score without bar lines counts bar_seconds from 0")

# a loop's warm-up runs at negative times (Valis Loop Render's default is one whole loop): effects that seed from the
# time, or a hit's, must not hand numpy a negative seed ("expected non-negative integer")
from valis_fx.lib.loop import render_loop  # noqa: E402
from valis_fx.forge import draw_lightning  # noqa: E402
n_loop = 64                                                  # (a warm-up of 64 frames reaches -2.7 s: int(t * 6) + seed is negative)
lp = np.random.default_rng(3).random((n_loop, 24, 24, 3)).astype(np.float32)
lcues = Cues({"beat": np.arange(0.0, 8.0, 1 / 3), "kick": np.arange(0.0, 8.0, 1 / 3)}, None, {}, 8.0, 24, 180)
for stack, name in (([("Flicker", {"on": "kick", "style": "tube"})], "Flicker tube"), ([("Flicker", {"on": "kick", "style": "bulb"})], "Flicker bulb"),
                    ([("TimeSlip", {"on": "kick", "mode": "bleed"})], "TimeSlip bleed"), ([("Datamosh", {"on": "kick"})], "Datamosh")):
    try:
        out, _ = render_loop(lp, lcues, stack, fps=24.0, other=lp[::-1].copy(), seal=0)
        ok(out.shape == lp.shape and bool(np.isfinite(out).all()), f"loop: {name} runs through the default warm-up")
    except ValueError as e:
        ok(False, f"loop: {name} runs through the default warm-up", e)
try:
    draw_lightning(0.1, [(-0.5, (10, 10), [(20, 20)]), (-0.083, (10, 10), [(20, 20)])], None)
    ok(True, "loop: lightning from a negative event time")
except ValueError as e:
    ok(False, "loop: lightning from a negative event time", e)

# sheet music: a bar is as long as its meter and its Q: tempo say (the tempo counts the Q: note, not the meter's own):
# 6/8 at Q:1/4=100 is six eighths, 1.8 s, not six beats of .6 s (3.6 s), so the shots, two bars each, start in the right place
def _abc(m, unit, q, bars):
    return f"X:1\nT:t\nM:{m}\nL:{unit}\nQ:{q}\nK:C\n" + " | ".join(bars) + " |\n"
for name, text, want in (("6/8 at Q:1/4=100", _abc("6/8", "1/8", "1/4=100", ["C2E G2c"] * 12), 1.8),
                         ("6/8 at Q:3/8=60", _abc("6/8", "1/8", "3/8=60", ["C2E G2c"] * 12), 2.0),
                         ("4/4 at Q:1/4=120", _abc("4/4", "1/4", "1/4=120", ["C E G c"] * 12), 2.0),
                         ("4/4 at Q:1/8=240", _abc("4/4", "1/8", "1/8=240", ["C E G c C E G c"] * 12), 2.0),
                         ("3/4 at Q:1/4=90", _abc("3/4", "1/4", "1/4=90", ["C E G"] * 12), 2.0)):
    cb = cues_from_abc(text)
    sb = make_score(cb, shot_seconds=4)
    gaps = np.diff(sb["events"]["bar"])
    ok(abs(sb["bar_seconds"] - want) < 1e-6 and bool(np.allclose(gaps, want, atol=.01)), f"score: {name} has {want} s bars", (sb["bar_seconds"], gaps[:3]))
    st = [s_["start_frame"] / sb["fps"] for s_ in sb["shots"][1:4]]
    ok(all(abs(t_ - bar_start(sb, s_["start_bar"])) < 1e-9 for t_, s_ in zip(st, sb["shots"][1:4])) and len(st) == 3,
       f"score: {name}: a shot starts on its bar", st)
# a tempo or meter you pick still wins over the sheet's
cb = cues_from_abc(_abc("6/8", "1/8", "1/4=100", ["C2E G2c"] * 12))
ok(abs(make_score(cb, bpm=120)["bar_seconds"] - 3.0) < 1e-6, "score: a tempo picked in the Score tab sets the bar", make_score(cb, bpm=120)["bar_seconds"])

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
