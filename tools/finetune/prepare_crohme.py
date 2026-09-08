#!/usr/bin/env python3
"""CROHME -> rendered images + Texo labels + manifest.

Secondary source. CROHME is small next to MathWriting (~10k training
expressions across the 2014/2016/2019 releases) and its expressions skew towards
competition material rather than homework, but it is the benchmark everyone
else reports on, so having it in the mix makes results comparable.

Like MathWriting it is online handwriting in InkML, so it goes through the same
rasteriser.

    python prepare_crohme.py --src /path/to/CROHME --out data/prepared/crohme \\
        --texo-root ../../../Texo

UNVERIFIED, and the most likely thing to need fixing on first run:

  - There is no stable download URL. The original TC11 host is gone; copies
    circulate through the CROHME 2019 organisers, Zenodo mirrors and the CAN
    repository's BaiduYun link (github.com/LBH1024/CAN). Acquire it yourself and
    point --src at whatever you get, which is why this script only globs.
  - The ground truth is read from <annotation type="truth">, wrapped in $...$.
    That is how the format is documented, but no CROHME file was inspected while
    writing this. If labels come out empty, run with --dump-annotations to see
    which annotation types your copy actually uses, then pass --label-field.
  - Some releases ship per-symbol <traceGroup> segmentation. parse_inkml ignores
    it and reads every <trace>, which is what we want for whole expressions.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from openmath_finetune import inkjob  # noqa: E402
from openmath_finetune.cli import (  # noqa: E402
    add_label_args,
    add_render_args,
    render_config_from_args,
    tables_from_args,
    vocab_from_args,
)
from openmath_finetune.inkml import iter_inkml, parse_inkml  # noqa: E402
from openmath_finetune.manifest import summarise, write_manifest, write_summary  # noqa: E402


def guess_split(path: Path, default: str) -> str:
    """CROHME distributions encode the split in directory names, not metadata."""
    lowered = str(path).lower()
    if "test" in lowered:
        return "test"
    if "valid" in lowered:
        return "val"
    return default


def dump_annotations(files: list[Path], limit: int) -> None:
    counter: Counter[str] = Counter()
    for path in files[:limit]:
        try:
            ink = parse_inkml(path)
        except Exception:
            continue
        counter.update(ink.annotations.keys())
    print(f"annotation types across {min(limit, len(files))} files:")
    for key, count in counter.most_common():
        print(f"  {key}: {count}")
    if files:
        sample = parse_inkml(files[0])
        print(f"\nfirst file {files[0].name}:")
        for key, value in sample.annotations.items():
            print(f"  {key} = {value[:120]!r}")
        print(f"  strokes: {len(sample.strokes)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, required=True,
                        help="Any directory; every .inkml underneath is used.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--label-field", default="truth",
                        help="InkML annotation type holding the ground truth (default: truth).")
    parser.add_argument("--default-split", default="train", choices=["train", "val", "test"])
    parser.add_argument("--dump-annotations", action="store_true",
                        help="Print the annotation types present and exit. Run this first.")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    add_label_args(parser)
    add_render_args(parser)
    args = parser.parse_args()

    files = iter_inkml(args.src)
    if args.limit:
        files = files[: args.limit]
    if not files:
        print(f"no .inkml files under {args.src}", file=sys.stderr)
        return 1

    if args.dump_annotations:
        dump_annotations(files, 200)
        return 0

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    print(f"{len(files)} inks under {args.src}")

    jobs = [
        inkjob.InkJob(str(path), guess_split(path, args.default_split), "crohme")
        for path in files
    ]

    samples = inkjob.run(
        jobs,
        source="crohme",
        out_dir=out,
        config=render_config_from_args(args),
        vocab=vocab_from_args(args),
        tables=tables_from_args(args),
        options=inkjob.LabelOptions(
            label_fields=(args.label_field, "truth", "label", "normalizedLabel"),
            max_tokens=args.max_tokens,
            min_tokens=args.min_tokens,
            allow_unknown=args.allow_unknown,
            require_app_scope=args.require_app_scope,
            strip_dollars=True,
        ),
        workers=args.workers,
    )

    manifest_path = out / "manifest.jsonl"
    write_manifest(manifest_path, samples)
    summary = summarise(samples)
    summary["source"] = "crohme"
    summary["label_field"] = args.label_field
    write_summary(out / "summary.json", summary)
    print(f"wrote {manifest_path}")
    print(f"kept {summary['kept']}/{summary['total']}; rejects: {summary['reject_reasons']}")
    if summary["kept"] == 0:
        print("every row was rejected: run again with --dump-annotations", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
