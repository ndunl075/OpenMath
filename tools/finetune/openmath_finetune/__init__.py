"""Data preparation and training glue for fine-tuning Texo on handwriting.

Nothing in this package has ever been run against a GPU or a full dataset. See
tools/finetune/README.md before relying on any of it.
"""

from .label import LabelResult, build_label
from .latex_tokens import join_tokens, load_vocab, tokenize, unknown_tokens
from .manifest import Sample, read_manifest, summarise, write_manifest, write_summary
from .normalize import detect_out_of_scope, normalize_latex, normalize_with_report
from .scope import in_app_scope

__all__ = [
    "LabelResult",
    "Sample",
    "build_label",
    "detect_out_of_scope",
    "in_app_scope",
    "join_tokens",
    "load_vocab",
    "normalize_latex",
    "normalize_with_report",
    "read_manifest",
    "summarise",
    "tokenize",
    "unknown_tokens",
    "write_manifest",
    "write_summary",
]
