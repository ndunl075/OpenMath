#!/usr/bin/env python3
"""HME100K -> normalised images + Texo labels + manifest.

Secondary source, and the only one of the three that is already photographs:
~100k camera images of handwritten expressions from real writers, on real
paper, with real lighting. That makes it the closest match to what OpenMath's
camera actually sees, which is exactly the gap rendered strokes leave open. If
you can only prepare one secondary source, prepare this one.

There is nothing to rasterise here, so this script only copies, converts to
grayscale PNG, and builds labels.

    python prepare_hme100k.py --images /path/to/HME100K/train/images \\
        --labels /path/to/HME100K/train/caption.txt \\
        --out data/prepared/hme100k --split train --texo-root ../../../Texo

UNVERIFIED, and more so than the other two:

  - HME100K is distributed from https://ai.100tal.com/dataset behind a
    registration form (the CAN repository, github.com/LBH1024/CAN, points there
    too). Nothing here was checked against a real copy.
  - The label file layout is a guess. It is parsed as one record per line,
    `<image name><separator><latex>`, with the separator auto-detected as tab if
    any line contains one and whitespace otherwise. Published HMER code tends to
    use `name latex tokens...` space-separated. If your copy differs, use
    --separator, or --json if it ships JSON lines with keys named by
    --json-image-key / --json-label-key.
  - Image extension is resolved by trying the name as given, then .jpg, .png,
    .jpeg. Adjust --extensions if needed.

Run with --dry-run first: it prints the first few parsed records and stops.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

from openmath_finetune.cli import (  # noqa: E402
    add_label_args,
    tables_from_args,
    vocab_from_args,
)
from openmath_finetune.label import build_label  # noqa: E402
from openmath_finetune.manifest import Sample, summarise, write_manifest, write_summary  # noqa: E402

DEFAULT_EXTENSIONS = (".jpg", ".png", ".jpeg")


def parse_labels(
    path: Path,
    separator: str | None,
    as_json: bool,
    image_key: str,
    label_key: str,
) -> list[tuple[str, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    records: list[tuple[str, str]] = []

    if as_json:
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            records.append((str(row[image_key]), str(row[label_key])))
        return records

    if separator is None:
        separator = "\t" if "\t" in text else None  # None means "split on any whitespace"

    for line in text.splitlines():
        line = line.rstrip("\n")
        if not line.strip():
            continue
        parts = line.split(separator, 1) if separator else line.split(None, 1)
        if len(parts) != 2:
            continue
        records.append((parts[0].strip(), parts[1].strip()))
    return records


def resolve_image(images_dir: Path, name: str, extensions: tuple[str, ...]) -> Path | None:
    candidate = images_dir / name
    if candidate.is_file():
        return candidate
    stem = candidate.with_suffix("")
    for extension in extensions:
        alternative = stem.with_suffix(extension)
        if alternative.is_file():
            return alternative
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--split", default="train", choices=["train", "val", "test"])
    parser.add_argument("--separator", default=None,
                        help="Field separator in the label file. Default: tab if present, "
                             "otherwise the first run of whitespace.")
    parser.add_argument("--json", dest="as_json", action="store_true",
                        help="Label file is JSON Lines.")
    parser.add_argument("--json-image-key", default="filename")
    parser.add_argument("--json-label-key", default="label")
    parser.add_argument("--extensions", default=",".join(DEFAULT_EXTENSIONS))
    parser.add_argument("--max-side", type=int, default=1024,
                        help="Downscale the long edge to this before storing. Texo squeezes "
                             "everything into 384x384 anyway.")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the first parsed records and stop. Use this first.")
    add_label_args(parser)
    args = parser.parse_args()

    extensions = tuple(e if e.startswith(".") else f".{e}" for e in args.extensions.split(","))
    records = parse_labels(args.labels, args.separator, args.as_json,
                           args.json_image_key, args.json_label_key)
    if args.limit:
        records = records[: args.limit]
    if not records:
        print(f"no records parsed from {args.labels}", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"{len(records)} records parsed from {args.labels}")
        for name, label in records[:5]:
            resolved = resolve_image(args.images, name, extensions)
            print(f"  {name!r} -> {resolved} | {label[:100]!r}")
        return 0

    out: Path = args.out
    (out / "images" / "hme100k").mkdir(parents=True, exist_ok=True)
    vocab = vocab_from_args(args)
    tables = tables_from_args(args)

    samples: list[Sample] = []
    for index, (name, raw) in enumerate(records, start=1):
        stem = Path(name).stem
        result = build_label(
            raw,
            vocab,
            tables=tables,
            max_tokens=args.max_tokens,
            min_tokens=args.min_tokens,
            allow_unknown=args.allow_unknown,
            require_app_scope=args.require_app_scope,
        )
        sample = Sample(
            sample_id=stem,
            source="hme100k",
            split=args.split,
            image="",
            text=result.text,
            raw_label=raw,
            normalized=result.normalized,
            n_tokens=len(result.tokens),
            unknown=result.unknown[:16],
            in_app_scope=result.in_scope,
            reject=result.reject,
        )

        if not sample.reject:
            source_path = resolve_image(args.images, name, extensions)
            if source_path is None:
                sample.reject = "image-missing"
            else:
                try:
                    with Image.open(source_path) as image:
                        image = image.convert("L")
                        if max(image.size) > args.max_side:
                            image.thumbnail((args.max_side, args.max_side),
                                            Image.Resampling.LANCZOS)
                        relative = Path("images") / "hme100k" / f"{stem}.png"
                        image.save(out / relative, format="PNG", optimize=True)
                        sample.image = str(relative)
                        sample.width, sample.height = image.size
                except Exception as error:
                    sample.reject = f"image-error:{type(error).__name__}"

        samples.append(sample)
        if index % 2000 == 0:
            print(f"\r  {index}/{len(records)}", end="", file=sys.stderr)
    print(file=sys.stderr)

    manifest_path = out / "manifest.jsonl"
    write_manifest(manifest_path, samples)
    summary = summarise(samples)
    summary["source"] = "hme100k"
    write_summary(out / "summary.json", summary)
    print(f"wrote {manifest_path}")
    print(f"kept {summary['kept']}/{summary['total']}; rejects: {summary['reject_reasons']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
