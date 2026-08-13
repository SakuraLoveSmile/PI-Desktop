#!/usr/bin/env python3
"""Strip the magenta chroma-key residue from the home mascot sprite sheet.

The supplied mascot frames were drawn over a pure magenta background and keyed
out with a hard alpha threshold. Every pixel the character only partially
covers therefore stayed fully opaque with the key colour still blended into it,
which reads as a purple outline against the dark theme.

The artwork is monochrome, so a partially covered pixel is
``alpha * grey + (1 - alpha) * key`` with ``key = (255, 0, 255)``. Green carries
none of the key, so the red/blue excess over green recovers the coverage and
green itself recovers the original grey. That restores the antialiased alpha the
threshold discarded instead of merely hiding the tint.

Idempotent: a cleaned sheet has no key excess left to remove.

Run: python3 scripts/clean-mascot-sprite.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "apps" / "desktop" / "src" / "assets" / "home-mascot-groups.png"

# Red and blue channels of the key; green is 0, which is what makes the
# recovery possible.
KEY_CHANNEL = 255
# Below this the excess is resampling noise rather than key colour, and
# dividing by an alpha of ~1 would only churn the pixel.
EXCESS_FLOOR = 2
# A pixel this thinly covered is background the threshold should have dropped.
MIN_COVERAGE = 0.05


def main() -> None:
    sheet = Image.open(SHEET).convert("RGBA")
    width, height = sheet.size
    pixels = sheet.load()

    recovered = 0
    dropped = 0
    neutralised = 0

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue

            excess = ((red - green) + (blue - green)) / 2
            if excess < EXCESS_FLOOR:
                # Already clean; snap off the last bit of resampling chroma so
                # the sheet is exactly neutral.
                grey = round((red + green + blue) / 3)
                if (red, green, blue) != (grey, grey, grey):
                    pixels[x, y] = (grey, grey, grey, alpha)
                    neutralised += 1
                continue

            coverage = 1 - excess / KEY_CHANNEL
            if coverage < MIN_COVERAGE:
                pixels[x, y] = (0, 0, 0, 0)
                dropped += 1
                continue

            grey = min(255, round(green / coverage))
            pixels[x, y] = (grey, grey, grey, round(coverage * 255))
            recovered += 1

    sheet.save(SHEET)
    print(f"{SHEET.relative_to(ROOT)}: {width // height} frames")
    print(f"  recovered edge pixels: {recovered}")
    print(f"  dropped background pixels: {dropped}")
    print(f"  neutralised chroma noise: {neutralised}")


if __name__ == "__main__":
    main()
