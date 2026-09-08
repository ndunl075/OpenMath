"""The manifest: one JSONL row per rendered sample.

Everything downstream reads this rather than re-walking the datasets, so a
prepare step can be rerun for one source without touching the others, and a
reviewer can grep the labels without a GPU or a copy of the images.

Rejected samples are written too, with a `reject` reason. Silently dropping rows
is how a dataset ends up 40% smaller than you think it is.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator

MANIFEST_VERSION = 1


@dataclass
class Sample:
    sample_id: str
    source: str
    #: "train" | "val" | "test", as the source dataset labelled it.
    split: str
    #: Path to the rendered PNG, relative to the manifest's directory.
    image: str
    #: The training label: whitespace-separated Texo tokens.
    text: str
    #: What the dataset shipped, before any of our processing.
    raw_label: str
    #: After normalize.py, before tokenisation.
    normalized: str
    n_tokens: int
    unknown: list[str] = field(default_factory=list)
    in_app_scope: bool = False
    width: int = 0
    height: int = 0
    #: None when usable; otherwise why this row should not be trained on.
    reject: str | None = None


def write_manifest(path: Path | str, samples: Iterator[Sample] | list[Sample]) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for sample in samples:
            handle.write(json.dumps(asdict(sample), ensure_ascii=False) + "\n")
            count += 1
    return count


def read_manifest(path: Path | str) -> Iterator[Sample]:
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            yield Sample(**json.loads(line))


def summarise(samples: list[Sample]) -> dict[str, object]:
    kept = [s for s in samples if s.reject is None]
    rejects: dict[str, int] = {}
    for sample in samples:
        if sample.reject:
            rejects[sample.reject] = rejects.get(sample.reject, 0) + 1
    splits: dict[str, int] = {}
    for sample in kept:
        splits[sample.split] = splits.get(sample.split, 0) + 1
    token_counts = sorted(s.n_tokens for s in kept)
    return {
        "manifest_version": MANIFEST_VERSION,
        "total": len(samples),
        "kept": len(kept),
        "rejected": len(samples) - len(kept),
        "reject_reasons": rejects,
        "splits": splits,
        "in_app_scope": sum(1 for s in kept if s.in_app_scope),
        "tokens_median": token_counts[len(token_counts) // 2] if token_counts else 0,
        "tokens_p95": token_counts[int(len(token_counts) * 0.95)] if token_counts else 0,
        "tokens_max": token_counts[-1] if token_counts else 0,
    }


def write_summary(path: Path | str, summary: dict[str, object]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
