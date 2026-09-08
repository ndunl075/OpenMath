"""Parallel InkML -> PNG + label, shared by the MathWriting and CROHME scripts.

Rendering 230k inks single-threaded is an afternoon; a process pool makes it
minutes. The pool state is set up once per worker rather than shipped with every
job, because the vocabulary and the synonym tables are large and the jobs are
small.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from .inkml import parse_inkml
from .label import build_label
from .manifest import Sample
from .render import EmptyInkError, RenderConfig, encode_png, render_strokes
from .texo_tables import TexoTables


@dataclass(frozen=True)
class InkJob:
    path: str
    split: str
    #: Subdirectory under images/, so sources with colliding ids stay separate.
    bucket: str


@dataclass
class LabelOptions:
    label_fields: tuple[str, ...]
    max_tokens: int = 512
    min_tokens: int = 1
    allow_unknown: bool = False
    require_app_scope: bool = False
    #: CROHME wraps its ground truth in $...$; MathWriting does not.
    strip_dollars: bool = False


_STATE: dict[str, object] = {}


def init_worker(
    source: str,
    out_dir: str,
    config: RenderConfig,
    vocab: set[str] | None,
    tables: TexoTables | None,
    options: LabelOptions,
) -> None:
    _STATE.update(
        source=source,
        out=Path(out_dir),
        config=config,
        vocab=vocab,
        tables=tables,
        options=options,
    )


def process(job: InkJob) -> Sample:
    source: str = _STATE["source"]  # type: ignore[assignment]
    out_dir: Path = _STATE["out"]  # type: ignore[assignment]
    config: RenderConfig = _STATE["config"]  # type: ignore[assignment]
    vocab = _STATE["vocab"]  # type: ignore[assignment]
    tables = _STATE["tables"]  # type: ignore[assignment]
    options: LabelOptions = _STATE["options"]  # type: ignore[assignment]

    path = Path(job.path)
    try:
        ink = parse_inkml(path)
    except Exception as error:  # one malformed file must not kill a 230k-file run
        return Sample(
            sample_id=path.stem, source=source, split=job.split, image="",
            text="", raw_label="", normalized="", n_tokens=0,
            reject=f"parse-error:{type(error).__name__}",
        )

    head, *rest = options.label_fields
    raw = ink.label(head, tuple(rest)) or ""
    if options.strip_dollars:
        from .inkml import strip_math_delimiters

        raw = strip_math_delimiters(raw)

    result = build_label(
        raw,
        vocab,
        tables=tables,
        max_tokens=options.max_tokens,
        min_tokens=options.min_tokens,
        allow_unknown=options.allow_unknown,
        require_app_scope=options.require_app_scope,
    )

    sample = Sample(
        sample_id=ink.sample_id,
        source=source,
        split=job.split,
        image="",
        text=result.text,
        raw_label=raw,
        normalized=result.normalized,
        n_tokens=len(result.tokens),
        unknown=result.unknown[:16],
        in_app_scope=result.in_scope,
        reject=result.reject,
    )
    if sample.reject:
        return sample

    try:
        image = render_strokes(ink.strokes, config)
    except EmptyInkError as error:
        sample.reject = f"render:{error}"
        return sample

    relative = Path("images") / job.bucket / f"{ink.sample_id}.png"
    target = out_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encode_png(image))

    sample.image = str(relative)
    sample.width, sample.height = image.size
    return sample


def run(
    jobs: list[InkJob],
    *,
    source: str,
    out_dir: Path,
    config: RenderConfig,
    vocab: set[str] | None,
    tables: TexoTables | None,
    options: LabelOptions,
    workers: int,
) -> list[Sample]:
    from concurrent.futures import ProcessPoolExecutor

    samples: list[Sample] = []
    with ProcessPoolExecutor(
        max_workers=max(1, workers),
        initializer=init_worker,
        initargs=(source, str(out_dir), config, vocab, tables, options),
    ) as pool:
        for index, sample in enumerate(pool.map(process, jobs, chunksize=32), start=1):
            samples.append(sample)
            if index % 2000 == 0:
                print(f"\r  {index}/{len(jobs)}", end="", file=sys.stderr)
    print(file=sys.stderr)
    return samples
