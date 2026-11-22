"""Capture stills of <workdir>/page.html and tile them 2x2 for review.
Usage: frames.py <workdir> <t1,t2,...> [prefix]   ->  <workdir>/frames/<prefix>N.png (four times per sheet)"""
import asyncio, os, sys
from PIL import Image
from playwright.async_api import async_playwright

wd, times = sys.argv[1], [float(x) for x in sys.argv[2].split(",")]
prefix = sys.argv[3] if len(sys.argv) > 3 else "sheet"
out = os.path.join(wd, "frames"); os.makedirs(out, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(os.path.join(wd, "page.html")), wait_until="domcontentloaded", timeout=120000)
        await pg.evaluate("Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,20000))])")
        await pg.wait_for_timeout(400)
        st = pg.locator("#stage")
        for t in times:
            await pg.evaluate(f"window.__seek({t})")
            await pg.wait_for_timeout(40)
            await st.screenshot(path=os.path.join(out, f"f{t:05.1f}.png"))
        await b.close()
        print("page errors:", errs or "none")

asyncio.run(main())
ims = [Image.open(os.path.join(out, f"f{t:05.1f}.png")) for t in times]
w, h = ims[0].size
for n in range(0, len(ims), 4):
    sheet = Image.new("RGB", (w * 2, h * 2), "white")
    for i, im in enumerate(ims[n:n + 4]):
        sheet.paste(im, ((i % 2) * w, (i // 2) * h))
    path = os.path.join(out, f"{prefix}{n // 4}.png"); sheet.save(path); print(path)
