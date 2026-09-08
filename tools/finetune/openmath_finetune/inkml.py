"""InkML reading for the online-handwriting datasets.

MathWriting and CROHME both ship *stroke* data, not images. That is the easiest
thing to miss about them: there is nothing to feed a vision model until the
strokes have been rasterised (see render.py).

The MathWriting schema below was read off the real files in
mathwriting-2024-excerpt.tgz, so it is verified rather than assumed:

    <ink xmlns="http://www.w3.org/2003/InkML">
      <annotation type="label">\\vartheta =-\\frac{...}</annotation>
      <annotation type="normalizedLabel">\\vartheta=-\\frac{...}</annotation>
      <annotation type="splitTagOriginal">train</annotation>
      <annotation type="inkCreationMethod">human</annotation>
      <annotation type="sampleId">000aa4c444cba3f2</annotation>
      <traceFormat>
        <channel name="X" type="decimal"/>
        <channel name="Y" type="decimal"/>
        <channel name="T" type="decimal" units="ms"/>
      </traceFormat>
      <trace id="0">901.72 479.26 0.0,900.52 482.87 12.0,...</trace>
    </ink>

CROHME's InkML is the same container with different annotations (the ground
truth lives in `type="truth"` and is usually wrapped in $...$), no T channel,
and per-symbol <traceGroup> segmentation that this reader ignores. That reading
of CROHME is from memory of the format, not from an inspected file -- see the
README's "Unverified assumptions".
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

Point = tuple[float, float]
Stroke = list[Point]

_NUMBER = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


@dataclass
class Ink:
    annotations: dict[str, str]
    strokes: list[Stroke]
    source_path: Path

    @property
    def sample_id(self) -> str:
        return self.annotations.get("sampleId") or self.source_path.stem

    def label(self, field: str, fallbacks: tuple[str, ...] = ()) -> str | None:
        for name in (field, *fallbacks):
            value = self.annotations.get(name)
            if value:
                return value
        return None


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_trace(text: str, x_index: int, y_index: int) -> Stroke:
    stroke: Stroke = []
    for chunk in text.split(","):
        numbers = _NUMBER.findall(chunk)
        if len(numbers) <= max(x_index, y_index):
            continue
        stroke.append((float(numbers[x_index]), float(numbers[y_index])))
    return stroke


def parse_inkml(path: Path | str) -> Ink:
    """Read one InkML file. Namespace-agnostic, so CROHME variants parse too."""
    path = Path(path)
    root = ET.parse(path).getroot()

    annotations: dict[str, str] = {}
    channels: list[str] = []
    strokes: list[Stroke] = []

    for element in root.iter():
        name = _localname(element.tag)
        if name == "annotation":
            key = element.get("type")
            if key:
                annotations[key] = (element.text or "").strip()
        elif name == "channel":
            channel = element.get("name")
            if channel:
                channels.append(channel.upper())

    # Channel order is declared, not fixed: honour traceFormat when present and
    # fall back to "first two numbers are X and Y", which is what CROHME does.
    x_index = channels.index("X") if "X" in channels else 0
    y_index = channels.index("Y") if "Y" in channels else 1

    for element in root.iter():
        if _localname(element.tag) != "trace":
            continue
        stroke = _parse_trace(element.text or "", x_index, y_index)
        if len(stroke) >= 1:
            strokes.append(stroke)

    return Ink(annotations=annotations, strokes=strokes, source_path=path)


def strip_math_delimiters(label: str) -> str:
    """CROHME truth strings arrive as `$ \\frac{1}{2} $`."""
    return label.strip().strip("$").strip()


def iter_inkml(root: Path | str) -> list[Path]:
    """Every .inkml under `root`, sorted, so runs are reproducible."""
    return sorted(Path(root).rglob("*.inkml"))
