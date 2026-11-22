"""Assemble <workdir>/page.html from <workdir>/scenario.json and the fixed assets. Usage: build.py <workdir>"""
import html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
wd = sys.argv[1]
sc = json.load(open(os.path.join(wd, "scenario.json"), encoding="utf-8"))
shell = open(os.path.join(ASSETS, "shell.html"), encoding="utf-8").read()
for key in ("title", "heading", "kicker", "aria"):
    shell = shell.replace("{{" + key.upper() + "}}", html.escape(sc["page"][key], quote=True))
data = json.dumps(sc, ensure_ascii=False).replace("</", "<\\/")
js = "\n".join(open(os.path.join(ASSETS, f), encoding="utf-8").read() for f in ("primitives.js", "engine.js"))
page = shell + "<script>\nconst SCENARIO=" + data + ";\n" + js + "\n</script>\n"
open(os.path.join(wd, "page.html"), "w", encoding="utf-8").write(page)
print("built", os.path.join(wd, "page.html"), len(page), "bytes")
