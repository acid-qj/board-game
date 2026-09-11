import math
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets"
SOURCE = ASSETS / "bamboo-grove-source.png"
WEBP_OUTPUT = ASSETS / "bamboo-grove-breeze.webp"
GIF_OUTPUT = ASSETS / "bamboo-grove-breeze.gif"

WIDTH = 1288
HEIGHT = 808
FOREST_HEIGHT = round(HEIGHT * 2 / 3)
OVERSCAN = 20
FRAME_COUNT = 30


source = Image.open(SOURCE).convert("RGB")
base = ImageOps.fit(source, (WIDTH, HEIGHT), Image.Resampling.LANCZOS)
wide = ImageOps.fit(
    source,
    (WIDTH + OVERSCAN * 2, HEIGHT),
    Image.Resampling.LANCZOS,
)
forest_source = wide.crop((0, 0, wide.width, FOREST_HEIGHT))
water_source = wide.crop((0, FOREST_HEIGHT, wide.width, HEIGHT))

frames: list[Image.Image] = []
for index in range(FRAME_COUNT):
    phase = 2 * math.pi * index / FRAME_COUNT
    sway = 7.0 * math.sin(phase)

    # Source sampling moves most at the canopy and converges to the original
    # position at the forest floor, giving the bamboo a rooted swaying motion.
    forest = forest_source.transform(
        (WIDTH, FOREST_HEIGHT),
        Image.Transform.AFFINE,
        (
            1,
            sway / FOREST_HEIGHT,
            OVERSCAN - sway,
            0,
            1,
            0,
        ),
        resample=Image.Resampling.BICUBIC,
    )

    frame = base.copy()
    frame.paste(forest, (0, 0))

    # Shift narrow water bands by different amounts for a gentle flowing
    # reflection while keeping rocks and the riverbank visually stable.
    water_height = HEIGHT - FOREST_HEIGHT
    rippled = Image.new("RGB", (WIDTH, water_height))
    band_height = 4
    for top in range(0, water_height, band_height):
        bottom = min(top + band_height, water_height)
        wave = round(
            3.0 * math.sin(phase * 1.35 + top * 0.075)
            + 1.2 * math.sin(phase * 0.7 - top * 0.035)
        )
        band = water_source.crop(
            (OVERSCAN + wave, top, OVERSCAN + wave + WIDTH, bottom)
        )
        rippled.paste(band, (0, top))

    original_water = base.crop((0, FOREST_HEIGHT, WIDTH, HEIGHT))
    water = Image.blend(original_water, rippled, 0.42)
    frame.paste(water, (0, FOREST_HEIGHT))
    frames.append(frame)

duration = 90
frames[0].save(
    WEBP_OUTPUT,
    save_all=True,
    append_images=frames[1:],
    duration=duration,
    loop=0,
    quality=88,
    method=3,
)

# The GIF fallback is half-resolution and preserves the 1288:808 aspect ratio.
gif_size = (WIDTH // 2, HEIGHT // 2)
gif_rgb_frames = [frame.resize(gif_size, Image.Resampling.LANCZOS) for frame in frames]
palette = gif_rgb_frames[0].convert(
    "P", palette=Image.Palette.ADAPTIVE, colors=256
)
gif_frames = [frame.quantize(palette=palette) for frame in gif_rgb_frames]
gif_frames[0].save(
    GIF_OUTPUT,
    save_all=True,
    append_images=gif_frames[1:],
    duration=duration,
    loop=0,
    disposal=1,
    optimize=True,
)

print(WEBP_OUTPUT)
print(GIF_OUTPUT)
