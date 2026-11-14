"""HiRISE の地形データから、活動地域（約 3 km 四方）のレイヤーを作る。

出力（app/public/data/）:
  region.json         範囲・解像度・出典
  elev.f32            標高（5 m 間隔、行 0 = 北の端、値なしは NaN）
  rough.f32           起伏（0〜1）
  hillshade.png       陰影
  slope_class.png     傾斜の 4 段階の色分け
  contours.geojson    等高線（5 m ごと、25 m ごとに太い線）
  hazard_zones.geojson 急斜面の危険エリア（丸みのある多角形）

使い方:  python build_layers.py <DTEEC の .IMG> <出力フォルダ>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely.geometry import LineString, Polygon
from skimage import measure

from pds_img import geo_params, open_dem

# ---- 設定 ----
ROW0, ROW1 = 6000, 9000  # 元データの行（北 → 南）
COL0, COL1 = 1700, 4700  # 元データの列（西 → 東）
BLOCK = 5  # 5 × 5 画素を平均して約 5 m 間隔にする
SLOPE_MAX = 20.0  # これを超えると通行不可
SLOPE_LIMITED = 15.0  # これ以上は「制限」
MIN_ZONE_M2 = 2000.0  # これより小さい危険エリアは捨てる
CONTOUR_STEP = 5
CONTOUR_INDEX = 25


def chaikin(coords: np.ndarray, rounds: int = 2) -> np.ndarray:
    """閉じた多角形の角を丸める（Chaikin 法）。"""
    pts = coords[:-1] if np.allclose(coords[0], coords[-1]) else coords
    for _ in range(rounds):
        nxt = np.roll(pts, -1, axis=0)
        q = 0.75 * pts + 0.25 * nxt
        r = 0.25 * pts + 0.75 * nxt
        pts = np.empty((len(pts) * 2, 2))
        pts[0::2] = q
        pts[1::2] = r
    return np.vstack([pts, pts[:1]])


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    data, label = open_dem(src)
    gp = geo_params(label)
    res = gp["map_res_ppd"]

    win = np.array(data[ROW0:ROW1, COL0:COL1], dtype=np.float32)
    win[win < -1e30] = np.nan
    h, w = win.shape[0] // BLOCK, win.shape[1] // BLOCK
    blocks = win[: h * BLOCK, : w * BLOCK].reshape(h, BLOCK, w, BLOCK)
    with np.errstate(invalid="ignore"):
        elev = np.nanmean(blocks, axis=(1, 3)).astype(np.float32)
    valid = np.isfinite(elev)
    print(f"grid {w} x {h}, valid {100 * valid.mean():.2f}%")

    # 位置。正距円筒図法（中心緯度 0°）: 緯度 = (L0 − 行) / res、経度 = 中心経度 + (列 − S0) / res
    north = (gp["line_offset"] - ROW0) / res
    south = (gp["line_offset"] - ROW1) / res
    west = gp["center_lon"] + (COL0 - gp["sample_offset"]) / res
    east = gp["center_lon"] + (COL1 - gp["sample_offset"]) / res
    dlat = (north - south) / h
    dlon = (east - west) / w
    cell_ns = gp["map_scale_m"] * BLOCK  # 南北方向のマスの大きさ（m）
    mid_lat = (north + south) / 2
    cell_ew = cell_ns * np.cos(np.radians(mid_lat))  # 東西方向（経度の間隔が一定なので少し小さい）

    def to_lonlat(rc: np.ndarray) -> np.ndarray:
        """(行, 列)（マスの中心 = 整数）→ (経度, 緯度)。"""
        lat = north - (rc[:, 0] + 0.5) * dlat
        lon = west + (rc[:, 1] + 0.5) * dlon
        return np.column_stack([lon, lat])

    # 傾斜（度）
    filled = np.where(valid, elev, np.nanmean(elev))
    gy, gx = np.gradient(filled, cell_ns, cell_ew)
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    slope[~valid] = np.nan

    # 起伏: なめらかにした地形との差の大きさ。95 パーセンタイルで割って 0〜1 にする
    resid = np.abs(filled - ndi.gaussian_filter(filled, 4))
    rough = ndi.gaussian_filter(resid, 2)
    rough = np.clip(rough / np.percentile(rough[valid], 95), 0, 1).astype(np.float32)
    rough[~valid] = np.nan

    elev.tofile(out / "elev.f32")
    rough.tofile(out / "rough.f32")

    # 陰影（北西から光）
    az, alt = np.radians(315), np.radians(45)
    sl = np.arctan(np.hypot(gx, gy))
    hs = np.sin(alt) * np.cos(sl) + np.cos(alt) * np.sin(sl) * np.cos(az - np.arctan2(-gx, gy))
    shade = (np.clip(hs, 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([shade, shade, shade, np.where(valid, 255, 0).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(out / "hillshade.png")

    # 傾斜の 4 段階（安全 = 透明、注意 = 黄、制限 = オレンジ、通行不可 = 赤）
    cls = np.zeros(slope.shape, dtype=np.uint8)
    cls[slope >= 5] = 1
    cls[slope >= SLOPE_LIMITED] = 2
    cls[slope > SLOPE_MAX] = 3
    palette = np.array([[0, 0, 0, 0], [250, 199, 117, 150], [239, 127, 98, 180], [226, 75, 74, 210]], dtype=np.uint8)
    img = palette[cls]
    img[~valid] = 0
    Image.fromarray(img, "RGBA").save(out / "slope_class.png")

    # 等高線
    smooth = ndi.gaussian_filter(filled, 1.0)
    smooth[~valid] = np.nan
    zmin, zmax = np.nanmin(smooth), np.nanmax(smooth)
    levels = np.arange(np.ceil(zmin / CONTOUR_STEP) * CONTOUR_STEP, zmax, CONTOUR_STEP)
    feats = []
    tol_deg = 1.5 * dlat / cell_ns  # 約 1.5 m
    for lv in levels:
        for c in measure.find_contours(smooth, lv):
            if len(c) < 8:  # 約 40 m より短い線は捨てる
                continue
            line = LineString(to_lonlat(c)).simplify(tol_deg)
            feats.append({
                "type": "Feature",
                "properties": {"elev_m": int(lv), "index": bool(int(lv) % CONTOUR_INDEX == 0)},
                "geometry": {"type": "LineString", "coordinates": [[round(x, 6), round(y, 6)] for x, y in line.coords]},
            })
    (out / "contours.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print(f"contours: {len(feats)} lines, levels {int(levels[0])}..{int(levels[-1])}")

    # 危険エリア: ぼかし → 小さな点々を消す → 面積で選ぶ → 輪郭を丸い多角形にする
    cell_area = cell_ns * cell_ew
    zones = []
    for level, mask, label_txt in [
        ("no_go", slope > SLOPE_MAX, f"急斜面 {SLOPE_MAX:.0f}°超"),
        ("limited", slope >= SLOPE_LIMITED, f"急斜面 {SLOPE_LIMITED:.0f}°以上"),
    ]:
        soft = ndi.gaussian_filter(np.nan_to_num(mask.astype(np.float32)), 2.0)
        core = ndi.binary_opening(soft > 0.5, structure=np.ones((3, 3)))
        lab, n = ndi.label(core)
        for k in range(1, n + 1):
            region = lab == k
            area = region.sum() * cell_area
            if area < MIN_ZONE_M2:
                continue
            padded = np.pad(region.astype(np.float32), 1)
            cs = measure.find_contours(ndi.gaussian_filter(padded, 1.0), 0.5)
            if not cs:
                continue
            c = max(cs, key=len) - 1  # 余白の分を戻す
            if len(c) < 4:
                continue
            poly = Polygon(to_lonlat(c)).simplify(4 * dlat / cell_ns)
            if poly.is_empty or poly.geom_type != "Polygon" or len(poly.exterior.coords) < 4:
                continue
            ring = chaikin(np.array(poly.exterior.coords), 2)
            vals = slope[region]
            zones.append({
                "type": "Feature",
                "properties": {
                    "kind": "steep", "level": level,
                    "max_slope_deg": round(float(np.nanmax(vals)), 1),
                    "mean_slope_deg": round(float(np.nanmean(vals)), 1),
                    "area_m2": int(round(area)), "label": label_txt,
                    "source": "HiRISE DTM の傾斜から自動で作成",
                },
                "geometry": {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]},
            })
    (out / "hazard_zones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": zones}, ensure_ascii=False), encoding="utf-8")
    n_nogo = sum(z["properties"]["level"] == "no_go" for z in zones)
    print(f"hazard zones: no_go {n_nogo}, limited {len(zones) - n_nogo}")

    region = {
        "body": "mars",
        "name": "Gale crater — Mount Sharp foothills",
        "width": int(w), "height": int(h),
        "cell_m": round(float(cell_ns), 4),
        "cell_ew_m": round(float(cell_ew), 4),
        "north": round(float(north), 7), "south": round(float(south), 7),
        "west": round(float(west), 7), "east": round(float(east), 7),
        "dlat_deg": float(dlat), "dlon_deg": float(dlon),
        "radius_m": gp["radius_m"],
        "elev_min_m": round(float(np.nanmin(elev)), 1), "elev_max_m": round(float(np.nanmax(elev)), 1),
        "valid_fraction": round(float(valid.mean()), 4),
        "slope_max_deg": SLOPE_MAX, "slope_limited_deg": SLOPE_LIMITED,
        "contour_step_m": CONTOUR_STEP, "contour_index_m": CONTOUR_INDEX,
        "layers": {
            "elev": "elev.f32", "rough": "rough.f32", "hillshade": "hillshade.png",
            "slope_class": "slope_class.png", "contours": "contours.geojson", "hazard_zones": "hazard_zones.geojson",
        },
        "source": {
            "product": "DTEEC_040770_1755_039280_1755_U01",
            "url": "https://www.uahirise.org/dtm/dtm.php?ID=ESP_040770_1755",
            "credit": "NASA/JPL-Caltech/University of Arizona (HiRISE DTM)",
            "native_resolution_m": gp["map_scale_m"],
            "window_px": {"row0": ROW0, "row1": ROW1, "col0": COL0, "col1": COL1},
            "note": "5 × 5 画素を平均。これより小さい岩などの障害物は表れない",
        },
    }
    (out / "region.json").write_text(json.dumps(region, ensure_ascii=False, indent=2), encoding="utf-8")
    print("slope pct 50/90/99:", np.nanpercentile(slope, [50, 90, 99]).round(1),
          f">20: {100 * np.nanmean(slope > SLOPE_MAX):.1f}%")
    print(f"N {north:.5f} S {south:.5f} W {west:.5f} E {east:.5f}  cell {cell_ns:.3f} m (EW {cell_ew:.3f})")
    for f in sorted(out.iterdir()):
        print(f"  {f.name:24s} {f.stat().st_size / 1024:8.0f} KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
