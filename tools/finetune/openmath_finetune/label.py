"""One place that turns a dataset's ground truth into a Texo training label.

All three prepare scripts call build_label, so a change to the label convention
lands on every source at once instead of drifting between them.

Order matters:

  1. normalize.py, because that is what the app does to model output at
     inference time -- the model should be trained to emit its result directly;
  2. tokenise into Texo's whitespace-separated form;
  3. Texo's synonym tables, because its vocabulary spells things its own way
     (see texo_tables.py);
  4. vocabulary check, which decides whether the row is usable at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .latex_tokens import join_tokens, tokenize, unknown_tokens
from .normalize import normalize_latex
from .scope import in_app_scope
from .texo_tables import TexoTables, apply_expression_table, apply_token_tables


@dataclass
class LabelResult:
    normalized: str
    tokens: list[str] = field(default_factory=list)
    text: str = ""
    unknown: list[str] = field(default_factory=list)
    in_scope: bool = False
    reject: str | None = None


def build_label(
    raw: str,
    vocab: set[str] | None,
    *,
    tables: TexoTables | None = None,
    max_tokens: int = 512,
    min_tokens: int = 1,
    allow_unknown: bool = False,
    require_app_scope: bool = False,
) -> LabelResult:
    normalized = normalize_latex(raw or "")
    if not normalized:
        return LabelResult(normalized="", reject="empty-label")

    tokens = tokenize(normalized, vocab)
    if tables is not None:
        tokens = apply_token_tables(tokens, tables)
        text = apply_expression_table(join_tokens(tokens), tables)
        tokens = [t for t in text.split(" ") if t]
    else:
        text = join_tokens(tokens)

    result = LabelResult(
        normalized=normalized,
        tokens=tokens,
        text=text,
        in_scope=in_app_scope(normalized),
    )

    if vocab is not None:
        result.unknown = sorted(set(unknown_tokens(tokens, vocab)))

    if len(tokens) < min_tokens:
        result.reject = "too-short"
    elif len(tokens) > max_tokens:
        # Texo's text_processor truncates at max_length; a truncated label ends
        # mid-expression, which is worse for training than no label at all.
        result.reject = "too-long"
    elif result.unknown and not allow_unknown:
        result.reject = "unknown-token"
    elif require_app_scope and not result.in_scope:
        result.reject = "out-of-app-scope"

    return result
