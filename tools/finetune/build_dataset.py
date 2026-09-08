#!/usr/bin/env python3
"""Manifests -> the on-disk datasets Texo's data module loads.

Texo's MERDatasetHF (src/texo/data/dataset.py) does exactly this:

    self.dataset = HFDataset.load_from_disk(dataset_path)
    ...
    image = Image.open(io.BytesIO(self.dataset[index]['image']))
    text  = self.dataset[index]['text']

So the target is a `datasets.Dataset`, saved with save_to_disk, with two
columns: `image` holding raw PNG bytes (a binary Value, *not* a decoded
datasets.Image feature, or Image.open would be handed a PIL object) and `text`
holding the whitespace-separated label.

Output layout, chosen to match the three paths in Texo's config/data/*.yaml:

    <out>/train            -> data.train_dataset_path
    <out>/val              -> data.eval_dataset_path
    <out>/test/openmath    -> data.test_dataset_paths (Texo iterates subdirs)

    python build_dataset.py --out data/dataset \\
        --manifest data/prepared/mathwriting/manifest.jsonl \\
        --manifest data/prepared/crohme/manifest.jsonl

Never run against a full dataset. See README.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))

from openmath_finetune.manifest import Sample, read_manifest  # noqa: E402


def stable_fraction(key: str) -> float:
    """A deterministic 0..1 from a sample id, so re-runs split identically."""
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2 ** 64


def load(manifests: list[Path]) -> list[tuple[Sample, Path]]:
    rows: list[tuple[Sample, Path]] = []
    for manifest in manifests:
        base = manifest.parent
        kept = 0
        for sample in read_manifest(manifest):
            if sample.reject or not sample.image:
                continue
            rows.append((sample, base / sample.image))
            kept += 1
        print(f"{manifest}: {kept} usable rows")
    return rows


def assign_splits(
    rows: list[tuple[Sample, Path]],
    val_fraction: float,
    test_fraction: float,
) -> dict[str, list[tuple[Sample, Path]]]:
    """Honour the split a source declared; carve one out only when it did not.

    MathWriting ships valid/ and test/ built so that some writers and some
    expressions appear in no other split. Overriding that with a random split
    would leak writers between train and val and quietly inflate the numbers.
    """
    buckets: dict[str, list[tuple[Sample, Path]]] = {"train": [], "val": [], "test": []}
    declared = {sample.split for sample, _ in rows}
    carve = "val" not in declared and val_fraction > 0

    for sample, path in rows:
        split = sample.split if sample.split in buckets else "train"
        if split == "train" and carve:
            position = stable_fraction(f"{sample.source}/{sample.sample_id}")
            if position < val_fraction:
                split = "val"
            elif position < val_fraction + test_fraction:
                split = "test"
        buckets[split].append((sample, path))

    if carve:
        print(f"no declared val split; carved {val_fraction:.0%} val / "
              f"{test_fraction:.0%} test by sample id")
    return buckets


def cap_per_label(rows: list[tuple[Sample, Path]], limit: int) -> list[tuple[Sample, Path]]:
    """MathWriting's synthetic set repeats expressions; too many copies of one
    label teaches the model that label rather than the handwriting."""
    if limit <= 0:
        return rows
    seen: Counter[str] = Counter()
    out: list[tuple[Sample, Path]] = []
    for sample, path in rows:
        if seen[sample.text] >= limit:
            continue
        seen[sample.text] += 1
        out.append((sample, path))
    return out


def records(rows: list[tuple[Sample, Path]]) -> Iterator[dict[str, object]]:
    for sample, path in rows:
        try:
            data = path.read_bytes()
        except OSError as error:
            print(f"warning: skipping {path}: {error}", file=sys.stderr)
            continue
        yield {"image": data, "text": sample.text}


def write_split(rows: list[tuple[Sample, Path]], destination: Path) -> int:
    from datasets import Dataset, Features, Value

    features = Features({"image": Value("binary"), "text": Value("string")})
    dataset = Dataset.from_generator(
        lambda: records(rows),
        features=features,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    dataset.save_to_disk(str(destination))
    return len(dataset)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, action="append", required=True,
                        help="Repeatable. A manifest.jsonl written by a prepare script.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--val-fraction", type=float, default=0.02,
                        help="Only used when no source declared a val split.")
    parser.add_argument("--test-fraction", type=float, default=0.0)
    parser.add_argument("--max-train", type=int, default=0)
    parser.add_argument("--max-val", type=int, default=2000,
                        help="Validation runs greedy decoding every val_check_interval "
                             "steps, so a large val set dominates training time.")
    parser.add_argument("--max-per-label", type=int, default=0,
                        help="Keep at most N samples sharing a label (0 = unlimited).")
    parser.add_argument("--in-app-scope-only", action="store_true",
                        help="Keep only rows the solver could consume. See scope.py.")
    parser.add_argument("--replay-dataset", type=Path, default=None,
                        help="An existing load_from_disk dataset (e.g. Texo's UniMER-Train) "
                             "to mix into train, against catastrophic forgetting.")
    parser.add_argument("--replay-count", type=int, default=0)
    parser.add_argument("--seed", type=int, default=1234)
    args = parser.parse_args()

    rows = load(args.manifest)
    if not rows:
        print("no usable rows in any manifest", file=sys.stderr)
        return 1
    if args.in_app_scope_only:
        before = len(rows)
        rows = [r for r in rows if r[0].in_app_scope]
        print(f"in-app-scope filter: {len(rows)}/{before}")

    buckets = assign_splits(rows, args.val_fraction, args.test_fraction)

    rng = random.Random(args.seed)
    for name, bucket in buckets.items():
        rng.shuffle(bucket)
    buckets["train"] = cap_per_label(buckets["train"], args.max_per_label)
    if args.max_train:
        buckets["train"] = buckets["train"][: args.max_train]
    if args.max_val:
        buckets["val"] = buckets["val"][: args.max_val]

    summary: dict[str, object] = {
        "counts": {name: len(bucket) for name, bucket in buckets.items()},
        "sources": dict(Counter(sample.source for sample, _ in rows)),
        "in_app_scope": sum(1 for sample, _ in rows if sample.in_app_scope),
        "seed": args.seed,
    }

    out: Path = args.out
    written: dict[str, int] = {}
    for name, destination in (
        ("train", out / "train"),
        ("val", out / "val"),
        ("test", out / "test" / "openmath"),
    ):
        bucket = buckets[name]
        if not bucket:
            print(f"{name}: empty, not written")
            continue
        written[name] = write_split(bucket, destination)
        print(f"{name}: {written[name]} rows -> {destination}")

    if args.replay_dataset and args.replay_count:
        # Concatenating rather than interleaving: Texo's train dataloader
        # shuffles, so the mix is uniform per epoch either way.
        from datasets import concatenate_datasets, load_from_disk

        replay = load_from_disk(str(args.replay_dataset))
        take = min(args.replay_count, len(replay))
        replay = replay.shuffle(seed=args.seed).select(range(take))
        train = load_from_disk(str(out / "train"))
        if set(replay.column_names) != set(train.column_names):
            print(f"replay dataset columns {replay.column_names} do not match "
                  f"{train.column_names}; not mixing", file=sys.stderr)
        else:
            merged = concatenate_datasets([train, replay.cast(train.features)])
            merged = merged.shuffle(seed=args.seed)
            # datasets memory-maps what it loaded, so it refuses to overwrite a
            # dataset with itself: write beside it and swap.
            staging = out / "train.merging"
            merged.save_to_disk(str(staging))
            del merged, train
            shutil.rmtree(out / "train")
            staging.rename(out / "train")
            written["train"] = len(load_from_disk(str(out / "train")))
            summary["replay"] = {"source": str(args.replay_dataset), "rows": take}
            print(f"train: {len(merged)} rows after mixing {take} replay rows")

    summary["written"] = written
    (out / "dataset_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {out / 'dataset_summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
