"""HiRISE の地形データ（PDS3 形式の .IMG、ラベル埋め込み）を numpy だけで読む。

rasterio / GDAL が入っていない環境でも動くようにしている。
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np


def read_label(path: Path, max_bytes: int = 200_000) -> dict[str, str]:
    """ファイル先頭のラベルを「キー → 値（文字列）」の辞書にする。同じキーは最後の値が残る。"""
    with open(path, "rb") as f:
        head = f.read(max_bytes)
    text = head.decode("latin-1")
    end = re.search(r"^END\s*$", text, flags=re.M)
    if end:
        text = text[: end.start()]
    label: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        label[key.strip()] = value.strip()
    return label


def _num(value: str) -> float:
    """'1.01 <METERS/PIXEL>' のような値から数値だけを取り出す。"""
    m = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", value)
    if not m:
        raise ValueError(f"数値を読めません: {value!r}")
    return float(m.group(0))


def image_offset(label: dict[str, str]) -> int:
    """画像データが始まるバイト位置。"""
    record_bytes = int(_num(label["RECORD_BYTES"]))
    pointer = label["^IMAGE"]
    if "<BYTES>" in pointer.upper():
        return int(_num(pointer)) - 1
    return (int(_num(pointer)) - 1) * record_bytes


def open_dem(path: Path) -> tuple[np.memmap, dict[str, str]]:
    """標高の配列（行 0 = 北の端）とラベルを返す。値なしはそのまま（呼び出し側で NaN にする）。"""
    label = read_label(path)
    lines = int(_num(label["LINES"]))
    samples = int(_num(label["LINE_SAMPLES"]))
    bits = int(_num(label["SAMPLE_BITS"]))
    stype = label["SAMPLE_TYPE"].upper()
    if bits != 32 or "REAL" not in stype:
        raise ValueError(f"想定外の画素の型: {stype} {bits} bit")
    dtype = "<f4" if "PC" in stype or "LSB" in stype else ">f4"
    data = np.memmap(path, dtype=dtype, mode="r", offset=image_offset(label), shape=(lines, samples))
    return data, label


def geo_params(label: dict[str, str]) -> dict[str, float]:
    """正距円筒図法（Equirectangular）の変換に使う値。"""
    return {
        "lines": _num(label["LINES"]),
        "samples": _num(label["LINE_SAMPLES"]),
        "map_scale_m": _num(label["MAP_SCALE"]),
        "map_res_ppd": _num(label["MAP_RESOLUTION"]),
        "center_lat": _num(label["CENTER_LATITUDE"]),
        "center_lon": _num(label["CENTER_LONGITUDE"]),
        "line_offset": _num(label["LINE_PROJECTION_OFFSET"]),
        "sample_offset": _num(label["SAMPLE_PROJECTION_OFFSET"]),
        "radius_m": _num(label["A_AXIS_RADIUS"]) * 1000.0,
        "min_lat": _num(label["MINIMUM_LATITUDE"]),
        "max_lat": _num(label["MAXIMUM_LATITUDE"]),
        "west_lon": _num(label["WESTERNMOST_LONGITUDE"]),
        "east_lon": _num(label["EASTERNMOST_LONGITUDE"]),
    }


if __name__ == "__main__":
    import sys

    p = Path(sys.argv[1])
    lab = read_label(p)
    for k in [
        "RECORD_BYTES", "LABEL_RECORDS", "^IMAGE", "LINES", "LINE_SAMPLES", "SAMPLE_TYPE",
        "SAMPLE_BITS", "MISSING_CONSTANT", "VALID_MINIMUM", "VALID_MAXIMUM", "MAP_PROJECTION_TYPE",
        "PROJECTION_LATITUDE_TYPE", "A_AXIS_RADIUS", "C_AXIS_RADIUS", "POSITIVE_LONGITUDE_DIRECTION",
        "CENTER_LATITUDE", "CENTER_LONGITUDE", "LINE_PROJECTION_OFFSET", "SAMPLE_PROJECTION_OFFSET",
        "MAP_SCALE", "MAP_RESOLUTION", "MINIMUM_LATITUDE", "MAXIMUM_LATITUDE",
        "WESTERNMOST_LONGITUDE", "EASTERNMOST_LONGITUDE",
    ]:
        print(f"{k:32s} {lab.get(k)}")
