from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend" / "assets"
SOURCE = ASSETS / "bamboo-curtain-source.png"
GIF_OUTPUT = ASSETS / "bamboo-curtain-unroll.gif"
WEBP_OUTPUT = ASSETS / "bamboo-curtain-unroll.webp"

WIDTH = 1288
HEIGHT = 808
ROLL_HEIGHT = 92
FRAME_COUNT = 24


def smoothstep(value: float) -> float:
    return value * value * (3.0 - 2.0 * value)


source = Image.open(SOURCE).convert("RGBA")
curtain = source.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
body_height = HEIGHT - ROLL_HEIGHT
body = curtain.crop((0, 0, WIDTH, body_height))
roll = curtain.crop((0, body_height, WIDTH, HEIGHT))

frames: list[Image.Image] = []
for index in range(FRAME_COUNT):
    progress = smoothstep(index / (FRAME_COUNT - 1))
    reveal_height = round(body_height * progress)
    frame = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))

    if reveal_height:
        revealed = body.crop((0, 0, WIDTH, reveal_height))
        frame.alpha_composite(revealed, (0, 0))

    frame.alpha_composite(roll, (0, reveal_height))
    frames.append(frame)

# Animated WebP keeps smooth alpha around the bamboo and in the slat gaps.
durations = [80] * (FRAME_COUNT - 1) + [1100]
frames[0].save(
    WEBP_OUTPUT,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=1,
    quality=90,
    method=3,
)

# The GIF fallback is half-resolution but keeps exactly the same aspect ratio.
gif_size = (WIDTH // 2, HEIGHT // 2)
gif_rgba_frames = [frame.resize(gif_size, Image.Resampling.LANCZOS) for frame in frames]
palette = gif_rgba_frames[-1].convert("RGB").convert(
    "P", palette=Image.Palette.ADAPTIVE, colors=255
)
gif_frames: list[Image.Image] = []
for frame in gif_rgba_frames:
    indexed = frame.convert("RGB").quantize(palette=palette)
    transparent = frame.getchannel("A").point(lambda alpha: 255 if alpha < 96 else 0)
    indexed.paste(255, mask=transparent)
    gif_frames.append(indexed)

gif_frames[0].save(
    GIF_OUTPUT,
    save_all=True,
    append_images=gif_frames[1:],
    duration=durations,
    loop=1,
    transparency=255,
    disposal=2,
    optimize=True,
)

print(GIF_OUTPUT)
print(WEBP_OUTPUT)
