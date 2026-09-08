"""Argument wiring shared by the three prepare scripts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .latex_tokens import load_vocab
from .render import RenderConfig
from .texo_tables import TexoTables, load_tables

TOKENIZER_RELPATH = Path("data/tokenizer/tokenizer.json")
NORMALIZER_RELPATH = Path("data/tokenizer/normalizer")


def add_label_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--texo-root",
        type=Path,
        default=None,
        help=(
            "Checkout of https://github.com/alephpi/Texo. Supplies both the "
            "687-token vocabulary and the synonym tables. Strongly recommended: "
            "without it labels cannot be checked, and unusable rows reach "
            "training as <unk>."
        ),
    )
    parser.add_argument("--tokenizer", type=Path, default=None,
                        help="Override the tokenizer.json path (default: "
                             "<texo-root>/data/tokenizer/tokenizer.json).")
    parser.add_argument("--normalizer-dir", type=Path, default=None,
                        help="Override the synonym table directory (default: "
                             "<texo-root>/data/tokenizer/normalizer).")
    parser.add_argument("--no-texo-tables", action="store_true",
                        help="Skip Texo's synonym tables. Expect many more "
                             "unknown-token rejects; see texo_tables.py.")
    parser.add_argument("--max-tokens", type=int, default=512,
                        help="Reject labels longer than this (default: 512).")
    parser.add_argument("--min-tokens", type=int, default=1)
    parser.add_argument("--allow-unknown", action="store_true",
                        help="Keep rows containing out-of-vocabulary tokens.")
    parser.add_argument("--require-app-scope", action="store_true",
                        help="Keep only expressions OpenMath's solver could handle. "
                             "Read the warning in openmath_finetune/scope.py first.")


def add_render_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--max-width", type=int, default=RenderConfig.max_width)
    parser.add_argument("--max-height", type=int, default=RenderConfig.max_height)
    parser.add_argument("--margin", type=int, default=RenderConfig.margin)
    parser.add_argument("--stroke-units", type=float, default=RenderConfig.stroke_units)
    parser.add_argument("--supersample", type=int, default=RenderConfig.supersample)
    parser.add_argument("--blur-sigma", type=float, default=RenderConfig.blur_sigma,
                        help="Gaussian blur after downsampling. Off by default; "
                             "Texo's own training augmentation already covers this.")


def render_config_from_args(args: argparse.Namespace) -> RenderConfig:
    return RenderConfig(
        max_width=args.max_width,
        max_height=args.max_height,
        margin=args.margin,
        stroke_units=args.stroke_units,
        supersample=args.supersample,
        blur_sigma=args.blur_sigma,
    )


def vocab_from_args(args: argparse.Namespace) -> set[str] | None:
    path = args.tokenizer
    if path is None and args.texo_root is not None:
        path = args.texo_root / TOKENIZER_RELPATH
    if path is None:
        print("warning: no --texo-root or --tokenizer, labels will not be "
              "vocabulary-checked", file=sys.stderr)
        return None
    return load_vocab(path)


def tables_from_args(args: argparse.Namespace) -> TexoTables | None:
    if args.no_texo_tables:
        return None
    directory = args.normalizer_dir
    if directory is None and args.texo_root is not None:
        directory = args.texo_root / NORMALIZER_RELPATH
    if directory is None:
        print("warning: no --texo-root or --normalizer-dir, Texo's synonym "
              "tables will not be applied", file=sys.stderr)
        return None
    return load_tables(directory)
