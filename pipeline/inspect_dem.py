"""地形データの有効範囲と標高・傾斜の概要を調べ、確認用の画像を出力する。"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from pds_img import open_dem, geo_params

src = Path(sys.argv[1]); out = Path(sys.argv[2])
data, label = open_dem(src)
gp = geo_params(label)
step = 10
d = np.array(data[::step, ::step], dtype=np.float32)
valid = d > -1e30
print("shape(1/10)", d.shape, "valid %.1f%%" % (100 * valid.mean()))
rows = np.where(valid.any(axis=1))[0]; cols = np.where(valid.any(axis=0))[0]
print("valid rows", rows.min(), rows.max(), "cols", cols.min(), cols.max())
z = np.where(valid, d, np.nan)
print("elev min/max", np.nanmin(z), np.nanmax(z))
# 行ごとの有効な列の範囲（200 行ごと）
for r in range(0, d.shape[0], 100):
    c = np.where(valid[r])[0]
    print(r, (c.min(), c.max()) if c.size else None, "mean z %.0f" % np.nanmean(z[r]) if c.size else "")
gy, gx = np.gradient(np.nan_to_num(z, nan=np.nanmean(z)), gp["map_scale_m"] * step)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
slope[~valid] = np.nan
print("slope pct 50/90/99:", np.nanpercentile(slope, [50, 90, 99]))
print(">20deg %.1f%%  15-20 %.1f%%" % (100*np.nanmean(slope > 20), 100*np.nanmean((slope >= 15) & (slope <= 20))))
az, alt = np.radians(315), np.radians(45)
hs = np.sin(alt) * np.cos(np.arctan(np.hypot(gx, gy))) + np.cos(alt) * np.sin(np.arctan(np.hypot(gx, gy))) * np.cos(az - np.arctan2(-gx, gy))
img = (np.clip(hs, 0, 1) * 255).astype(np.uint8); img[~valid] = 0
Image.fromarray(img).save(out)
