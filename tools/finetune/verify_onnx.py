#!/usr/bin/env python3
"""Does the ONNX export still say what the PyTorch model says?

A broken ONNX export does not crash. It produces fluent, well-formed LaTeX that
is wrong, and the only way to notice is to compare. Texo's own README already
shows the fp32 ONNX conversion costing about 0.02 BLEU on handwriting (0.7973 ->
0.7787); q8 costs more. The question this script answers is whether "more" means
"a little" or "the model is broken".

Two checks, deliberately different in kind:

  1. Encoder tensors. Plain onnxruntime against the exported encoder, compared
     to the PyTorch encoder on the same pixels. No generation, no sampling, no
     API guesswork -- if this diverges, nothing downstream can be right. This is
     the check that actually catches a bad export.
  2. End-to-end strings. Greedy decode through optimum's ORTModelForVision2Seq,
     compared to the PyTorch model's greedy decode. Closest to what the app
     does, but it goes through an optimum API whose exact keyword arguments were
     not verified here.

    python verify_onnx.py --texo-root ../../../Texo \\
        --model-dir build/texo-openmath/.work/pretrained \\
        --onnx-dir build/texo-openmath --images data/prepared/mathwriting/images/valid

Never executed: no torch, no onnxruntime, no GPU in the environment this was
written in.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".bmp")


def add_texo_to_path(root: Path) -> None:
    sys.path.insert(0, str(root / "src"))


def load_images(directory: Path, limit: int) -> list[Path]:
    files = sorted(p for p in directory.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not files:
        raise SystemExit(f"no images under {directory}")
    # Spread the sample across the directory rather than taking the first N,
    # which on a sorted listing means one writer or one generator run.
    step = max(1, len(files) // limit)
    return files[::step][:limit]


def preprocess(paths: list[Path], image_size: int):
    """Texo's own eval preprocessing, so the comparison isn't measuring that."""
    import torch
    from PIL import Image

    from texo.data.processor import EvalMERImageProcessor

    processor = EvalMERImageProcessor(image_size={"width": image_size, "height": image_size})
    tensors = []
    for path in paths:
        with Image.open(path) as image:
            tensors.append(processor(image))
    return torch.stack(tensors)


def compare_encoder(model, pixel_values, onnx_dir: Path, filename: str) -> dict[str, float]:
    import numpy as np
    import onnxruntime as ort
    import torch

    path = onnx_dir / "onnx" / filename
    if not path.is_file():
        raise SystemExit(f"{path} not found")

    with torch.no_grad():
        encoder_outputs = model.encoder(pixel_values=pixel_values)
    # VisionEncoderDecoderModel itself takes encoder_outputs[0], because a custom
    # encoder need not return a ModelOutput with named fields.
    hidden = getattr(encoder_outputs, "last_hidden_state", None)
    if hidden is None:
        hidden = encoder_outputs[0]
    reference = hidden.cpu().numpy()

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: pixel_values.cpu().numpy()})
    actual = outputs[0]

    if actual.shape != reference.shape:
        raise SystemExit(
            f"{filename}: shape mismatch, torch {reference.shape} vs onnx {actual.shape}"
        )

    difference = np.abs(actual - reference)
    scale = float(np.abs(reference).mean()) or 1.0
    flat_a = actual.reshape(-1)
    flat_b = reference.reshape(-1)
    cosine = float(
        flat_a @ flat_b / (np.linalg.norm(flat_a) * np.linalg.norm(flat_b) + 1e-12)
    )
    return {
        "max_abs": float(difference.max()),
        "mean_abs": float(difference.mean()),
        "relative": float(difference.mean() / scale),
        "cosine": cosine,
    }


def compare_generation(model, tokenizer, pixel_values, onnx_dir: Path,
                       quantised: bool, max_new_tokens: int) -> tuple[list[str], list[str]]:
    import torch

    with torch.no_grad():
        torch_ids = model.generate(pixel_values, num_beams=1, do_sample=False,
                                   max_new_tokens=max_new_tokens)
    torch_text = tokenizer.batch_decode(torch_ids, skip_special_tokens=True)

    from optimum.onnxruntime import ORTModelForVision2Seq

    # UNVERIFIED: the encoder_file_name / decoder_file_name keywords are how
    # optimum selects a non-default ONNX file. If this raises TypeError, the
    # fallback is to copy the *_quantized.onnx files over the plain names in a
    # scratch directory and load that with no keywords.
    kwargs: dict[str, str] = {}
    if quantised:
        kwargs = {
            "encoder_file_name": "encoder_model_quantized.onnx",
            "decoder_file_name": "decoder_model_merged_quantized.onnx",
        }
    ort_model = ORTModelForVision2Seq.from_pretrained(
        str(onnx_dir), use_io_binding=False, **kwargs
    )
    onnx_ids = ort_model.generate(pixel_values=pixel_values, num_beams=1, do_sample=False,
                                  max_new_tokens=max_new_tokens)
    onnx_text = tokenizer.batch_decode(onnx_ids, skip_special_tokens=True)
    return torch_text, onnx_text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--texo-root", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True,
                        help="save_pretrained directory of the PyTorch model.")
    parser.add_argument("--onnx-dir", type=Path, required=True,
                        help="Assembled repository directory (holds onnx/).")
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--count", type=int, default=8)
    parser.add_argument("--image-size", type=int, default=384)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--skip-generation", action="store_true",
                        help="Run only the encoder tensor comparison.")
    parser.add_argument("--max-relative", type=float, default=0.02,
                        help="Fail if the quantised encoder's mean error exceeds this "
                             "fraction of the activation scale.")
    parser.add_argument("--min-exact", type=float, default=0.75,
                        help="Fail if fewer than this fraction of decodes match PyTorch "
                             "exactly. On 8 images this is a smoke test, not a benchmark.")
    args = parser.parse_args()

    add_texo_to_path(args.texo_root.resolve())

    from transformers import AutoTokenizer, VisionEncoderDecoderModel

    model = VisionEncoderDecoderModel.from_pretrained(str(args.model_dir))
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(str(args.model_dir))

    paths = load_images(args.images, args.count)
    print(f"{len(paths)} images from {args.images}")
    pixel_values = preprocess(paths, args.image_size)

    failures: list[str] = []

    print("\nencoder, PyTorch vs ONNX")
    for filename in ("encoder_model.onnx", "encoder_model_quantized.onnx"):
        if not (args.onnx_dir / "onnx" / filename).is_file():
            print(f"  {filename}: not present, skipped")
            continue
        stats = compare_encoder(model, pixel_values, args.onnx_dir, filename)
        print(f"  {filename}: max_abs={stats['max_abs']:.4g} "
              f"mean_abs={stats['mean_abs']:.4g} "
              f"relative={stats['relative']:.4%} cosine={stats['cosine']:.6f}")
        if stats["relative"] > args.max_relative:
            failures.append(f"{filename} relative error {stats['relative']:.2%} "
                            f"exceeds {args.max_relative:.2%}")

    if not args.skip_generation:
        for quantised in (False, True):
            label = "q8" if quantised else "fp32"
            try:
                torch_text, onnx_text = compare_generation(
                    model, tokenizer, pixel_values, args.onnx_dir, quantised,
                    args.max_new_tokens,
                )
            except Exception as error:
                print(f"\ngeneration ({label}) could not run: {type(error).__name__}: {error}")
                failures.append(f"generation ({label}) failed to run")
                continue

            matches = sum(1 for a, b in zip(torch_text, onnx_text) if a == b)
            rate = matches / max(1, len(torch_text))
            print(f"\ngeneration ({label}): {matches}/{len(torch_text)} exact matches "
                  f"({rate:.0%})")
            for path, a, b in zip(paths, torch_text, onnx_text):
                if a != b:
                    print(f"  {path.name}\n    torch: {a}\n    onnx : {b}")
            if rate < args.min_exact:
                failures.append(f"generation ({label}) exact match {rate:.0%} "
                                f"below {args.min_exact:.0%}")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nOK. Thresholds are arbitrary; read the numbers, do not just trust the exit code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
