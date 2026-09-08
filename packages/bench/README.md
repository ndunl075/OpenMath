# `@openmath/bench` — the OCR benchmark

Recognition is the one part of OpenMath nobody has measured. The step engine is
checked against 77 problems in CI; the models are wired up on the strength of
their published scores and nothing else. This package turns "did the scan work?"
into a number, per model and per kind of photo, that can be re-run after every
change to the pipeline, the preprocessing, or the weights.

It needs a corpus of real homework photos. Shooting and labelling twenty of them
takes half an hour and is described below.

## Running it

```bash
pnpm bench --corpus corpus/photos                        # the default provider
pnpm bench --corpus corpus/photos --provider all         # all three, one table each
pnpm bench --corpus corpus/photos --baseline results.json  # what changed since last time
pnpm bench --corpus corpus/photos --check                # labels only, no model
```

| Flag | What it does |
| --- | --- |
| `--corpus <dir>` | Directory holding the photos and `manifest.jsonl`. Required. |
| `--provider <id>` | `texo`, `texteller`, `pix2text-mfr`, a comma-separated list, or `all`. Default `texo`. |
| `--out <file>` | Machine-readable results. Default `results.json`. |
| `--baseline <file>` | An earlier `results.json`; prints per-metric deltas and which photos changed verdict. |
| `--category <name>` | Score only `printed`, `handwritten` or `screen`. |
| `--limit <n>` | Only the first n photos, for a quick check. |
| `--device <name>` | `auto` (default), `wasm` or `webgpu`. See [Latency](#latency-and-what-it-is-worth). |
| `--no-preprocess` | Feed the model the untouched photo, to measure what preprocessing is buying. |
| `--check` | Validate and audit the corpus, then stop. Loads no weights, so it works offline. |
| `--misses <n>` | How many failing photos to print per provider. Default 10; the rest are in `results.json`. |

The weights are downloaded on first use. If that fails the run says which model,
which repo id, and what to check, then exits non-zero without writing results.

## The corpus format

A directory of images plus a `manifest.jsonl`: one JSON object per line, one
line per photo. Blank lines and `#` comments are ignored.

```jsonl
# 20 photos, shot 2026-09-08, iPhone 12, Year 9 textbook and my own handwriting
{"file": "001.jpg", "latex": "2x + 3 = 7", "category": "printed", "notes": "textbook, good light", "answer": "x = 2"}
{"file": "002.jpg", "latex": "3x = 12", "category": "handwritten", "lighting": "dim", "skew": "slight"}
{"file": "003.jpg", "latex": "x^{2} - 5x + 6 = 0", "category": "screen", "notes": "whiteboard, photographed off a laptop"}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `file` | yes | Image filename, relative to the corpus directory. |
| `latex` | yes | Ground truth: the LaTeX a careful human reads off the photo. |
| `category` | yes | `printed`, `handwritten` or `screen`. Every metric is reported per category. |
| `notes` | no | Free text for a human. Never scored. |
| `lighting` | no | `good`, `dim`, `glare` or `shadow`. |
| `skew` | no | `none`, `slight` or `strong`. |
| `crop` | no | `{x, y, width, height}` in source pixels, standing in for the viewfinder box when a photo holds more than one problem. |
| `answer` | no | The answer written by hand. Cross-checked against the solver, not used for scoring. |

`lighting` and `skew` earn their place because "handwriting is weak" and "photos
in bad light are weak" have different fixes: one is a fine-tune of the model, the
other is the preprocessing chain or, if skew dominates, the perspective
correction that ARCHITECTURE §3 currently rules out. Without those two fields a
bad number says only that something is wrong.

`answer` earns its place differently. It is not scored, because the harness
measures the pipeline we ship and that pipeline gets its answer from the solver.
It is checked: if the hand-written answer and the solver disagree, either the
photo is mislabelled or the step engine has a bug, and both are worth knowing
before a model is blamed. `--check` reports those disagreements, along with any
ground truth the solver cannot answer at all. Write it as you would say it —
`x = 2`, or just `2` — and note that a label the solver cannot read on its own,
such as two roots written out in prose, is skipped rather than reported as a
disagreement.

Write `latex` the way you would type it, not the way a model would emit it. Both
sides go through `normalizeLatex` before anything is compared, so `x^2` and
`x^{2}` and `$$x^2$$` are the same string as far as scoring is concerned.

## Shooting and labelling 20 photos in 30 minutes

Twenty photos will not settle whether Texo beats TexTeller, but it will tell you
whether recognition works at all, which is the open question. Aim for 200 later.

**Minutes 0-5, gather the problems.** Eight from a printed source (textbook,
worksheet, a past paper), eight in your own handwriting on paper — use a pencil
for half of them, and squared paper for a couple — and four from a screen. Keep
them inside what the solver covers (arithmetic, fractions, powers and roots,
expanding, like terms, linear equations and inequalities, quadratics), and throw
in two it should refuse, so the refusal path is measured too.

**Minutes 5-15, shoot.** One expression per frame, filling the frame the way the
app's viewfinder would: the model sees the crop, not the page. Phone parallel to
the paper. Do not edit, straighten or filter afterwards — the whole point is
what a phone actually produces. Deliberately vary the conditions, roughly: three
in dim indoor light, two with glare or a hard shadow across the page, two held
at a slight angle. Copy them into the corpus directory.

**Minutes 15-20, rename.** They need stable names, in order:

```bash
cd corpus/photos
i=1; for f in $(ls -tr IMG_*.jpg); do mv "$f" "$(printf '%03d.jpg' $i)"; i=$((i+1)); done
```

**Minutes 20-30, label.** Open the photos one at a time and type what you see,
not what you meant to write: a `5` that reads as an `S` in the photo is a
labelling decision, and the rule is that the ground truth is what a careful human
reads off *that image*. One line per photo, roughly 30 seconds each. Then:

```bash
pnpm bench --corpus corpus/photos --check
```

That loads no model. It fails on a missing file, a duplicate, a typo in a field
name, or LaTeX the parser cannot read — which is also a fast way to catch a
mistyped label — and it lists any problem the solver cannot answer, so you can
replace it before it dilutes the run.

Photos of other people's work, or anything with a name on it, do not belong in a
public corpus. Keep the corpus directory out of git unless every photo is yours.

## What it measures

Four accuracy numbers per provider, each also broken down by category.

### Answer match — the headline

Does the recognised LaTeX lead to the *same answer* as the ground truth does?
Both are solved with `trySolve`, and the two results are compared as
mathematics: same kind of problem, same variable, same set of solutions, with
values compared by the step engine's own sampling verifier rather than as text.

This is the number that decides whether recognition is good enough to ship,
because it is the only one that tracks what a student sees:

- `2x + 3 = 7` read as `2 \cdot x + 3 = 7` is a character-level miss and a
  perfect result. The student gets `x = 2` either way.
- `3x + 12 = 30` read as `3x + 12 = 3O` is a 97%-similar string and a total
  failure. It does not parse, so the app shows nothing at all.

A model that wins on character error rate and loses on answer match is the wrong
model for this product.

**Denominator.** Answer match is scored over the photos whose *ground truth* the
solver can answer. An equation that is out of scope, or one the rule engine
cannot solve yet, scores nothing for any model, and counting it as a failure
would move the number when the solver gains a rule rather than when recognition
improves. The count is printed next to the rate and stored in `results.json`, so
the subset is never silent.

### Exact match

The recognised LaTeX equals the ground truth after `normalizeLatex` on both
sides. Strict, easy to reason about, and the right number to watch when the goal
is an editable field a student can trust — but it punishes harmless spelling
differences, so it is a secondary metric here.

### Character error rate

Levenshtein distance over code points, divided by the length of the ground
truth. Implemented in `distance.ts` rather than pulled in as a dependency: it is
twenty lines, and the headline numbers of a benchmark should come from code the
repo can read.

The corpus-level CER pools every edit over every ground-truth character rather
than averaging the per-photo rates, so one short expression read badly cannot
outweigh a page of long ones read well. The mean of per-photo rates is reported
alongside it as `meanCer`. CER is not clamped at 1: a model that hallucinates a
paragraph for a two-character problem should score above 1, and hiding that would
hide the failure mode.

CER is the number to watch while *fine-tuning*, because it moves smoothly.
Answer match is the number to watch while *deciding*, because it is what ships.

### Solvable rate

Does the recognised LaTeX parse and solve at all, ignoring whether the answer is
right? The gap between solvable and answer-match is misreads that stayed
plausible — a digit swapped for another digit. The gap between 100% and solvable
is misreads that produced garbage. They have different fixes, so they are
counted separately, and the reasons (`parse`, `unsupported`, `out-of-scope`,
`empty`, `error`) are broken out under the table.

### Latency, and what it is worth

Median and p90 of inference per photo, with p90 taken by nearest rank so it is a
measurement rather than an interpolation. Model load — the weights download plus
session creation — is reported separately and never mixed in: it is a first-run
cost paid behind a progress bar, while inference is what a student waits for on
every scan.

**These latencies are not phone latencies.** The bench runs in Node on whatever
machine you are sitting at, and `--device auto` lets the runtime pick its fastest
backend, while the app runs `wasm` in a browser on a mid-range Android. Accuracy
carries over from this bench to the phone; timing does not. ARCHITECTURE §11
step 2 asks for on-device measurements, and this harness is not that: use
`--device wasm` for a closer-to-honest comparison between providers, and measure
the phone on the phone.

## Results, and comparing runs

Every run writes `results.json`: the corpus summary, per-provider metrics
overall and per category, and every individual read with its scores and timings.
Point a later run at it with `--baseline` and the report adds a delta column per
metric, plus the two lists that matter after a change:

- **regressed** — photos that used to reach the right answer and no longer do,
  with what was read before and after.
- **fixed** — photos the change repaired.

A fine-tune that moves the headline up by two points while breaking four
handwritten photos is a different decision from one that moves it up by two
points cleanly, and only the per-photo lists show the difference.

## Testing this without photos or models

The scoring, aggregation, reporting and diffing are pure functions over strings,
and are covered by `test/` with a stub `OcrProvider` that returns canned reads.
That is deliberate: the harness had to be trustworthy before the first photo
existed, otherwise the first real run would be measuring two unknowns at once.
`pnpm test` exercises all of it and touches no network.

## How a browser model runs in Node

`packages/ocr` hands a model a canvas, because in the browser both ends already
speak that. Node has neither `OffscreenCanvas` nor `ImageData`, so `node-canvas.ts`
installs a minimal pair before any provider loads.

The unobvious part: transformers.js only reads a canvas in a browser, and throws
in Node, but it decodes a `Blob` with sharp. So the shim canvas *is* a `Blob`
whose bytes are a PNG of what was drawn into it, and the library takes its normal
Node path. If a future version changes how it reads its input, that class is the
single seam to fix, and `test/node-image.test.ts` checks the seam against the
real library when it is installed.

Photos are decoded with sharp, honouring the EXIF orientation tag that phones set
instead of rotating pixels, and then go through the same `preprocess` chain the
app uses — the bench does not reimplement any of it.

## What this does not measure

- On-device latency, memory, or whether the model survives iOS Safari's limits.
- The first-load download over cellular.
- The editable result field, which in practice rescues a large share of misreads:
  a student fixing one character is a success the harness scores as a failure.
- Anything about photos nobody has taken yet. Twenty is a smoke test; the
  decision between models needs the 200-photo corpus of ARCHITECTURE §11 step 1.
