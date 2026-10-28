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

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
