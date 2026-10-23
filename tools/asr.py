"""asr.py: what a take actually says, with word times. PocketSphinx runs offline (pip install pocketsphinx; its English
model ships inside the package), so it works where Whisper's model downloads are blocked. Rough, but enough to catch an
H3 take that dropped a line, invented one, or came back in another language (THE FOURTEENTH SHELL featurette, Oct 22:
one take in Japanese, one with an unscripted phrase in the middle).

    python tools/asr.py take.mp4 [...]      -> the words, then each word with its start time (s)
"""
import subprocess, sys
from pocketsphinx import Decoder


def words(path):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    d = Decoder(samprate=16000)
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    fr = 0.01
    return [(s.word, s.start_frame * fr, s.end_frame * fr) for s in d.seg() if not s.word.startswith(("<", "[")) and s.word != "<sil>"]


if __name__ == "__main__":
    for f in sys.argv[1:]:
        w = words(f)
        print(f.split("/")[-1], "|", " ".join(x[0] for x in w))
        print("   ", " ".join(f"{x[0]}@{x[1]:.2f}" for x in w))
