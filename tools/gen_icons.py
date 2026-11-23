#!/usr/bin/env python3
"""Generate the extension icons (16/32/48/128 px) from a single vector-like drawing.

Run:  python3 tools/gen_icons.py
Requires Pillow (`pip install Pillow`).
"""

from PIL import Image, ImageDraw

OUT_DIR = "icons"
SIZES = [16, 32, 48, 128]
BASE = 512

ACCENT = (56, 189, 248, 255)  # #38bdf8
DARK = (15, 23, 42, 255)  # #0f172a
WHITE = (255, 255, 255, 255)


def draw(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=ACCENT)

    # The "paywall": two dark bars with a gap in the middle.
    wall_top = int(s * 0.38)
    wall_bottom = int(s * 0.62)
    left_right = int(s * 0.34)
    right_left = int(s * 0.66)

    d.rectangle([int(s * 0.08), wall_top, left_right, wall_bottom], fill=DARK)
    d.rectangle([right_left, wall_top, int(s * 0.92), wall_bottom], fill=DARK)

    # A right-pointing arrow passing through the gap.
    gap_mid_y = (wall_top + wall_bottom) // 2
    apex_x = int(s * 0.78)
    base_x = int(s * 0.56)
    half_h = int(s * 0.20)
    d.polygon(
        [(base_x, gap_mid_y - half_h), (base_x, gap_mid_y + half_h), (apex_x, gap_mid_y)],
        fill=WHITE,
    )

    return img


def main() -> None:
    import os

    os.makedirs(OUT_DIR, exist_ok=True)
    master = draw(BASE)
    for size in SIZES:
        icon = master.resize((size, size), Image.Resampling.LANCZOS)
        path = f"{OUT_DIR}/icon{size}.png"
        icon.save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
