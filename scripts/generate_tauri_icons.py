#!/usr/bin/env python3
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
ICONSET_DIR = ICONS_DIR / "AppIcon.iconset"


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _clamp_u8(value: float) -> int:
    return max(0, min(255, int(value)))


def _render_rgba(size: int) -> bytes:
    if size <= 0:
        raise ValueError("size must be positive")

    buf = bytearray()
    size_f = float(size - 1 if size > 1 else 1)

    l_x = int(size * 0.26)
    l_y = int(size * 0.20)
    l_thickness = max(2, int(size * 0.12))
    l_height = int(size * 0.60)
    l_width = int(size * 0.48)

    corner_radius = size * 0.18
    cx = (size - 1) / 2.0
    cy = (size - 1) / 2.0
    radius = size * 0.48

    for y in range(size):
        row = bytearray([0])
        ny = y / size_f
        for x in range(size):
            nx = x / size_f

            # Deep Loyu blue gradient base.
            base_r = _clamp_u8(6 + 8 * nx + 4 * ny)
            base_g = _clamp_u8(19 + 26 * nx + 6 * (1.0 - ny))
            base_b = _clamp_u8(35 + 48 * nx + 22 * ny)

            # Soft top-right highlight.
            hdx = nx - 0.78
            hdy = ny - 0.16
            highlight = math.exp(-((hdx * hdx * 18.0) + (hdy * hdy * 30.0)))

            r = _clamp_u8(base_r + 56 * highlight)
            g = _clamp_u8(base_g + 74 * highlight)
            b = _clamp_u8(base_b + 116 * highlight)
            a = 255

            # Rounded icon edges.
            dist = math.hypot(x - cx, y - cy)
            if dist > radius:
                fade = max(0.0, 1.0 - (dist - radius) / max(1.0, corner_radius))
                a = _clamp_u8(255 * fade)

            in_vertical = l_x <= x <= l_x + l_thickness and l_y <= y <= l_y + l_height
            in_bottom = l_x <= x <= l_x + l_width and l_y + l_height - l_thickness <= y <= l_y + l_height

            if in_vertical or in_bottom:
                # Subtle metallic white for monogram.
                glow = 0.35 + 0.65 * (1.0 - ny)
                r = _clamp_u8(232 + 22 * glow)
                g = _clamp_u8(240 + 14 * glow)
                b = _clamp_u8(255)
                a = 255

            row.extend((r, g, b, a))
        buf.extend(row)

    return bytes(buf)


def write_png(path: Path, size: int) -> None:
    raw = _render_rgba(size)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, level=9)

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(_png_chunk(b"IHDR", ihdr))
    png.extend(_png_chunk(b"IDAT", idat))
    png.extend(_png_chunk(b"IEND", b""))

    path.write_bytes(bytes(png))


def write_ico(path: Path, png_path: Path) -> None:
    png_data = png_path.read_bytes()
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png_data), 6 + 16)
    path.write_bytes(header + entry + png_data)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for s in sizes:
        write_png(ICONS_DIR / f"AppIcon-{s}.png", s)

    app_icon_png = ICONS_DIR / "AppIcon.png"
    app_icon_png.write_bytes((ICONS_DIR / "AppIcon-1024.png").read_bytes())

    # Common Tauri icon aliases.
    (ICONS_DIR / "32x32.png").write_bytes((ICONS_DIR / "AppIcon-32.png").read_bytes())
    (ICONS_DIR / "128x128.png").write_bytes((ICONS_DIR / "AppIcon-128.png").read_bytes())
    (ICONS_DIR / "128x128@2x.png").write_bytes((ICONS_DIR / "AppIcon-256.png").read_bytes())
    (ICONS_DIR / "icon.png").write_bytes((ICONS_DIR / "AppIcon-512.png").read_bytes())

    # ICO (PNG-compressed entry, supported by Windows Vista+).
    write_ico(ICONS_DIR / "AppIcon.ico", ICONS_DIR / "AppIcon-256.png")
    (ICONS_DIR / "icon.ico").write_bytes((ICONS_DIR / "AppIcon.ico").read_bytes())

    # ICNS via iconutil (macOS).
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)
    mapping = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in mapping.items():
        (ICONSET_DIR / name).write_bytes((ICONS_DIR / f"AppIcon-{size}.png").read_bytes())

    # Keep subprocess usage simple and explicit.
    import subprocess

    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(ICONS_DIR / "AppIcon.icns")],
            check=True,
            capture_output=True,
        )
        (ICONS_DIR / "icon.icns").write_bytes((ICONS_DIR / "AppIcon.icns").read_bytes())
    except subprocess.CalledProcessError:
        # Some environments reject generated iconsets; keep PNG/ICO outputs usable.
        # If `icon.icns` already exists (e.g. generated by `tauri icon`), keep it.
        existing = ICONS_DIR / "icon.icns"
        if existing.exists():
            (ICONS_DIR / "AppIcon.icns").write_bytes(existing.read_bytes())
        else:
            print("warning: iconutil failed and no existing icon.icns found.")


if __name__ == "__main__":
    main()
