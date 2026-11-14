"""検証: Mars Trek の HiRISE タイルに、等高線と危険エリアを重ねた画像を作る（位置ずれの目視確認用）。
使い方: python validate_overlay.py <app/public/data> <出力 PNG>
"""
import io, json, sys, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

data = Path(sys.argv[1]); out = Path(sys.argv[2])
reg = json.loads((data / "region.json").read_text(encoding="utf-8"))
Z = 14
deg = 180 / 2 ** Z            # 1 タイルの大きさ（度）。ズーム 0 は横 2 × 縦 1
x0 = int((reg["west"] + 180) // deg); x1 = int((reg["east"] + 180) // deg)
y0 = int((90 - reg["north"]) // deg); y1 = int((90 - reg["south"]) // deg)
URL = "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0//default/default028mm/{z}/{y}/{x}.png"
mosaic = Image.new("RGB", ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
for y in range(y0, y1 + 1):
    for x in range(x0, x1 + 1):
        req = urllib.request.Request(URL.format(z=Z, y=y, x=x), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            mosaic.paste(Image.open(io.BytesIO(r.read())).convert("RGB"), ((x - x0) * 256, (y - y0) * 256))
print("tiles", (x1 - x0 + 1) * (y1 - y0 + 1), "size", mosaic.size)
px = lambda lon, lat: ((lon + 180) / deg * 256 - x0 * 256, (90 - lat) / deg * 256 - y0 * 256)
box = (*px(reg["west"], reg["north"]), *px(reg["east"], reg["south"]))
left = mosaic.copy(); right = mosaic.copy()
d = ImageDraw.Draw(right, "RGBA")
for f in json.loads((data / "hazard_zones.geojson").read_text(encoding="utf-8"))["features"]:
    ring = [px(x, y) for x, y in f["geometry"]["coordinates"][0]]
    nogo = f["properties"]["level"] == "no_go"
    d.polygon(ring, fill=(239, 127, 98, 90 if nogo else 40), outline=(232, 148, 116, 255))
for f in json.loads((data / "contours.geojson").read_text(encoding="utf-8"))["features"]:
    pts = [px(x, y) for x, y in f["geometry"]["coordinates"]]
    idx = f["properties"]["index"]
    d.line(pts, fill=(80, 220, 200, 255 if idx else 140), width=2 if idx else 1)
d.rectangle(box, outline=(255, 255, 255, 255))
both = Image.new("RGB", (left.width * 2 + 8, left.height), "black")
both.paste(left, (0, 0)); both.paste(right, (left.width + 8, 0))
crop = tuple(int(v) for v in (box[0] - 10, box[1] - 10, box[2] + 10, box[3] + 10))
l = left.crop(crop); r = right.crop(crop)
pair = Image.new("RGB", (l.width * 2 + 8, l.height), "black"); pair.paste(l, (0, 0)); pair.paste(r, (l.width + 8, 0))
pair.save(out); print("saved", out, pair.size)
