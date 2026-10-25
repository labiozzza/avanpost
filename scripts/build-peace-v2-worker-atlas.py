#!/usr/bin/env python3
"""Normalize the V2 project's generated pose art into a shared-pivot Phaser atlas."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps/client-v2/public/assets/peace-v2"
FRAME_WIDTH = 192
FRAME_HEIGHT = 224
FOOTLINE = 214
TARGET_HEIGHT = 178
SHEET_CELL_WIDTH = 519
SHEET_CELL_HEIGHT = 756


def frame_from_image(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value > 24 else 0)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("worker sprite frame has no visible pixels")
    sprite = rgba.crop(bounds)
    width = max(1, round(sprite.width * TARGET_HEIGHT / sprite.height))
    sprite = sprite.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0))
    x = (FRAME_WIDTH - width) // 2
    y = FOOTLINE - TARGET_HEIGHT
    frame.alpha_composite(sprite, (x, y))
    return frame


def horizontal_frames(filename: str, frame_count: int) -> list[Image.Image]:
    sheet = Image.open(ASSETS / filename).convert("RGBA")
    if sheet.height != SHEET_CELL_HEIGHT or sheet.width < SHEET_CELL_WIDTH * frame_count:
        raise ValueError(f"unexpected dimensions in {filename}: {sheet.size}")
    return [
        frame_from_image(sheet.crop((index * SHEET_CELL_WIDTH, 0,
                                    (index + 1) * SHEET_CELL_WIDTH, SHEET_CELL_HEIGHT)))
        for index in range(frame_count)
    ]


def main() -> None:
    idle = Image.open(ASSETS / "worker_idle.png")
    chop = Image.open(ASSETS / "worker_chop.png")
    carry_walk = horizontal_frames("worker-carry-walk-sheet-v2.png", 4)
    walk = horizontal_frames("worker-walk-sheet.png", 4)
    build = horizontal_frames("worker-build-sheet.png", 4)

    # Stable frame contract consumed by settlement-scene.ts.
    frames = [
        frame_from_image(idle),       # 0 idle
        frame_from_image(chop),       # 1 axe swing
        carry_walk[1],                # 2 lift/carry pose
        *walk,                        # 3-6 walk
        *carry_walk,                  # 7-10 carry walk
        *build                        # 11-14 hammer work
    ]
    atlas = Image.new("RGBA", (FRAME_WIDTH * len(frames), FRAME_HEIGHT), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, (index * FRAME_WIDTH, 0))
    atlas.save(ASSETS / "worker-atlas.png", optimize=True)


if __name__ == "__main__":
    main()
