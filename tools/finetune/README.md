# Fine-tuning Texo on handwriting

> **This pipeline has never been executed.** It was written in an environment
> with no GPU, no PyTorch, and no access to huggingface.co. No model was
> trained, no checkpoint was exported, no ONNX file was produced or loaded.
> Treat every instruction below as a considered proposal, not a tested recipe.
>
> Some parts *were* run and do work; see [What was actually
> verified](#what-was-actually-verified) for the exact line between the two.

This is a contingency, not part of the build. Read [When you would want
this](#when-you-would-want-this) before spending a GPU on it.

---

## Verify these first

In order. Each one is cheap and each one has silently broken pipelines before.

1. **Texo's config field names still match.** `config/openmath_finetune.yaml`
   overrides keys read from Texo at the commit this was written against. Run
   `python train.py --texo-root … --dataset … --dry-run` and then the printed
   command with `trainer.fast_dev_run=5`. Hydra fails loudly on an unknown key,
   which is the good outcome.
2. **The dataset loads on Texo's side.** `datasets` is pinned to Texo's
   `4.0.0` in `requirements.txt`; the local check was done on `5.0.1`. If
   `load_from_disk` complains, rebuild inside Texo's environment.
3. **Rendered strokes look like handwriting to *you*.** Open thirty PNGs from
   `data/prepared/mathwriting/images/train/`. Stroke width, size and margins are
   the whole of what this pipeline controls about image quality.
4. **The vocabulary check is actually running.** `summary.json` should report a
   small `unknown-token` reject count (about 4% on the MathWriting excerpt). A
   count of 0 usually means `--texo-root` was omitted and nothing was checked;
   a count above ~20% means the synonym tables are not being applied.
5. **`preprocessor_config.json` is right.** See
   [Preprocessing](#the-preprocessing-gap). This is the likeliest cause of a
   correct-looking export that reads badly in the browser.
6. **`verify_onnx.py` passes before anything is uploaded.** A wrong export is
   fluent and confident. It does not crash.
7. **The bench says the fine-tune is better.** Not the val BLEU. The bench, on
   photos.

---

## When you would want this

Only after `packages/bench` has measured Texo on the real photo corpus and
handwriting accuracy is the thing that is bad.

Fine-tuning is the fourth thing to try, not the first:

1. **Fix the preprocessing.** `packages/ocr/src/image.ts` already has
   contrast stretch, Otsu, ink bounds and inversion. Whether the crop matches
   Texo's expected input is a fifty-line question, not a GPU question.
2. **Switch models.** `pix2text-mfr` and `texteller` are one line away in
   `PROVIDER_CONFIGS`, and TexTeller is Apache-2.0.
3. **Lean on the editable result field.** ARCHITECTURE §3 already says this
   covers more OCR failures than any model swap. It is free.
4. **Then this.**

And if you do run it, the honest expectation is a moderate gain on handwriting
against a real risk of losing accuracy on printed text — see
[Catastrophic forgetting](#catastrophic-forgetting).

---

## The licensing consequence

This is a real decision. Read [LICENSING.md](../../LICENSING.md) first.

Today the app ships **no Texo code and no Texo weights**. Inference goes through
transformers.js (Apache-2.0) and the viewer's own browser fetches weights from a
third-party model host. That is why this repository is MIT.

Fine-tuning breaks that arrangement in two directions at once.

### Texo is AGPL-3.0

Fine-tuned weights are derived from Texo's released weights and produced with
Texo's training code. LICENSING.md lists three things that put the AGPL question
back on the table, and **self-hosting the weights is the second of them**. There
is no third-party host to point at for a model that does not exist yet; you
would be publishing it.

Practical reading:

- Publishing the fine-tuned weights on your own account on a model host, and
  having the app fetch from there, is closest to today's arrangement — but the
  weights are yours now, and you are the distributor.
- Bundling them into `apps/web/public` is the option LICENSING.md is most
  clearly against.
- Either way the safe move is to relicense `apps/web` as AGPL-3.0-or-later
  before shipping, keeping `packages/*` MIT. LICENSING.md already spells out how.

Nothing in `tools/finetune/` vendors Texo. `train.py` copies *our* config into a
Texo checkout and runs Texo as a subprocess; `texo_tables.py` and
`latex_tokens.py` read Texo's data files from disk at run time. That keeps this
directory MIT. It does not make the *output* MIT.

### MathWriting is CC BY-NC-SA 4.0

Verified from the dataset's own readme. NonCommercial and ShareAlike, with the
LaTeX expressions themselves additionally under Wikipedia's CC BY-SA.

Whether a trained model is a derivative work of its training data is unsettled
law and the answer differs by jurisdiction. What is not unsettled is that
someone will ask, and that "the dataset said NonCommercial" is a bad sentence to
meet for the first time after launch. If OpenMath is to stay free and
non-commercial this is probably fine; if it ever takes money, it is not.

CROHME's terms vary by release and HME100K's come with its registration form.
Check both before mixing them in.

**The narrow escape route**, if licensing is the blocker: fine-tune
`pix2text-mfr` (MIT) instead on the same data. Nothing in the data-preparation
half of this directory is Texo-specific except the tokenizer and the synonym
tables.

---

## Prerequisites

- Python 3.11+.
- A Texo checkout: `git clone https://github.com/alephpi/Texo`, then `uv sync`
  inside it. Every script here takes `--texo-root` pointing at it.
- Texo's released weights *including checkpoints*:
  `python scripts/python/hf_hub.py pull --with_useful_ckpts`, which is what puts
  `model/checkpoints/formulanet_distill_best_transfer.pt` where the config
  expects it.
- `pip install -r requirements.txt` for data preparation.
- For export: Texo's environment plus `pip install -r requirements-export.txt`.
- ~40 GB of disk: 3.1 GB archive, ~10 GB of rendered PNGs for the human splits
  (more with `synthetic`), plus checkpoints.
- A GPU. See below.

## GPU, memory and time

All numbers below are **estimates**, extrapolated from Texo's own published
setup. Nothing here was measured.

Texo trained the released model at batch 64 on an A40/L40S (46 GB) and
recommends 40 GB. The defaults here target 12 GB by using batch 8 with 4-step
gradient accumulation, for the same effective batch of 32.

| GPU | VRAM | Suggested settings | Notes |
| --- | --- | --- | --- |
| RTX 3060 | 12 GB | `--batch-size 4 --accumulate 8` | Slow but viable. Drop to `--freeze-encoder` only if it still OOMs. |
| RTX 4070 Ti / 4080 | 12–16 GB | defaults (`8 × 4`) | The intended target. |
| RTX 4090 | 24 GB | `--batch-size 16 --accumulate 2` | |
| A100 / L40S | 40–48 GB | `--batch-size 32 --accumulate 1` | Matches upstream most closely. |
| Turing (2080 Ti, T4) | — | add `--precision 16-mixed` | bf16 needs Ampere or newer. |

**Wall clock.** Do not trust a table for this; derive it. After the first
hundred steps, read `it/s` off the progress bar and compute:

```
hours = (train_rows / (batch_size * accumulate)) * epochs / (it/s) / 3600
```

For scale: 230k MathWriting rows at an effective batch of 32 is ~7.2k optimizer
steps per epoch. If a 4090 sustains 2 it/s that is about one hour per epoch, so
a 3-epoch run is an evening. A 3060 might be four times that. Adding
MathWriting's 400k synthetic inks roughly triples everything.

**Cost**, if renting: roughly $0.35–0.70/hr for a 4090 and $1.10–1.90/hr for an
A100 40 GB on the usual spot marketplaces, so a 3-epoch run lands somewhere
between $5 and $25. Market rates as of writing; check them.

---

## Step by step

Paths below assume you are in `tools/finetune/` and Texo is checked out at
`../../../Texo`.

### 0. Smoke-test on 500 inks first

```bash
python prepare_mathwriting.py --excerpt \
    --out data/prepared/excerpt \
    --texo-root ../../../Texo \
    --splits train,valid,test
```

1.6 MB download, seconds to run. Look at the PNGs and at `summary.json` before
committing to the 3.1 GB version.

### 1. Prepare MathWriting

```bash
python prepare_mathwriting.py --download \
    --out data/prepared/mathwriting \
    --texo-root ../../../Texo \
    --splits train,valid,test
```

Add `synthetic` to `--splits` for the extra ~400k stitched-glyph inks. They are
not real handwriting — individual glyphs from `symbols/` pasted into
LaTeX-computed bounding boxes — so they teach layout rather than penmanship. Try
without them first.

`--label-field` defaults to `label` rather than the `normalizedLabel` the
dataset readme recommends, because MathWriting's normalisation rewrites
`\binom{n}{2}` into `\begin{matrix}…` and `\log` into a bare `log`, neither of
which exists in Texo's 687-token vocabulary. Running `label` through our own
normalizer keeps more rows.

### 2. Prepare the secondary sources (optional)

```bash
python prepare_crohme.py --src /path/to/CROHME --out data/prepared/crohme \
    --texo-root ../../../Texo --dump-annotations     # look first
python prepare_crohme.py --src /path/to/CROHME --out data/prepared/crohme \
    --texo-root ../../../Texo

python prepare_hme100k.py --dry-run \
    --images /path/to/HME100K/train/images \
    --labels /path/to/HME100K/train/caption.txt \
    --out data/prepared/hme100k --texo-root ../../../Texo
```

Both need `--dump-annotations` / `--dry-run` first: neither dataset's exact
layout was verified. HME100K is the more valuable of the two because it is
photographs of real paper, which is the one thing rendered strokes cannot be.

### 3. Build the training set

```bash
python build_dataset.py --out data/dataset \
    --manifest data/prepared/mathwriting/manifest.jsonl \
    --manifest data/prepared/hme100k/manifest.jsonl
```

Writes `data/dataset/{train,val,test/openmath}` as `save_to_disk` datasets with
`image` (PNG bytes) and `text` columns, which is exactly what Texo's
`MERDatasetHF` reads.

Consider `--replay-dataset /path/to/UniMER-Train --replay-count 50000` — see
[Catastrophic forgetting](#catastrophic-forgetting).

### 4. Train

```bash
python train.py --texo-root ../../../Texo --dataset data/dataset --dry-run
python train.py --texo-root ../../../Texo --dataset data/dataset \
    --runner "uv run" trainer.fast_dev_run=20      # 20 steps, then stop
python train.py --texo-root ../../../Texo --dataset data/dataset --runner "uv run"
```

`train.py` copies the config into Texo's `config/`, computes
`num_training_steps` from the real row count (the cosine schedule is wrong
without it and the loss curve will not tell you), and runs Texo's `src/train.py`.

Watch it in TensorBoard: `tensorboard --logdir outputs` from the Texo root.
Texo logs `train_loss`, `val_loss`, `BLEU` and `edit_distance`.

### 5. Export

```bash
python export_onnx.py --texo-root ../../../Texo \
    --checkpoint ../../../Texo/outputs/…/checkpoints/step=…ckpt \
    --out build/texo-openmath
```

Produces a directory laid out the way transformers.js expects: `config.json`,
`tokenizer.json`, `preprocessor_config.json` at the root and `onnx/*.onnx`
including `*_quantized.onnx`, which is what `dtype: "q8"` resolves to.

### 6. Verify the export

```bash
python verify_onnx.py --texo-root ../../../Texo \
    --model-dir build/texo-openmath/.work/pretrained \
    --onnx-dir build/texo-openmath \
    --images data/prepared/mathwriting/images/valid
```

Compares PyTorch against ONNX two ways: encoder tensors through plain
onnxruntime, and greedy decodes end to end. The tensor comparison is the one
that catches a bad export; the string comparison is the one that tells you
whether you care.

Texo's own README reports fp32 ONNX conversion costing about 0.02 BLEU on
handwriting (0.7973 → 0.7787). Expect q8 to cost more than that. If the encoder
relative error is above a couple of percent, try `QuantType.QUInt8` and
`per_channel=True` in `export_onnx.py:quantize` before blaming the fine-tune.

---

## How to tell if it worked

In increasing order of how much the answer is worth:

1. **`val_loss` down and `BLEU` up** on the handwriting val split. Necessary,
   and almost meaningless on its own: the val split is rendered strokes, the
   same distribution the model just trained on.
2. **`BLEU` on UniMER-Test/HWE has not collapsed**, and neither have SPE and
   CPE. `python src/train.py` has a test path; point
   `data.test_dataset_paths` at Texo's UniMER-Test. This is the forgetting
   check, and it is the one people skip.
3. **The exported ONNX agrees with PyTorch.** `verify_onnx.py`.
4. **The bench improves on real photos.** `packages/bench`, on the 200-photo
   corpus from ARCHITECTURE §11 step 1. If handwriting accuracy is not up here,
   nothing above matters — and if it is up here while printed accuracy is down,
   you have traded one problem for another.

A fine-tune that improves rendered-stroke BLEU and does nothing for photographs
is the expected failure, not a surprising one. Rendered ink has no paper, no
shadow, no camera blur, no biro bleed. Texo's own training augmentation (Fog,
Frost, Rain, Shadow, Dilation, Erosion) is doing the heavy lifting to bridge
that gap, which is why this pipeline deliberately does not add its own
augmentation on top.

---

## Wiring the result into the app

Two edits, both in `packages/ocr/src/providers/index.ts`.

```ts
export const PROVIDER_CONFIGS: Record<string, TransformersProviderConfig> = {
  texo: {
    id: "texo",
    label: "Texo",
    license: "AGPL-3.0",
    modelId: "your-account/texo-openmath-handwriting",  // was "alephpi/Texo"
    approximateBytes: 22 * 1024 * 1024,                 // measure the real q8 total
    handwriting: "good",
    dtype: "q8",
    maxNewTokens: 512,
    // Only needed if the weights are not on the default model host.
    // remoteHost: "https://weights.example.com",
    // remotePathTemplate: "{model}/resolve/{revision}/",
  },
  // …
};
```

`remoteHost` and `remotePathTemplate` are passed straight through to
transformers.js's `env` in `providers/transformers.ts`, so a host change stays a
one-line change, per ARCHITECTURE §13.

Keep the old entry rather than editing it in place — add
`texo-handwriting` alongside `texo` and switch `DEFAULT_PROVIDER_ID`. That way
the bench can compare them and a regression is one line to undo.

Then update `approximateBytes` with the real number (`export_onnx.py` prints the
q8 total), and `LICENSING.md`'s third-party table, which currently says Texo
weights are "fetched at runtime, not redistributed". That will no longer be
true.

### Benchmarking it

`packages/bench` is being added on the `feat/bench` branch and does not exist
here yet. As of writing it is a `@openmath/bench` workspace package with an
`openmath-bench` binary. Check its README for the real flags; the shape of the
task is: run every provider in `PROVIDER_CONFIGS` over the photo corpus, report
exact-match and edit distance split by printed/handwritten, and compare
`texo` against `texo-handwriting` on the handwritten subset only.

---

## Catastrophic forgetting

The single most likely way this makes the app worse.

Texo was distilled from PPFormulaNet-S and fine-tuned on UniMER-1M, which is
mostly printed formulas. Fine-tuning it on 230k handwritten expressions, with no
printed data in the mix, for three epochs at lr 1e-5, will move it towards
handwriting and away from print. Students photograph textbooks too.

Three mitigations, in order of effort:

- **Mix printed data back in.** `build_dataset.py --replay-dataset` takes any
  `load_from_disk` dataset with the same columns; Texo's own UniMER-Train is the
  obvious one. 10–20% replay is the usual starting point.
- **Fewer epochs, lower LR.** 1–2 epochs at 5e-6 moves less and forgets less.
- **Measure it.** Run the UniMER-Test SPE/CPE/HWE split before and after. If
  SPE drops more than HWE gains, the fine-tune is a regression regardless of how
  good the handwriting numbers look.

The `--require-app-scope` / `--in-app-scope-only` filters make this *worse*, not
better: restricting training to algebra teaches the model that everything is
algebra, and a photographed integral comes back as a plausible polynomial the
app then cheerfully solves. They exist for measurement, not for training runs.
See `openmath_finetune/scope.py`.

---

## The preprocessing gap

Texo's Python preprocessing (`src/texo/data/processor/image_processor.py`) is:
convert to RGB → crop white margins → resize preserving aspect into 384×384 →
pad → normalise with mean 0.7931, std 0.1738.

The app does not do this. `providers/transformers.ts` hands a canvas to
`pipeline("image-to-text", …)` and lets transformers.js preprocess from
`preprocessor_config.json`. `export_onnx.py` writes one describing a
`NougatImageProcessor`, which is the closest standard processor (it has
`do_crop_margin`, `do_thumbnail` and `do_pad`) — **but whether transformers.js
implements the crop-margin step the same way was not verified.**

If it does not, the fix is on the app side and it is small:
`packages/ocr/src/image.ts` already exports `inkBounds()` and `cropTo()`, so the
crop can happen before the canvas reaches the pipeline. Worth checking against
the *current* `alephpi/Texo` repository too — whatever it ships today is what
the app is using now, fine-tune or no fine-tune.

---

## Unverified assumptions

Everything below is a guess or a partial read. It is the list to check first
when something behaves oddly.

| Where | Assumption | Why it might be wrong |
| --- | --- | --- |
| `config/openmath_finetune.yaml` | Texo's config group names and field paths | Read from Texo's `main` at writing time. Renames break it; Hydra will say which key. |
| `config/…yaml` | `model.pretrained` points at `formulanet_distill_best_transfer.pt` | Taken from Texo's own transfer config. Depends on `hf_hub.py pull --with_useful_ckpts` laying files out the same way. |
| `train.py` | Texo's `src/train.py` accepts `--config-name` for a config placed in its `config/` | Follows Texo's documented `train_slurm.yaml` pattern; not run. |
| `export_onnx.py` | `FormulaNetLit.load_from_checkpoint(ckpt, hparams_file=…)` with the `<run>/tb_logs/hparams.yaml` layout | Copied from Texo's `hf_hub.py:save()`, which hardcodes one specific run's path. |
| `export_onnx.py` | q8 == `quantize_dynamic(QInt8, per_channel=False, reduce_range=False)` | Reconstructed from transformers.js's quantize script, not read from it. |
| `export_onnx.py` | transformers.js resolves `dtype:"q8"` to the `_quantized.onnx` suffix under `onnx/` | Consistent with how transformers.js v3 model repos are laid out; not verified against the library. |
| `export_onnx.py` | `NougatImageProcessor` fields reproduce Texo's preprocessing | See [the preprocessing gap](#the-preprocessing-gap). Most likely thing on this list to be wrong. |
| `verify_onnx.py` | `ORTModelForVision2Seq.from_pretrained(..., encoder_file_name=…, decoder_file_name=…)` | Documented optimum API, not exercised. Fallback is in the docstring. |
| `prepare_crohme.py` | Ground truth in `<annotation type="truth">`, `$`-wrapped | Format knowledge, not an inspected file. `--dump-annotations` answers it in one run. |
| `prepare_hme100k.py` | Label file is `<name><sep><latex>` per line | Pure guess; the arguments exist so you can correct it without editing code. |
| `packages/ocr` | `modelId: "alephpi/Texo"` serves transformers.js-compatible ONNX | Pre-existing and already flagged in ARCHITECTURE §13. Texo's own `hf_hub.py` pushes PyTorch weights to `alephpi/FormulaNet`, so the ONNX repo id may well be something else. Confirm during the bench. |
| `requirements*.txt` | These exact pins resolve together | Never installed as a set. |

Two smaller things found while writing this, both in existing app code, both
worth a look independently of fine-tuning:

- `normalizeWithReport` glues an unwrapped font command onto a preceding
  control word: `\cap\mathrm{P}` normalizes to `\capP`, and `\sin\mathrm{x}`
  would become `\sinx`. Rare, but it turns a readable expression into a parse
  error rather than a wrong answer.
- The same pass turns a LaTeX row break `\\` into `\ ` (its `\\ ` → space rule
  eats the second backslash). Only reachable inside environments the app refuses
  anyway.

Neither is fixed here — they belong in `packages/ocr`, not in a training tool —
and neither affects this pipeline, which drops the affected rows during the
vocabulary check.

---

## What was actually verified

Run here, and passing:

- **`python -m unittest discover -s tools/finetune/tests`** — 23 tests. Includes
  a 60-case parity check of `openmath_finetune/normalize.py` against
  `packages/ocr/src/normalize.ts`, with the golden file generated by running the
  real TypeScript (`tests/gen_golden.mts`).
- **MathWriting end to end, on the 500-ink excerpt.** Downloaded from the real
  URL, parsed, rasterised, labelled, vocabulary-checked: 480/500 kept, the 20
  rejects all `\begin{bmatrix}`-style environments genuinely outside Texo's
  vocabulary. The rendered PNGs are legible handwriting.
- **`build_dataset.py`** on that manifest, and reading it back with the exact
  expression Texo uses: `Image.open(io.BytesIO(row["image"]))`. Worked, on
  `datasets` 5.0.1 rather than the pinned 4.0.0.
- **`train.py --dry-run`** against a stub directory, producing the full Hydra
  command line and the computed step count.
- **`python -m py_compile`** on every script.

Read but not run, from the real Texo repository (via
`raw.githubusercontent.com`), which is where the config field names, the
dataset schema and the tokenizer facts come from: `src/train.py`,
`src/task.py`, `src/datamodule.py`, `src/texo/data/dataset.py`,
`src/texo/data/processor/*`, `src/texo/model/formulanet.py`,
`scripts/python/{normalize,hf_hub,export_onnx}.py`, `config/**`,
`data/tokenizer/tokenizer.json` and `data/tokenizer/normalizer/*.txt`.

Never run, in any form: training, ONNX export, ONNX verification, CROHME
preparation, HME100K preparation.

---

## Layout

```
openmath_finetune/       importable pieces, all tested
  normalize.py           port of packages/ocr/src/normalize.ts
  latex_tokens.py        LaTeX -> Texo's whitespace token stream, vocabulary check
  texo_tables.py         Texo's synonym tables, read from a Texo checkout
  label.py               the one place a ground truth becomes a training label
  inkml.py               InkML reader (MathWriting and CROHME shapes)
  render.py              strokes -> PNG
  inkjob.py              parallel rasterising, shared by two prepare scripts
  scope.py               what the solver can consume; reporting and an opt-in filter
  manifest.py            the JSONL manifest and its summary
  cli.py                 shared arguments

prepare_mathwriting.py   primary source; download, render, label
prepare_crohme.py        secondary; same path, unverified layout
prepare_hme100k.py       secondary; photographs, unverified layout
build_dataset.py         manifests -> save_to_disk datasets for Texo
train.py                 thin driver over Texo's Lightning + Hydra pipeline
export_onnx.py           checkpoint -> q8 ONNX in the transformers.js layout
verify_onnx.py           PyTorch vs ONNX, tensors and strings

config/openmath_finetune.yaml   Hydra config, copied into a Texo checkout
tests/                   unittest; no GPU, no network, no dataset needed
```

Not part of the pnpm workspace: `pnpm-workspace.yaml` globs `packages/*` and
`apps/*` only, `vitest.config.ts` only collects `packages/*/test` and
`apps/*/test`, and nothing here is referenced from `tsconfig.json`.
