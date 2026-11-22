"""Score, sound effects, voice mix and mastering for a scenario. Usage: make_sound.py <workdir>
Reads scenario.json and vo_timeline.json. Writes mix.wav, sound.wav (-16 LUFS, peak -1.7 dB) and sound.mp3 (for the page).
The score follows the story: a hesitant minor bed while people carry the work, a riser and bloom when Aeolus appears,
a light groove while the network carries it (holding its breath at the turn, thinning before the last decision),
a breakdown under the proof card (and a closing card), a resolve on the end card. Every effect is derived from the scenario's hops,
notes, tags, vignettes and decisions; decisions get their own chime in both runs."""
import json, os, re, subprocess, sys
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly

wd = sys.argv[1]
sc = json.load(open(os.path.join(wd, "scenario.json"), encoding="utf-8"))
VO = json.load(open(os.path.join(wd, "vo_timeline.json")))
TL = sc["timeline"]
A0, A1, JOIN, B0, PROOF, END = TL["a0"], TL["a1"], TL["join"], TL["b0"], TL["proof"], TL["end"]
MARK = TL["mark"] if isinstance(TL.get("mark"), (int, float)) and not isinstance(TL.get("mark"), bool) else A1 + 0.8
SND = sc.get("sound", {})
SR = 48000
DUR = TL["dur"] + 0.6
N = int(SR * DUR)
rng = np.random.default_rng(11)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def tt(n): return np.arange(n) / SR
def sec(x): return int(round(x * SR))
def lp(x, fc, order=2): return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)
def hp(x, fc, order=2): return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)

class Bus:
    def __init__(self): self.x = np.zeros((2, N))
    def add(self, sig, t0, gain=1.0, pan=0.0):
        i = sec(t0)
        if i >= N: return
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.vstack([sig * l * 1.414, sig * r * 1.414])
        if i < 0: sig = sig[:, -i:]; i = 0
        n = min(sig.shape[1], N - i)
        self.x[:, i:i + n] += sig[:, :n] * gain

def env_adsr(n, a, d, s, r, hold):
    t = tt(n); e = np.where(t < a, t / max(a, 1e-4), 0.0)
    dd = (t >= a) & (t < a + d); e[dd] = 1 - (1 - s) * (t[dd] - a) / max(d, 1e-4)
    e[(t >= a + d) & (t < hold)] = s
    rel = t >= hold; lvl = np.interp(hold, t, e) if hold < t[-1] else s
    e[rel] = lvl * np.exp(-(t[rel] - hold) / max(r / 4, 1e-4)); return e

# ---------- instruments ----------
def pad_note(m, dur, rel=1.6, att=1.1, bright=1.0):
    n = sec(dur + rel); t = tt(n); f = mtof(m); out = np.zeros((2, n))
    for ch, det in ((0, -0.07), (1, 0.07)):
        sig = np.zeros(n)
        for cents in (det * 100 - 5, det * 100 + 5):
            ff = f * 2 ** (cents / 1200); ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, int(min(12, 6000 / ff)) + 1):
                sig += np.sin(2 * np.pi * ff * k * t + ph * k) / k * (0.92 ** (k * (1.2 - 0.4 * bright)))
        out[ch] = sig
    return out * env_adsr(n, att, 0.6, 0.85, rel, dur) * 0.06
def epiano(m, dur, vel=0.8):
    rel = 0.25; n = sec(min(dur, 3.0) + rel + 1.2); t = tt(n); f = mtof(m)
    idx = (1.4 * vel + 0.5) * np.exp(-t / 0.45) + 0.2
    body = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    tine = np.sin(2 * np.pi * f * t + 1.2 * np.exp(-t / 0.03) * np.sin(2 * np.pi * f * 14 * t)) * np.exp(-t / 0.08)
    e = np.minimum(t / 0.003, 1) * np.exp(-t / np.interp(m, [48, 84], [1.6, 0.7]))
    hold = min(dur, 3.0); e = e * np.where(t < hold, 1, np.exp(-(t - hold) / 0.08))
    return (0.82 * body + 0.18 * tine) * e * vel * 0.16
def bell(m, vel=1.0, tau=1.3):
    n = sec(tau * 4); t = tt(n); f = mtof(m)
    return np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t / 0.5) * np.sin(2 * np.pi * f * 3.5 * t)) * np.minimum(t / 0.002, 1) * np.exp(-t / tau) * vel * 0.12
def bass(m, dur, vel=0.8):
    n = sec(dur + 0.3); t = tt(n); f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)) * env_adsr(n, 0.012, 0.25, 0.7, 0.25, dur) * vel * 0.17
def kick(vel=1.0):
    n = sec(0.5); t = tt(n); f = 46 + 75 * np.exp(-t / 0.035)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2) + hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.15) * vel * 0.32
def shaker(vel=1.0):
    n = sec(0.12); t = tt(n); return bp(rng.standard_normal(n), 5000, 11000) * np.exp(-t / 0.03) * vel * 0.05
def rim(vel=1.0):
    n = sec(0.15); t = tt(n)
    return (bp(rng.standard_normal(n), 1400, 3200) * np.exp(-t / 0.012) * 0.5 + np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.018) * 0.4) * vel * 0.10
def whoosh(dur, lo=600, hi=2600, down=True):
    n = sec(dur); t = tt(n); x = rng.standard_normal(n)
    a = bp(x, lo * 0.8, lo * 2.0); b = bp(x, hi * 0.6, hi * 1.4); w = np.linspace(0, 1, n)
    return ((b * (1 - w) + a * w) if down else (a * (1 - w) + b * w)) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6 * 0.08
def tock():
    n = sec(0.12); t = tt(n); return (np.sin(2 * np.pi * 1050 * t) * np.exp(-t / 0.035) + 0.35 * np.sin(2 * np.pi * 2210 * t) * np.exp(-t / 0.02)) * 0.11
def bip(f=1650, vel=1.0):
    n = sec(0.09); t = tt(n); fr = f * (1 + 0.18 * np.minimum(t / 0.03, 1))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.minimum(t / 0.004, 1) * np.exp(-t / 0.035) * 0.06 * vel
def ping(f=1760, vel=1.0):
    n = sec(0.5); t = tt(n)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.05)) * np.minimum(t / 0.002, 1) * np.exp(-t / 0.12) * 0.05 * vel
def pop(vel=1.0):
    n = sec(0.08); t = tt(n); fr = 520 + 700 * np.minimum(t / 0.04, 1)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.minimum(t / 0.003, 1) * np.exp(-t / 0.025) * 0.08 * vel
def click(vel=1.0):
    n = sec(0.03); t = tt(n); return (hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.003) * 0.5 + np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.004)) * 0.06 * vel
def thock():
    n = sec(0.2); t = tt(n); return (np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.06) + 0.2 * np.sin(2 * np.pi * 950 * t) * np.exp(-t / 0.02)) * 0.10
def ring(bursts=2):
    out = []
    for _ in range(bursts):
        n = sec(0.34); t = tt(n)
        s = (np.sin(2 * np.pi * 1046 * t) + np.sin(2 * np.pi * 1318 * t)) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 20 * t)))
        out += [lp(s, 4000) * np.minimum(t / 0.01, 1) * np.minimum((0.34 - t) / 0.03, 1), np.zeros(sec(0.16))]
    return np.concatenate(out) * 0.035
def buzz(bursts=2):
    out = []
    for _ in range(bursts):
        n = sec(0.24); t = tt(n)
        s = lp(np.sign(np.sin(2 * np.pi * 155 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t)), 900) + 0.15 * bp(rng.standard_normal(n), 1500, 4000)
        out += [s * np.minimum(t / 0.01, 1) * np.minimum((0.24 - t) / 0.02, 1), np.zeros(sec(0.12))]
    return np.concatenate(out) * 0.05
def busy():
    out = []
    for _ in range(3):
        n = sec(0.22); t = tt(n); out += [np.sin(2 * np.pi * 425 * t) * np.minimum(t / 0.01, 1) * np.minimum((0.22 - t) / 0.01, 1), np.zeros(sec(0.2))]
    return np.concatenate(out) * 0.05
def dial():
    n = sec(0.16); t = tt(n)
    return (np.sin(2 * np.pi * 697 * t) + np.sin(2 * np.pi * 1209 * t)) * np.minimum(t / 0.005, 1) * np.minimum((0.16 - t) / 0.01, 1) * 0.025
def tick(hi=True):
    n = sec(0.06); t = tt(n); f = 2300 if hi else 1750
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006) + bp(rng.standard_normal(n), 2000, 6000) * np.exp(-t / 0.003) * 0.3) * 0.09
def riser(dur):
    n = sec(dur); t = tt(n); x = rng.standard_normal(n); w = (t / dur) ** 2
    s = bp(x, 400, 1200) * (1 - w) + bp(x, 2500, 7000) * w
    return (s * 0.6 + np.sin(2 * np.pi * np.cumsum(220 * 2 ** (1.5 * t / dur)) / SR) * 0.15) * (t / dur) ** 2.2 * 0.09
def sub_drop():
    n = sec(1.6); t = tt(n); f = 40 + 30 * np.exp(-t / 0.25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.7) * 0.22

# ---------- the score ----------
music, verb_send, drums, sfx = Bus(), Bus(), Bus(), Bus()
CH = {"Bm7": [47, 54, 57, 62], "Gmaj7": [43, 50, 54, 59], "G": [43, 50, 55, 59], "Em7": [40, 50, 55, 59], "Asus4": [45, 50, 52, 57],
      "F#sus4": [42, 47, 49, 54], "Dadd9": [38, 50, 54, 57, 64], "D": [38, 50, 54, 57, 62], "A": [45, 52, 57, 61, 64],
      "Dmaj7": [38, 50, 54, 57, 61], "D/F#": [42, 50, 54, 57, 62], "A6": [45, 52, 54, 57, 61], "Dmaj9": [38, 50, 54, 57, 61, 64]}
ROOT = {"Bm7": 35, "Gmaj7": 31, "G": 31, "Em7": 28, "Asus4": 33, "F#sus4": 30, "Dadd9": 26, "D": 26, "A": 33, "Dmaj7": 26, "D/F#": 30, "A6": 33, "Dmaj9": 26}
def pad_chord(name, t0, dur, gain, bright, att=1.1):
    for m in CH[name]:
        s = pad_note(m, dur, att=att, bright=bright); music.add(s, t0, gain); verb_send.add(s, t0, gain * 0.5)
def groove(c, t0, d, kick_on=True, shaker_on=False, rim_on=False):
    pad_chord(c, t0, d, 0.7, 1.0, att=0.5); r = ROOT[c] + 12
    for b in range(int(round(d / 0.5))):
        tb = t0 + b * 0.5
        if b % 4 == 0: music.add(bass(r, 0.42, 0.75), tb, 1.0)
        if b % 4 == 2: music.add(bass(r, 0.42, 0.6), tb, 1.0)
        if b % 4 == 3: music.add(bass(r + 12, 0.2, 0.45), tb + 0.25, 1.0)
        if kick_on and b % 2 == 0: drums.add(kick(0.8 if b % 4 == 0 else 0.6), tb, 1.0)
        if shaker_on: drums.add(shaker(1.0), tb, 1.0); drums.add(shaker(0.6), tb + 0.25, 1.0)
        if rim_on and b % 2 == 1: drums.add(rim(1.0), tb, 1.0)
    arp = sorted(m + 12 for m in CH[c][1:]) + [CH[c][1] + 24]
    pattern = [0, 1, 2, 3, 2, 1, 2, 3] if len(arp) > 3 else [0, 1, 2, 1]
    for e8 in range(int(round(d / 0.25))):
        m = arp[pattern[e8 % len(pattern)] % len(arp)]; vel = 0.55 if e8 % 2 == 0 else 0.38; pan = -0.3 if e8 % 2 == 0 else 0.3
        s = epiano(m, 0.22, vel); music.add(s, t0 + e8 * 0.25, 0.9, pan); verb_send.add(s, t0 + e8 * 0.25, 0.5, pan)
def cycle(names, t0, t1, flags):
    t, i = t0, 0
    while t < t1 - 0.25:
        d = min(4.0, round((t1 - t) * 2) / 2); kk, sh, rm = flags(t); groove(names[i % len(names)], t, d, kk, sh, rm); t += d; i += 1

# intro: a warm neutral swell
pad_chord("Dmaj9", 0.0, max(1.0, A0 - 0.2), 0.72, 0.8, att=1.4)
# run A: a hesitant minor bed, sparse piano, held bass
seq_a = ["Bm7", "Gmaj7", "Em7", "Asus4", "Bm7", "Gmaj7", "Em7", "F#sus4"]
t, i = A0, 0
while t < A1 - 0.5:
    c = seq_a[i % len(seq_a)]; d = min(4.0, A1 - t)
    pad_chord(c, t, d, 0.8, 0.55, att=0.9); music.add(bass(ROOT[c] + 12, d - 0.1, 0.55), t, 1.0)
    tones = [m + 12 for m in CH[c][1:]]
    for j in range(int(d / 1.0)):
        if rng.uniform() < 0.62:
            m = tones[rng.integers(len(tones))]; s = epiano(m, 0.9, rng.uniform(0.35, 0.58)); pan = rng.uniform(-0.35, 0.35); tj = t + j * 1.0 + 0.5 * (j % 2)
            music.add(s, tj, 1.0, pan); verb_send.add(s, tj, 0.7, pan)
    t += 4.0; i += 1
# the clock moves on while the work sits with someone
for w0 in SND.get("ticks") or [c[0] for c in sc["clockA"][1:]]:
    for k in range(6): drums.add(tick(k % 2 == 0), w0 - 0.9 + k * 0.18, 0.8)
# the switch: riser, the Aeolus chime, the wave, a bloom
music.add(riser(2.6), A1 - 1.8, 1.0)
for m, dt, v in ((86, 0.0, 0.9), (93, 0.12, 0.6)):
    s = bell(m, v, 1.3); sfx.add(s, MARK + dt, 0.7); verb_send.add(s, MARK + dt, 0.6)
music.add(whoosh(1.1, 300, 3000, down=False), MARK - 0.4, 0.6)
music.add(sub_drop(), JOIN, 1.0)
pad_chord("Dadd9", JOIN, max(1.0, B0 - JOIN), 0.85, 1.0, att=0.5)
for m in (74, 78, 81, 86):
    s = pad_note(m, max(1.0, B0 - JOIN), att=0.35, bright=1.3); music.add(s, JOIN + 0.1, 0.22); verb_send.add(s, JOIN + 0.1, 0.6)
# run B: the groove, on a 2-second bar grid from B0
PSTART = B0 + 2 * int((PROOF - B0) / 2)
turn, susp = SND.get("turn"), SND.get("suspense")
seg1_end = turn[0] if turn else (susp[0] if susp else PSTART)
cycle(["D", "A", "Bm7", "G"], B0, seg1_end, lambda t: (True, t >= B0 + 4, t >= B0 + 8))
if turn:
    t0, t1 = turn; sp = t1 - t0
    pad_chord("Em7", t0, sp * 2 / 3, 0.8, 0.6, att=0.4); pad_chord("F#sus4", t0 + sp * 2 / 3, sp / 3, 0.8, 0.6, att=0.3)
    music.add(bass(ROOT["Em7"] + 12, sp * 2 / 3 - 0.1, 0.6), t0, 1.0); music.add(bass(ROOT["F#sus4"] + 12, sp / 3 - 0.1, 0.6), t0 + sp * 2 / 3, 1.0)
    for f, m in ((0.067, 71), (0.333, 74), (0.667, 73), (0.833, 76)):
        s = epiano(m, 0.9, 0.45); music.add(s, t0 + f * sp, 1.0); verb_send.add(s, t0 + f * sp, 0.8)
    cycle(["G", "D/F#", "Bm7", "A"], t1, susp[0] if susp else PSTART, lambda t: (True, True, t >= t1 + 4))
if susp:
    s0, s1 = susp
    if not turn and s0 > seg1_end: cycle(["G", "D/F#"], seg1_end, s0, lambda t: (True, True, True))
    groove("Asus4", s0, s1 - s0, False, True, False)
    for k in range(4): drums.add(rim(0.5 + 0.15 * k), s1 - 0.5 + k * 0.125, 1.0)
    groove("A", s1, min(2.0, PSTART - s1), True, True, True)
    if PSTART - s1 > 2.25: cycle(["D", "G", "D", "A"], s1 + 2.0, PSTART, lambda t: (True, True, True))
# the proof (and a closing card): a breakdown, room for the voice, resolving on Dmaj7
slots = max(1, int(np.ceil((END - PSTART) / 4.0 - 1e-9)))
breakdown = [("Gmaj7", "A6", "Bm7", "Em7")[i % 4] for i in range(slots - 1)] + ["Dmaj7"]
t = PSTART
for i, c in enumerate(breakdown):
    d = min(4.0, END - t) if i < len(breakdown) - 1 else END - t
    if d <= 0.2: break
    pad_chord(c, t, d, 0.75, 0.7, att=0.6); music.add(bass(ROOT[c] + 12, d - 0.1, 0.45), t, 1.0)
    for m in CH[c][1:3]:
        s = epiano(m + 12, 1.6, 0.42); music.add(s, t + 0.05, 1.0); verb_send.add(s, t + 0.05, 0.7)
    t += d
# the end card: resolve and fade
pad_chord("Dmaj9", END, 4.0, 0.85, 0.85, att=0.7); pad_chord("D", END + 4.0, max(1.0, DUR - END - 4.6), 0.7, 0.7, att=0.6)
music.add(bass(38, 3.9, 0.5), END, 1.0); music.add(bass(38, max(1.0, DUR - END - 4.6), 0.4), END + 4.0, 1.0)
for dt, m in ((0.1, 74), (0.6, 78), (1.1, 81), (1.6, 76), (4.1, 78), (4.6, 81), (5.1, 86)):
    s = epiano(m, 0.9, 0.5); music.add(s, END + dt, 1.0, 0.1); verb_send.add(s, END + dt, 0.8, 0.1)

# ---------- sound effects, derived from the scenario ----------
X = {k: v["x"] for g in ("people", "apps", "agents") for k, v in sc[g].items()}
X.update({k: v["x"] + v["w"] / 2 for k, v in sc.get("frames", {}).items()})
pan_of = lambda k: float(np.clip((X.get(k, 640) - 640) / 640 * 0.75, -0.75, 0.75))
outside = {k for k, v in sc["people"].items() if v.get("outside")}
for h in sc["hops"]:
    a, b, t0, t1, kind = h[0], h[1], h[2], h[3], h[4]; handoff = len(h) > 6 and h[6]; mid = (pan_of(a) + pan_of(b)) / 2
    if kind == "busy": sfx.add(ring(2), t0, 1.0, pan_of(a)); sfx.add(busy(), t1, 1.0, pan_of(b)); continue
    if t0 < A1:
        if handoff:
            if kind == "phone": sfx.add(dial(), t0, 1.0, pan_of(a))
            elif kind == "chat": sfx.add(bip(1300, 0.8), t0, 1.0, pan_of(a))
            else: sfx.add(whoosh(t1 - t0, 700, 2400), t0, 0.7, mid)
            sfx.add(tock(), t1, 0.95, pan_of(b))
        else: sfx.add(whoosh(t1 - t0, 700, 2400), t0, 0.5, mid); sfx.add(ping(1568, 0.6), t1, 1.0, pan_of(b))
    elif kind == "call":
        if a in outside: sfx.add(ring(2), t0, 1.0, pan_of(a)); sfx.add(click(1.0), t1, 1.0, pan_of(b))
        else: sfx.add(bip(1650, 0.9), t1, 1.0, pan_of(b))
    elif kind == "spark": sfx.add(bip(1650, 0.9), t1, 1.0, pan_of(b))
    elif kind == "msg": sfx.add(ping(1975, 0.8), t1, 1.0, pan_of(b))
    elif kind == "mail": sfx.add(whoosh(max(0.4, t1 - t0), 700, 2400), t0, 0.55, mid); sfx.add(ping(1760, 0.75), t1, 1.0, pan_of(b))
    elif kind == "doc": sfx.add(whoosh(max(0.4, t1 - t0), 700, 2400), t0, 0.5, mid); sfx.add(tock(), t1, 0.8, pan_of(b))
for n in sc.get("notes", []):
    sfx.add(thock(), n["from"], 0.9, -0.45)
    if n.get("handoff"): sfx.add(tock(), n["handoff"], 0.95, -0.45)
for k, g in sc["agents"].items():
    for t0 in [w[0] for w in sc.get("show", {}).get(k, [])] or [g["from"]]: sfx.add(bip(1900, 0.6), t0, 1.0, pan_of(k))
for g in sc["tags"]:
    k = g.get("of")
    if g.get("sfx") == "urgent": sfx.add(bip(2050, 0.8), g["from"], 1.0, pan_of(k)); sfx.add(bip(2450, 0.6), g["from"] + 0.08, 1.0, pan_of(k))
    if g.get("sfx") == "down": sfx.add(bip(1250, 0.8), g["from"], 1.0, pan_of(k)); sfx.add(bip(880, 0.8), g["from"] + 0.11, 1.0, pan_of(k))
    if g.get("sfx") == "up": sfx.add(bip(1250, 0.8), g["from"], 1.0, pan_of(k)); sfx.add(bip(1760, 0.8), g["from"] + 0.11, 1.0, pan_of(k))
    if g.get("sfx") == "accept":
        for m, dt in ((79, 0.0), (83, 0.08), (86, 0.16)):
            s = bell(m, 0.55, 1.0); sfx.add(s, g["from"] + dt, 0.5, pan_of(k)); verb_send.add(s, g["from"] + dt, 0.3)
for v in sc.get("vignettes", []):
    vp = float(np.clip((v["x"] + 100 - 640) / 640 * 0.75, -0.75, 0.75))
    if v["type"] in ("chatCard", "quoteCard"): sfx.add(pop(0.7), v["from"], 1.0, vp); sfx.add(click(1.2), v["press"], 1.0, vp)
    if v["type"] == "quoteCard": sfx.add(tock(), v["change"], 0.6, vp)
    if v["type"] in ("phoneCard", "approvalPhone"): sfx.add(buzz(2), v["from"], 1.0, vp)
    if v["type"] == "phoneCard":
        for i in range(len(v.get("rows", []))): sfx.add(click(0.6), v["from"] + 0.3 + i * 0.45, 1.0, vp)
    if v["type"] == "approvalPhone": sfx.add(click(1.2), v["press"], 1.0, vp)
    if v["type"] == "voiceNote": sfx.add(bip(900, 1.0), v["from"], 1.0, vp); sfx.add(bip(700, 1.0), v["to"] - 0.2, 1.0, vp)
    if v["type"] == "terminalCard":
        sfx.add(pop(0.6), v["from"], 1.0, vp); t0, dur = v.get("typeAt", v["from"] + 0.3), v.get("typeDur", 1.6)
        for i in range(int(dur / 0.07)): sfx.add(click(rng.uniform(0.35, 0.7)), t0 + i * 0.07 + rng.uniform(0, 0.02), 1.0, vp)
    if v["type"] == "fileCard": sfx.add(pop(0.6), v["from"], 1.0, vp)
    if v["type"] == "chatThread":
        sfx.add(pop(0.6), v["from"], 1.0, vp)
        for m in v.get("msgs", []):
            if m["at"] - v["from"] > 0.2: sfx.add(pop(0.45), m["at"], 1.0, vp)
    if v["type"] == "ticketCard":
        sfx.add(pop(0.7), v["from"], 1.0, vp)
        if "change" in v: sfx.add(tock(), v["change"], 0.6, vp)
        if "statusAt" in v and v["statusAt"] != v.get("change"): sfx.add(tock(), v["statusAt"], 0.5, vp)
    if v["type"] == "requestCard":
        sfx.add(pop(0.7), v["from"], 1.0, vp)
        if "change" in v: sfx.add(tock(), v["change"], 0.6, vp)
        if "press" in v: sfx.add(click(1.2), v["press"], 1.0, vp)
D = sc.get("decisions") or {"a": [], "b": [], "who": []}
for times in (D["a"], D["b"]):
    for t0, k in zip(times, D["who"]):
        for m, dt in ((81, 0.0), (86, 0.07)):
            s = bell(m, 0.9, 0.85); sfx.add(s, t0 + dt, 0.6, pan_of(k)); verb_send.add(s, t0 + dt, 0.35)
pt = sc["proof"]["times"]
for t0 in pt[:3]: sfx.add(thock(), t0, 0.9)
s = bell(81, 0.5, 1.2); sfx.add(s, pt[3], 0.35); verb_send.add(s, pt[3], 0.4)
for t0 in (sc.get("closing") or {}).get("times", []): sfx.add(thock(), t0, 0.9)
s = bell(86, 0.5, 1.4); sfx.add(s, END + 0.2, 0.4); verb_send.add(s, END + 0.2, 0.5)

# ---------- reverb, voice, ducking, levels ----------
n_ir = sec(2.8); t_ir = tt(n_ir)
ir = np.vstack([rng.standard_normal(n_ir), rng.standard_normal(n_ir)]) * np.exp(-t_ir / 0.42)
ir = np.hstack([np.zeros((2, sec(0.022))), np.vstack([lp(ir[0], 6500), lp(ir[1], 6500)])]); ir = ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
wet = np.vstack([fftconvolve(verb_send.x[0], ir[0])[:N], fftconvolve(verb_send.x[1], ir[1])[:N]])
mus = music.x + drums.x * 0.9 + wet * 0.55
mus = np.vstack([hp(mus[0], 35), hp(mus[1], 35)])
fade = np.ones(N); fi = sec(1.0); fade[:fi] = np.linspace(0, 1, fi) ** 2
fo0, fo1 = sec(DUR - 2.8), sec(DUR - 0.2); fade[fo0:fo1] = np.linspace(1, 0, fo1 - fo0) ** 1.5; fade[fo1:] = 0
mus *= fade
vo = np.zeros(N)
for ln in VO:
    s, sr = sf.read(ln["file"], dtype="float32")
    if s.ndim > 1: s = s.mean(axis=1)
    s = resample_poly(s, SR, sr); f2 = min(len(s), sec(0.012)); s[:f2] *= np.linspace(0, 1, f2); s[-f2:] *= np.linspace(1, 0, f2)
    i = sec(ln["t"]); n = min(len(s), N - i); vo[i:i + n] += s[:n]
vo = hp(vo, 80); vo = vo / (np.abs(vo).max() + 1e-9) * 0.7
win_n = sec(0.05); rms = np.sqrt(np.convolve(vo ** 2, np.ones(win_n) / win_n, mode="same")); act = (rms > 0.01).astype(float)
att_n, rel_n = sec(0.08), sec(0.45); duck = np.zeros(N); level = 0.0; blk = 240
for i in range(0, N, blk):
    target = act[i:i + blk].max(); level += (target - level) * (min(1, blk / att_n) if target > level else min(1, blk / rel_n)); duck[i:i + blk] = level
def rmsdb(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
vo_rms = rmsdb(vo[vo != 0])
mus *= 10 ** (((vo_rms - 9.5) - rmsdb(mus[:, sec(A0):sec(PROOF)])) / 20)
mix = mus * (1 - 0.58 * duck) + sfx.x * (1 - 0.30 * duck) * 0.9 + np.vstack([vo, vo])
mix = np.tanh(mix / max(np.abs(mix).max(), 1e-9) * 1.1) / np.tanh(1.1) * 0.89
raw = os.path.join(wd, "mix.wav"); sf.write(raw, mix.T, SR, subtype="PCM_24")

# ---------- master: -16 LUFS, limiter, mp3 for the page ----------
meas = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", raw, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", meas)[-1])
out = os.path.join(wd, "sound.wav")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", f"volume={-16 - lufs:.2f}dB,alimiter=limit=0.82:attack=4:release=60:level=disabled", "-c:a", "pcm_s24le", out], check=True)
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", out, "-c:a", "libmp3lame", "-b:a", "160k", os.path.join(wd, "sound.mp3")], check=True)
print(f"mix {lufs:.1f} LUFS -> sound.wav at -16 LUFS, sound.mp3 written")
