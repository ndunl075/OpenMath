"""What the OpenMath solver can actually consume.

Mirrors the accepted command set in packages/math-core/src/{lexer,parser}.ts and
the refusal list in packages/ocr/src/normalize.ts. It exists for two reasons:

  - reporting: "what fraction of this dataset is expressions the app could
    solve" is the number that says whether fine-tuning on it is worth the GPU
    hours;
  - an optional training filter, which is a genuinely risky knob. Narrowing the
    training set to algebra teaches the model that everything is algebra, and a
    photo of an integral then comes back as a plausible-looking polynomial
    rather than something the app can refuse. Default is off. See README.
"""

from __future__ import annotations

import re

from .normalize import detect_out_of_scope

# packages/math-core/src/parser.ts
FUNCTIONS = frozenset({
    "sin", "cos", "tan", "sec", "csc", "cot",
    "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
    "ln", "log", "exp", "abs",
})

GREEK = frozenset({
    "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu",
    "pi", "rho", "sigma", "tau", "phi", "omega",
})

# packages/math-core/src/lexer.ts: dropped during lexing, so harmless if present.
IGNORED = frozenset({
    "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits",
    "left", "right", "!", ",", ";", ":", " ", "quad", "qquad", "thinspace",
    "medspace", "thickspace", "negthinspace",
})

# packages/math-core/src/lexer.ts ALIAS plus the structural commands the parser
# handles directly.
STRUCTURAL = frozenset({
    "frac", "dfrac", "tfrac", "sqrt",
    "cdot", "times", "div", "ast",
    "le", "leq", "ge", "geq", "lt", "gt",
    "lparen", "rparen",
})

SUPPORTED = FUNCTIONS | GREEK | IGNORED | STRUCTURAL

_CONTROL_WORD = re.compile(r"\\([a-zA-Z]+)")


def unsupported_commands(latex: str) -> list[str]:
    """Control words the app's parser would reject, in order of appearance."""
    return [name for name in _CONTROL_WORD.findall(latex) if name not in SUPPORTED]


def in_app_scope(latex: str) -> bool:
    """True when the solver has a plausible chance at this expression.

    Not a promise that it parses: this checks the command vocabulary and the
    refusal list, not the grammar. Only the real parser can answer properly, and
    it lives in TypeScript.
    """
    if not latex.strip():
        return False
    if detect_out_of_scope(latex) is not None:
        return False
    return not unsupported_commands(latex)
