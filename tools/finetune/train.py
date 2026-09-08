#!/usr/bin/env python3
"""Drive Texo's trainer. Does not implement training.

Texo publishes a complete Lightning + Hydra training pipeline, so the useful
thing to add is the three-line setup around it and the one number nobody
remembers to set (num_training_steps, which the cosine schedule needs and which
Hydra cannot derive).

What this does:

  1. checks the Texo checkout looks like one;
  2. copies config/openmath_finetune.yaml into <texo-root>/config/, because
     Hydra resolves --config-name against Texo's own config directory;
  3. computes the total optimizer steps from the real dataset size;
  4. runs `python src/train.py --config-name openmath_finetune ...` from the
     Texo root, passing the dataset paths and any overrides.

Nothing of Texo's is copied into this repository, which is what keeps OpenMath
MIT while Texo is AGPL-3.0. See LICENSING.md, and the licence section of the
README before you ship weights.

    python train.py --texo-root ../../../Texo --dataset data/dataset --dry-run

Never executed: this environment has no GPU. --dry-run prints the exact command
so you can read it before anything runs.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_NAME = "openmath_finetune"


def check_texo_root(root: Path) -> None:
    missing = [
        str(relative)
        for relative in (Path("src/train.py"), Path("config/train.yaml"),
                         Path("config/model"), Path("config/trainer"))
        if not (root / relative).exists()
    ]
    if missing:
        raise SystemExit(
            f"{root} does not look like a Texo checkout (missing: {', '.join(missing)}).\n"
            "Clone it with: git clone https://github.com/alephpi/Texo"
        )


def install_config(root: Path) -> Path:
    source = HERE / "config" / f"{CONFIG_NAME}.yaml"
    target = root / "config" / f"{CONFIG_NAME}.yaml"
    if target.exists() and target.read_bytes() == source.read_bytes():
        return target
    shutil.copyfile(source, target)
    print(f"installed {target}")
    return target


def count_rows(dataset_dir: Path) -> int | None:
    """Rows in the train split, for the LR schedule.

    Prefers dataset_summary.json so this works without importing `datasets`,
    which in a Texo virtualenv is pinned to a version this script should not
    care about.
    """
    summary = dataset_dir / "dataset_summary.json"
    try:
        data = json.loads(summary.read_text(encoding="utf-8"))
        written = data.get("written") or {}
        if "train" in written:
            return int(written["train"])
        counts = data.get("counts") or {}
        if "train" in counts:
            return int(counts["train"])
    except (OSError, ValueError, KeyError):
        pass
    try:
        from datasets import load_from_disk

        return len(load_from_disk(str(dataset_dir / "train")))
    except Exception as error:
        print(f"warning: could not count training rows ({error}); "
              "pass --train-rows to set the LR schedule", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--texo-root", type=Path, required=True,
                        help="Checkout of https://github.com/alephpi/Texo.")
    parser.add_argument("--dataset", type=Path, required=True,
                        help="Output directory of build_dataset.py (holds train/, val/, test/).")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--accumulate", type=int, default=4)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=None)
    parser.add_argument("--warmup", type=int, default=None)
    parser.add_argument("--precision", default=None,
                        choices=["bf16-mixed", "16-mixed", "32-true"],
                        help="bf16-mixed needs Ampere or newer; use 16-mixed on Turing.")
    parser.add_argument("--freeze-encoder", action="store_true",
                        help="Last resort for small VRAM. Costs most of the benefit.")
    parser.add_argument("--resume", type=Path, default=None,
                        help="A Lightning .ckpt to resume from (training.resume_from_ckpt).")
    parser.add_argument("--train-rows", type=int, default=0,
                        help="Override the row count used for the LR schedule.")
    parser.add_argument("--python", default=None,
                        help="Interpreter to run Texo with. Defaults to this one, or to bare "
                             "'python' when --runner is given so that the runner's environment "
                             "supplies it.")
    parser.add_argument("--runner", default=None,
                        help="Prefix command, e.g. 'uv run' to use Texo's uv environment.")
    parser.add_argument("--dry-run", action="store_true", help="Print the command and stop.")
    parser.add_argument("overrides", nargs="*",
                        help="Extra Hydra overrides passed through verbatim, "
                             "e.g. trainer.devices=2")
    args = parser.parse_args()

    root: Path = args.texo_root.resolve()
    check_texo_root(root)
    install_config(root)

    dataset: Path = args.dataset.resolve()
    for name in ("train", "val"):
        if not (dataset / name).is_dir():
            raise SystemExit(f"{dataset / name} not found; run build_dataset.py first")

    rows = args.train_rows or count_rows(dataset) or 0
    effective_batch = max(1, args.batch_size * args.accumulate)
    overrides = [
        f"data.train_dataset_path={dataset / 'train'}",
        f"data.eval_dataset_path={dataset / 'val'}",
        f"data.test_dataset_paths={dataset / 'test'}",
        f"data.train_batch_size={args.batch_size}",
        f"data.val_batch_size={args.batch_size}",
        f"trainer.accumulate_grad_batches={args.accumulate}",
        f"trainer.max_epochs={args.epochs}",
    ]

    if rows:
        steps = math.ceil(rows / effective_batch) * args.epochs
        overrides.append(f"training.lr_scheduler.num_training_steps={steps}")
        print(f"{rows} training rows / effective batch {effective_batch} x {args.epochs} "
              f"epochs = {steps} optimizer steps")
    else:
        print("warning: leaving num_training_steps at the config default; the cosine "
              "schedule will not line up with this run", file=sys.stderr)

    if args.lr is not None:
        overrides.append(f"training.optimizer.lr={args.lr}")
    if args.warmup is not None:
        overrides.append(f"training.lr_scheduler.num_warmup_steps={args.warmup}")
    if args.precision:
        overrides.append(f"trainer.precision={args.precision}")
    if args.freeze_encoder:
        overrides.append("model.encoder.freeze=true")
    if args.resume:
        overrides.append(f"training.resume_from_ckpt={args.resume.resolve()}")
    overrides.extend(args.overrides)

    runner = args.runner.split() if args.runner else []
    interpreter = args.python or ("python" if runner else sys.executable)
    command = [*runner, interpreter, "src/train.py", "--config-name", CONFIG_NAME, *overrides]

    printable = " ".join(command)
    print(f"\ncd {root} && {printable}\n")
    if args.dry_run:
        return 0

    return subprocess.call(command, cwd=root)


if __name__ == "__main__":
    raise SystemExit(main())
