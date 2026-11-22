"""Transcribe <workdir>/sound.wav and compare every voice line with what is heard in its window. Usage: check_voice.py <workdir>
Missing names and numerals are spelling, not errors (Lees for Lies, 10 for ten). A missing first word of the whole file is a known
transcription artifact: check that line alone. A swallowed "-ed" before "the" is real: reword the line."""
import json, os, re, sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
from faster_whisper import WhisperModel

wd = sys.argv[1]
x, sr = sf.read(os.path.join(wd, "sound.wav"), dtype="float32"); x = x.mean(axis=1)
m = WhisperModel("small.en", device="cpu", compute_type="int8")
segs, _ = m.transcribe(resample_poly(x, 16000, sr).astype(np.float32), language="en", word_timestamps=True, beam_size=5)
words = [w for s in segs for w in s.words]
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " "))
for i, ln in enumerate(json.load(open(os.path.join(wd, "vo_timeline.json")))):
    a, b = ln["t"] - 0.3, ln["t"] + ln["dur"] + 0.4
    heard = " ".join(w.word.strip() for w in words if a <= w.start < b)
    miss = [w for w in norm(ln["text"]).split() if w not in norm(heard).split()]
    print(f"{i:02d} {ln['t']:5.1f}s heard: {heard}" + (f"   <-- missing {miss}" if miss else ""))
