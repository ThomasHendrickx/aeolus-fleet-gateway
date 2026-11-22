"""Render each line of <workdir>/vo.json with Kokoro, fitted to its window. Writes <workdir>/vo/NN.wav and vo_timeline.json.
Usage: make_vo.py <workdir>. A line marked OVER runs past its window even at the fastest speed: shorten the text or widen the window."""
import json, os, re, sys, urllib.request, warnings
warnings.filterwarnings("ignore")
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

wd = sys.argv[1]
CACHE = os.path.expanduser("~/.cache/scenario-video")
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
os.makedirs(CACHE, exist_ok=True)
for f in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
    if not os.path.exists(os.path.join(CACHE, f)):
        print("downloading", f); urllib.request.urlretrieve(BASE + f, os.path.join(CACHE, f + ".part"))
        os.replace(os.path.join(CACHE, f + ".part"), os.path.join(CACHE, f))
BASE_SPEED, MAX_SPEED = 0.96, 1.18
spec = json.load(open(os.path.join(wd, "vo.json"), encoding="utf-8"))
voice = spec.get("voice", "af_heart")
k = Kokoro(os.path.join(CACHE, "kokoro-v1.0.onnx"), os.path.join(CACHE, "voices-v1.0.bin"))
tok = k.tokenizer

def phonemes(text):
    for word, say in spec.get("respell", {}).items():
        text = re.sub(r"\b" + re.escape(word) + r"\b", say, text)
    return tok.phonemize(text, "en-us")

def render(ph, speed):
    s, sr = k.create(ph, voice=voice, speed=speed, lang="en-us", is_phonemes=True)
    return s.astype(np.float32), sr

os.makedirs(os.path.join(wd, "vo"), exist_ok=True)
out = []
for i, ln in enumerate(spec["lines"]):
    ph = phonemes(ln["text"]); room = ln["end"] - ln["t"]; speed = BASE_SPEED
    s, sr = render(ph, speed); dur = len(s) / sr
    if dur > room:
        speed = min(MAX_SPEED, BASE_SPEED * dur / room * 1.03); s, sr = render(ph, speed); dur = len(s) / sr
    path = os.path.join(wd, "vo", f"{i:02d}.wav"); sf.write(path, s, sr)
    over = dur - room
    out.append({**ln, "dur": round(dur, 2), "speed": round(speed, 3), "file": os.path.abspath(path)})
    print(f"{i:02d} t={ln['t']:5.1f} dur={dur:4.2f} room={room:4.2f} speed={speed:.2f} {'OVER ' + str(round(over, 2)) if over > 0.05 else ''}  {ln['text']}")
json.dump(out, open(os.path.join(wd, "vo_timeline.json"), "w"), indent=1)
