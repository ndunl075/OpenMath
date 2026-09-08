"""Rasterise handwriting strokes into the images Texo trains on.

Texo sees images. MathWriting and CROHME are pen trajectories. Everything about
recognition quality that this repository controls, other than the labels, is
decided here.

Two choices are worth explaining:

*Stroke width.* MathWriting's readme says "brush size is not specified, but a
round shape of radius 1.5 is a reasonable value for most inks". Coordinates are
raw device pixels and vary hugely between contributors, so the width is scaled
by the same factor as the coordinates. That keeps the *ratio* of stroke width to
glyph size constant, which is the thing the model actually sees.

*Anti-aliasing.* PIL's ImageDraw does not anti-alias, and hard binary edges are
not what a phone camera produces. Strokes are drawn at `supersample`x and
resampled down, which costs memory but produces grey edges.

What this does NOT reproduce is a photograph: no paper texture, no shadow, no
lens blur, no ink bleed. Texo's own TrainMERImageProcessor applies exactly that
family of augmentations (Bitmap, Dilation, Erosion, Fog, Frost, Rain, Shadow)
during training, so the augmentation is deliberately left to it rather than
being duplicated here. `blur_sigma` exists only for experiments.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter

from .inkml import Stroke


@dataclass
class RenderConfig:
    #: Bounds before margin. Texo squeezes everything into 384x384 anyway, so
    #: rendering much larger than this only costs disk and preprocessing time.
    max_width: int = 1024
    max_height: int = 320
    margin: int = 16
    #: Stroke diameter in ink-space units (readme: round brush of radius 1.5).
    stroke_units: float = 3.0
    #: Floor, so a heavily downscaled ink does not render as invisible hairlines.
    min_stroke_px: float = 1.6
    #: Ceiling on upscale, so a 20-unit-wide ink does not become a blurry poster.
    max_scale: float = 8.0
    supersample: int = 4
    blur_sigma: float = 0.0
    background: int = 255
    ink: int = 0


class EmptyInkError(ValueError):
    """No drawable points, so there is nothing to train on."""


def render_strokes(strokes: list[Stroke], config: RenderConfig | None = None) -> Image.Image:
    cfg = config or RenderConfig()
    points = [p for stroke in strokes for p in stroke]
    if not points:
        raise EmptyInkError("ink has no points")

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)

    scale = min(cfg.max_width / span_x, cfg.max_height / span_y, cfg.max_scale)
    if not math.isfinite(scale) or scale <= 0:
        raise EmptyInkError("ink bounding box is degenerate")

    stroke_px = max(cfg.min_stroke_px, cfg.stroke_units * scale)
    ss = max(1, cfg.supersample)

    width = int(math.ceil(span_x * scale)) + 2 * cfg.margin
    height = int(math.ceil(span_y * scale)) + 2 * cfg.margin
    image = Image.new("L", (width * ss, height * ss), cfg.background)
    draw = ImageDraw.Draw(image)

    line_px = max(1, int(round(stroke_px * ss)))
    radius = line_px / 2

    for stroke in strokes:
        mapped = [
            (
                (x - min_x) * scale * ss + cfg.margin * ss,
                (y - min_y) * scale * ss + cfg.margin * ss,
            )
            for x, y in stroke
        ]
        if len(mapped) == 1:
            cx, cy = mapped[0]
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=cfg.ink)
            continue
        # joint="curve" rounds the interior corners; the caps are drawn by hand
        # because ImageDraw only offers butt ends.
        draw.line(mapped, fill=cfg.ink, width=line_px, joint="curve")
        for cx, cy in (mapped[0], mapped[-1]):
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=cfg.ink)

    if ss > 1:
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    if cfg.blur_sigma > 0:
        image = image.filter(ImageFilter.GaussianBlur(cfg.blur_sigma))
    return image


def encode_png(image: Image.Image) -> bytes:
    """PNG bytes, which is what Texo's MERDatasetHF reads out of the `image` column."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
