#!/usr/bin/env python3
"""Fine-tuned checkpoint -> the ONNX layout transformers.js loads.

Three stages, and each can fail in a way the next one hides:

  1. Lightning .ckpt -> a save_pretrained directory. Mirrors what Texo's
     scripts/python/hf_hub.py:save() does, including the reason it exists:
     FormulaNetLit holds the VisionEncoderDecoderModel as `.model`.
  2. save_pretrained -> ONNX, via optimum, using the same custom-encoder
     registration Texo's scripts/python/export_onnx.py uses. PPHGNetV2 is not a
     model type optimum knows, so it has to be registered by hand.
  3. ONNX -> q8, and assembly into the repository layout transformers.js
     expects. The app asks for dtype "q8" and a ~22 MB download.

Run verify_onnx.py afterwards. Always. A quantised export that loads and emits
confident nonsense looks exactly like a working one.

    python export_onnx.py --texo-root ../../../Texo \\
        --checkpoint outputs/.../step=12345-...ckpt --out build/texo-openmath

Never executed: no GPU here, and no torch. Every optimum/onnxruntime call below
is written from the documented API, not from a run.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

# Files transformers.js reads from the repository root, alongside onnx/.
SIDECAR_FILES = (
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
)

# transformers.js maps dtype -> filename suffix; "q8" means "_quantized".
QUANTIZED_SUFFIX = "_quantized"

# UniMERNet's normalisation, copied from Texo's
# src/texo/data/processor/image_processor.py.
UNIMERNET_MEAN = [0.7931, 0.7931, 0.7931]
UNIMERNET_STD = [0.1738, 0.1738, 0.1738]


def add_texo_to_path(root: Path) -> None:
    """Texo's modules are `texo.*` from src/, plus top-level task.py."""
    sys.path.insert(0, str(root / "src"))


def checkpoint_to_pretrained(checkpoint: Path, destination: Path) -> Path:
    """Lightning checkpoint -> a HuggingFace save_pretrained directory."""
    from task import FormulaNetLit  # Texo's src/task.py

    # Texo saves hyperparameters into tb_logs/hparams.yaml next to the run, and
    # its own hf_hub.py passes that path explicitly. Same layout assumption here:
    # <run>/checkpoints/<file>.ckpt with <run>/tb_logs/hparams.yaml.
    hparams = checkpoint.parent.parent / "tb_logs" / "hparams.yaml"
    kwargs = {"hparams_file": str(hparams)} if hparams.is_file() else {}
    if not kwargs:
        print(f"warning: {hparams} not found; loading the checkpoint without it. "
              "If this raises about missing hyperparameters, pass --model-dir instead.",
              file=sys.stderr)

    task = FormulaNetLit.load_from_checkpoint(str(checkpoint), **kwargs)
    destination.mkdir(parents=True, exist_ok=True)
    task.model.save_pretrained(str(destination))
    task.tokenizer.save_pretrained(str(destination))
    print(f"wrote {destination}")
    return destination


def export_onnx(model_dir: Path, destination: Path) -> Path:
    """save_pretrained -> ONNX, registering Texo's encoder with optimum."""
    from optimum.exporters.onnx import main_export
    from optimum.exporters.onnx.model_configs import ViTOnnxConfig
    from optimum.exporters.tasks import TasksManager

    import texo.model.formulanet  # noqa: F401  registers the model class

    register = TasksManager.create_register("onnx")

    @register("my_hgnetv2", *["feature-extraction"])
    class HGNetv2OnnxConfig(ViTOnnxConfig):  # noqa: D401
        @property
        def inputs(self):
            return {"pixel_values": {0: "batch_size"}}

    destination.mkdir(parents=True, exist_ok=True)
    # "image-to-text-with-past" is what Texo's own export script uses; it emits
    # the encoder plus a KV-cached decoder, which is what makes browser decoding
    # tolerable.
    main_export(str(model_dir), task="image-to-text-with-past", output=str(destination))
    print(f"exported ONNX to {destination}")
    return destination


def quantize(source: Path, target: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    # UNVERIFIED: these are the settings believed to match transformers.js's own
    # scripts/quantize.py "q8" mode (dynamic, per-tensor, QInt8 weights). If the
    # exported model diverges badly in verify_onnx.py, try weight_type=QUInt8 and
    # per_channel=True before assuming the fine-tune is at fault.
    quantize_dynamic(
        model_input=str(source),
        model_output=str(target),
        weight_type=QuantType.QInt8,
        per_channel=False,
        reduce_range=False,
        extra_options={"EnableSubgraph": True},
    )


def write_preprocessor_config(destination: Path, image_size: int) -> None:
    """Tell transformers.js how to prepare the image.

    UNVERIFIED, and the most likely cause of "the export is fine but accuracy is
    terrible". Texo's Python preprocessing is: convert to RGB, crop white
    margins, resize preserving aspect into image_size, pad, normalise with the
    UniMERNet mean/std. NougatImageProcessor is the closest standard processor
    (it has do_crop_margin, do_thumbnail and do_pad), but whether the
    transformers.js implementation performs the crop-margin step the same way
    was not checked.

    If it does not, the fix is on the app side rather than here: packages/ocr
    already has inkBounds() and cropTo(), so the crop can be done before the
    canvas reaches the pipeline.
    """
    config = {
        "image_processor_type": "NougatImageProcessor",
        "processor_class": "NougatProcessor",
        "do_crop_margin": True,
        "do_resize": True,
        "size": {"height": image_size, "width": image_size},
        "resample": 2,
        "do_thumbnail": True,
        "do_align_long_axis": False,
        "do_pad": True,
        "do_rescale": True,
        "rescale_factor": 1 / 255,
        "do_normalize": True,
        "image_mean": UNIMERNET_MEAN,
        "image_std": UNIMERNET_STD,
    }
    path = destination / "preprocessor_config.json"
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path} (verify this against transformers.js, see docstring)")


def assemble(model_dir: Path, onnx_dir: Path, destination: Path, quantise: bool) -> None:
    """Lay the files out the way transformers.js expects to find them."""
    destination.mkdir(parents=True, exist_ok=True)
    onnx_out = destination / "onnx"
    onnx_out.mkdir(exist_ok=True)

    for name in SIDECAR_FILES:
        source = model_dir / name
        if source.is_file():
            shutil.copyfile(source, destination / name)
        elif name in ("config.json", "tokenizer.json"):
            raise SystemExit(f"{source} is missing; transformers.js cannot load without it")

    exported = sorted(onnx_dir.glob("*.onnx"))
    if not exported:
        raise SystemExit(f"no .onnx files in {onnx_dir}")
    for path in exported:
        shutil.copyfile(path, onnx_out / path.name)
        # Large models export weights to a sidecar .onnx_data file.
        data = path.with_suffix(path.suffix + "_data")
        if data.is_file():
            shutil.copyfile(data, onnx_out / data.name)

    if not (onnx_out / "decoder_model_merged.onnx").is_file():
        print("warning: no decoder_model_merged.onnx. transformers.js prefers the merged "
              "decoder; without it, check that it falls back to decoder_model.onnx plus "
              "decoder_with_past_model.onnx for this architecture.", file=sys.stderr)

    if quantise:
        for path in sorted(onnx_out.glob("*.onnx")):
            if path.stem.endswith(QUANTIZED_SUFFIX):
                continue
            target = path.with_name(f"{path.stem}{QUANTIZED_SUFFIX}.onnx")
            print(f"quantising {path.name} -> {target.name}")
            quantize(path, target)

    total = sum(p.stat().st_size for p in onnx_out.glob("*"))
    quantised = sum(p.stat().st_size for p in onnx_out.glob(f"*{QUANTIZED_SUFFIX}.onnx"))
    print(f"\n{destination}")
    for path in sorted(onnx_out.iterdir()):
        print(f"  onnx/{path.name}: {path.stat().st_size / 1e6:.1f} MB")
    print(f"  all files: {total / 1e6:.1f} MB")
    print(f"  q8 only:   {quantised / 1e6:.1f} MB "
          "(this is the number the app downloads; PROVIDER_CONFIGS says ~22 MB)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--texo-root", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--checkpoint", type=Path, help="Lightning .ckpt from training.")
    source.add_argument("--model-dir", type=Path,
                        help="An existing save_pretrained directory, skipping stage 1.")
    parser.add_argument("--out", type=Path, required=True,
                        help="Destination repository directory.")
    parser.add_argument("--work", type=Path, default=None,
                        help="Scratch directory (default: <out>/.work).")
    parser.add_argument("--image-size", type=int, default=384,
                        help="Must match data.image_processor.image_size used in training.")
    parser.add_argument("--no-quantize", action="store_true",
                        help="Skip q8. The fp32 export is ~4x the download.")
    args = parser.parse_args()

    add_texo_to_path(args.texo_root.resolve())

    work = args.work or (args.out / ".work")
    work.mkdir(parents=True, exist_ok=True)

    if args.model_dir:
        model_dir = args.model_dir
    else:
        model_dir = checkpoint_to_pretrained(args.checkpoint, work / "pretrained")

    onnx_dir = export_onnx(model_dir, work / "onnx")
    assemble(model_dir, onnx_dir, args.out, quantise=not args.no_quantize)
    write_preprocessor_config(args.out, args.image_size)

    print("\nNow run verify_onnx.py. Do not skip it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
