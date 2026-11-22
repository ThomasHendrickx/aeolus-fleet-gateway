"""Render <workdir>/page.html to a 1080p30 MP4 with sound.wav. Usage: export.py <workdir> <name>  ->  <workdir>/<name>.mp4
Frames go to <workdir>/export_frames first, then one encode. Stopped midway, it continues from the frames it has when run
again (for the same page.html). Run it alone: anything heavy beside it slows it down. Stops if the fonts did not load."""
import asyncio, hashlib, json, os, shutil, subprocess, sys, time
from playwright.async_api import async_playwright

wd, name = sys.argv[1], sys.argv[2]
FPS = 30
DUR = json.load(open(os.path.join(wd, "scenario.json"), encoding="utf-8"))["timeline"]["dur"]
page = os.path.join(wd, "page.html")
frames = os.path.join(wd, "export_frames"); stamp = os.path.join(frames, "page.sha1")
digest = hashlib.sha1(open(page, "rb").read()).hexdigest()
if os.path.isdir(frames) and (not os.path.exists(stamp) or open(stamp).read() != digest): shutil.rmtree(frames)
os.makedirs(frames, exist_ok=True); open(stamp, "w").write(digest)
frame = lambda i: os.path.join(frames, f"{i:05d}.jpg")
n = int(FPS * DUR); todo = [i for i in range(n + 1) if not os.path.exists(frame(i))]
CSS = """html,body{margin:0!important;padding:0!important;background:#f6f8fb!important}:root{padding:0!important}
.wrap{max-width:none!important;padding:0!important;gap:0!important;display:block!important}.top,.ctrl,.chapters{display:none!important}
.stage{width:1920px!important;height:1080px!important;border:0!important;border-radius:0!important}"""
FONTS = """(async()=>{await document.fonts.load('700 20px "Bricolage Grotesque"');await document.fonts.load('600 14px "IBM Plex Sans"');
const L=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family);return L.some(x=>x.includes('Bricolage'))&&L.some(x=>x.includes('Plex Sans'))})()"""

async def capture():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        await pg.goto("file://" + os.path.abspath(page), wait_until="domcontentloaded", timeout=120000)
        await pg.evaluate("Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,30000))])")
        assert await pg.evaluate(FONTS), "fonts did not load: check network access to fonts.googleapis.com"
        await pg.add_style_tag(content=CSS); await pg.wait_for_timeout(800)
        await pg.evaluate("window.dispatchEvent(new Event('resize'))"); await pg.wait_for_timeout(300)
        box = await pg.locator("#stage").bounding_box(); t0 = time.time()
        for k, i in enumerate(todo):
            await pg.evaluate(f"window.__seek({i / FPS})")
            open(frame(i) + ".part", "wb").write(await pg.screenshot(type="jpeg", quality=94, clip=box))
            os.replace(frame(i) + ".part", frame(i))
            if k % 300 == 0: print("frame", i, "of", n, f"{time.time() - t0:.0f} s", flush=True)
        await b.close()

if todo: asyncio.run(capture())
print("encoding", flush=True)
silent = os.path.join(wd, "video_silent.mp4")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(frames, "%05d.jpg"),
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", silent], check=True)
out = os.path.join(wd, name + ".mp4")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", silent, "-i", os.path.join(wd, "sound.wav"), "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], check=True)
shutil.rmtree(frames)
print("done", out, flush=True)
