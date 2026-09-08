"""Texo's own LaTeX synonym tables, read from a Texo checkout.

Skipping this step quietly destroys a chunk of the dataset. Texo's vocabulary
does not contain `\\infty`, `\\to`, `\\rightarrow`, `\\emptyset` or `\\ldots`;
its scripts/python/normalize.py rewrites them to `\\infin`, `\\rarr`, `\\rarr`,
`\\empty` and `\\dots` before the tokenizer ever sees them. UniMER-1M was
normalised that way, so a label that keeps the common spelling is not merely
unusual, it is <unk>.

The tables live in the Texo repository under data/tokenizer/normalizer/ and are
read from disk at run time. They are not vendored here: Texo is AGPL-3.0 and
this repository is MIT.

Two deliberate differences from Texo's normalize.py:

  - envs.txt is applied per token (`\\rm` -> `\\mathrm`) rather than by the
    string surgery Texo does on already-space-separated text. Texo's version
    also moves the following brace; ours does not, so `\\rm` keeps whatever
    scope it had. Rare enough in handwriting labels to be worth the simplicity.
  - expressions.txt is applied to the joined token string, after tokenising,
    because its keys are already written with spaces.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

TABLE_NAMES = ("macros", "envs", "symbols", "ad_hocs", "expressions")

#: Ours, not Texo's. The app's parser maps \frac, \dfrac and \tfrac onto the
#: same node (packages/math-core/src/parser.ts), neither is in Texo's
#: vocabulary, and a handwritten fraction carries no display-size distinction
#: for the model to learn anyway.
OPENMATH_EXTRA: dict[str, str] = {
    "\\dfrac": "\\frac",
    "\\tfrac": "\\frac",
}


@dataclass
class TexoTables:
    macros: dict[str, str]
    envs: dict[str, str]
    symbols: dict[str, str]
    ad_hocs: dict[str, str]
    expressions: dict[str, str]
    extra: dict[str, str]


def _read_table(path: Path) -> dict[str, str]:
    table: dict[str, str] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line:
                continue
            token, _, ortho = line.partition("\t")
            # Texo writes the literal string "None" for "delete this token".
            table[token] = "" if ortho == "None" else ortho
    return table


def load_tables(normalizer_dir: Path | str, *, extra: bool = True) -> TexoTables:
    """Load data/tokenizer/normalizer/*.txt from a Texo checkout."""
    directory = Path(normalizer_dir)
    tables = {}
    for name in TABLE_NAMES:
        path = directory / f"{name}.txt"
        if not path.is_file():
            raise FileNotFoundError(f"{path} not found; is --texo-root a Texo checkout?")
        tables[name] = _read_table(path)
    return TexoTables(**tables, extra=dict(OPENMATH_EXTRA) if extra else {})


def apply_token_tables(tokens: list[str], tables: TexoTables) -> list[str]:
    """Rewrite tokens into Texo's spelling, in Texo's order."""
    out = tokens
    for table in (tables.macros, tables.envs, tables.symbols, tables.ad_hocs, tables.extra):
        if not table:
            continue
        out = [table.get(token, token) for token in out]
    return [token for token in out if token != ""]


def apply_expression_table(text: str, tables: TexoTables) -> str:
    for token, ortho in tables.expressions.items():
        text = text.replace(token, ortho)
    return text
