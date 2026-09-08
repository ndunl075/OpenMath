#!/usr/bin/env python3
"""MathWriting (Google) -> rendered images + Texo labels + manifest.

MathWriting is the primary source: ~230k human-written expressions plus ~400k
synthetic ones, which is an order of magnitude more handwriting than CROHME.

It is *online* handwriting. Every file is a pen trajectory in InkML, not an
image, so this script rasterises before it can produce anything trainable.

Licence, and it matters: MathWriting is CC BY-NC-SA 4.0 (NonCommercial,
ShareAlike). Weights trained on it inherit at minimum an arguable claim from
that licence. Read the README's licensing section before shipping anything built
from it.

    python prepare_mathwriting.py --excerpt --out data/prepared/mathwriting \\
        --texo-root ../../../Texo

Never executed on the full dataset. See README.
"""

from __future__ import annotations

import argparse
import os
import sys
import tarfile
import urllib.request
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
from openmath_finetune.inkml import iter_inkml  # noqa: E402
from openmath_finetune.manifest import summarise, write_manifest, write_summary  # noqa: E402

# Both URLs returned HTTP 200 while this was written; the full archive is
# 3,096,141,721 bytes and the excerpt 1,620,634.
FULL_URL = "https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz"
EXCERPT_URL = "https://storage.googleapis.com/mathwriting_data/mathwriting-2024-excerpt.tgz"

#: Archive directory -> the split we file it under. From the dataset readme:
#: valid and test are for evaluation, everything else is training data.
SPLIT_MAP = {
    "train": "train",
    "valid": "val",
    "test": "test",
    "synthetic": "train",
    "symbols": "train",
}


def download(url: str, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        print(f"reusing {target}")
        return target
    print(f"downloading {url} -> {target}")
    with urllib.request.urlopen(url) as response, target.open("wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while chunk := response.read(1 << 20):
            handle.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done / total:6.1%} ({done >> 20} MiB)", end="", file=sys.stderr)
    print(file=sys.stderr)
    return target


def extract(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    print(f"extracting {archive} -> {destination}")
    with tarfile.open(archive) as tar:
        # filter="data" refuses absolute paths and symlink escapes. Present from
        # 3.11.4; the fallback is for older 3.11 patch releases only.
        try:
            tar.extractall(destination, filter="data")
        except TypeError:
            tar.extractall(destination)
    roots = [p for p in destination.iterdir() if p.is_dir() and p.name.startswith("mathwriting")]
    return roots[0] if roots else destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--src", type=Path, help="Already-extracted mathwriting-2024 directory.")
    source.add_argument("--archive", type=Path, help="Downloaded .tgz to extract.")
    source.add_argument("--download", action="store_true", help="Fetch the full 3.1 GB archive.")
    source.add_argument("--excerpt", action="store_true",
                        help="Fetch the 1.6 MB, 500-ink excerpt. Smoke-test with this first.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--splits", default="train,valid,test",
                        help="Comma-separated archive directories. Add 'synthetic' for the "
                             "extra ~400k, which are stitched glyphs rather than real "
                             "handwriting, and 'symbols' for single glyphs.")
    parser.add_argument("--label-field", default="label", choices=["label", "normalizedLabel"],
                        help="MathWriting's readme recommends normalizedLabel, but it rewrites "
                             "\\binom into \\begin{matrix} and \\log into a bare 'log', neither "
                             "of which is in Texo's vocabulary. 'label' plus our normalizer "
                             "keeps more rows. Default: label.")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N files per split.")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    add_label_args(parser)
    add_render_args(parser)
    args = parser.parse_args()

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    if args.src:
        root = args.src
    else:
        if args.download or args.excerpt:
            url = EXCERPT_URL if args.excerpt else FULL_URL
            archive = download(url, out / Path(url).name)
        else:
            archive = args.archive
        root = extract(archive, out / "raw")

    wanted = [s.strip() for s in args.splits.split(",") if s.strip()]
    jobs: list[inkjob.InkJob] = []
    for directory in wanted:
        directory_path = root / directory
        if not directory_path.is_dir():
            print(f"warning: {directory_path} missing, skipping", file=sys.stderr)
            continue
        files = iter_inkml(directory_path)
        if args.limit:
            files = files[: args.limit]
        split = SPLIT_MAP.get(directory, "train")
        jobs.extend(inkjob.InkJob(str(p), split, directory) for p in files)

    if not jobs:
        print("nothing to do: no .inkml files found", file=sys.stderr)
        return 1

    print(f"{len(jobs)} inks from {', '.join(wanted)}")

    # symbols/ has no normalizedLabel at all, hence the fallback chain.
    label_fields = (args.label_field, "normalizedLabel", "label")
    samples = inkjob.run(
        jobs,
        source="mathwriting",
        out_dir=out,
        config=render_config_from_args(args),
        vocab=vocab_from_args(args),
        tables=tables_from_args(args),
        options=inkjob.LabelOptions(
            label_fields=label_fields,
            max_tokens=args.max_tokens,
            min_tokens=args.min_tokens,
            allow_unknown=args.allow_unknown,
            require_app_scope=args.require_app_scope,
        ),
        workers=args.workers,
    )

    manifest_path = out / "manifest.jsonl"
    write_manifest(manifest_path, samples)
    summary = summarise(samples)
    summary["source"] = "mathwriting"
    summary["label_field"] = args.label_field
    summary["licence"] = "CC BY-NC-SA 4.0"
    write_summary(out / "summary.json", summary)
    print(f"wrote {manifest_path}")
    print(f"kept {summary['kept']}/{summary['total']}; rejects: {summary['reject_reasons']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
