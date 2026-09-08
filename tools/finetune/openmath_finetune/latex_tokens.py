"""LaTeX to Texo's label form.

Texo's tokenizer is a WordLevel model with a WhitespaceSplit pre-tokenizer and a
687-entry vocabulary (verified by reading data/tokenizer/tokenizer.json in the
Texo repository). Two consequences drive this module:

  1. Training labels must be **whitespace-separated LaTeX tokens**. "\\frac{1}{2}"
     is one out-of-vocabulary word; "\\frac { 1 } { 2 }" is five known ones.
  2. Anything outside the 687 tokens becomes <unk>, and Texo's own data config
     has `filter_train` to drop such samples. So the vocabulary check below is
     not a nicety: it decides which dataset rows are usable at all.

Texo's own scripts/python/normalize.py does not need a real LaTeX tokenizer,
because UniMER-1M ships already space-separated and it only has to re-split
runs like "\\left(". MathWriting labels are dense LaTeX, so this module does the
tokenizing that Texo's pipeline assumes has already happened. That difference is
the most likely place for a mismatch with what Texo was trained on -- see the
"Unverified assumptions" table in the README.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# \begin{array} and \end{array} are single entries in Texo's vocabulary, so the
# environment name has to stay attached rather than splitting into \begin { a ... }.
_ENV = re.compile(r"\\(begin|end)\s*\{\s*([A-Za-z*]+)\s*\}")
_CONTROL_WORD = re.compile(r"\\[a-zA-Z]+")


def tokenize(latex: str, vocab: set[str] | None = None) -> list[str]:
    """Split LaTeX into the whitespace-delimited tokens Texo's tokenizer expects."""
    tokens: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        c = latex[i]
        if c.isspace():
            i += 1
            continue
        if c == "\\":
            env = _ENV.match(latex, i)
            if env:
                tokens.append(f"\\{env.group(1)}{{{env.group(2)}}}")
                i = env.end()
                continue
            word = _CONTROL_WORD.match(latex, i)
            if word:
                token = word.group(0)
                end = word.end()
                # \operatorname* is a distinct vocabulary entry; only glue the
                # star on when the caller supplied a vocabulary that has it.
                if vocab is not None and end < n and latex[end] == "*" and token + "*" in vocab:
                    token += "*"
                    end += 1
                tokens.append(token)
                i = end
                continue
            # Control symbol: backslash plus exactly one non-letter (\\, \{, \%).
            # A backslash before whitespace is emitted alone: tokens must never
            # contain a space, or join/split round trips silently split them.
            # Texo's symbols.txt maps a lone "\\" to "~", which is right for the
            # \<space> control symbol it usually came from.
            if i + 1 < n and not latex[i + 1].isspace():
                tokens.append(latex[i:i + 2])
                i += 2
                continue
            tokens.append(c)
            i += 1
            continue
        tokens.append(c)
        i += 1
    return tokens


def join_tokens(tokens: list[str]) -> str:
    return " ".join(tokens)


def load_vocab(tokenizer_json: Path | str) -> set[str]:
    """Read the token set out of a HuggingFace tokenizers `tokenizer.json`.

    Points at the Texo checkout (data/tokenizer/tokenizer.json). The file is not
    vendored here: Texo is AGPL-3.0 and this repository is MIT.
    """
    data = json.loads(Path(tokenizer_json).read_text(encoding="utf-8"))
    vocab = set(data.get("model", {}).get("vocab", {}).keys())
    for added in data.get("added_tokens", []) or []:
        content = added.get("content")
        if isinstance(content, str):
            vocab.add(content)
    if not vocab:
        raise ValueError(f"no vocabulary found in {tokenizer_json}")
    return vocab


def unknown_tokens(tokens: list[str], vocab: set[str]) -> list[str]:
    """Tokens that would decode to <unk>, in order, with duplicates kept."""
    return [t for t in tokens if t not in vocab]
