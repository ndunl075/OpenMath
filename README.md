# OpenMath

Free, open-source math solver. Point your camera at a problem and see every
step, not just the answer.

Everything runs in your browser. No account, no ads, no subscription, no server.
Your photos never leave your device.

**Status:** v1 in development. Algebra through quadratics works end to end.
Recognition is wired but has not yet been benchmarked on real photos, see
[Known gaps](#known-gaps).

## Why

Photomath's free tier shows steps for basic problems and paywalls them for the
harder ones, along with the explanations, at $9.99/month. Microsoft Math Solver,
the main free alternative, was discontinued in July 2025. Students are paying a
subscription to see working that a symbolic solver can produce for nothing.

## How it works

```
photo -> OCR (on device) -> LaTeX -> parse -> step engine -> verified steps
```

No large language model anywhere. Recognition is a small purpose-built
vision-encoder-decoder that runs on a phone CPU. The solving is pure symbolic
mathematics with hand-written rules. This is a solved problem from before the
LLM era, and doing it that way is what makes it free to run.

Every step is checked before you see it. Expressions are verified by sampling,
equations by confirming that `lhs - rhs` stays proportional, and every root is
substituted back into the original problem. A step that fails verification is
hidden rather than displayed, and the app says so.

## What it handles today

Arithmetic and exact fractions, powers and roots, expanding brackets,
collecting like terms, algebraic fractions, linear equations and inequalities,
and quadratics by factoring or the formula with exact radical roots.

Out of scope for v1, and refused clearly rather than answered wrongly: word
problems, calculus, systems of equations, matrices, and trigonometric equations.

## Repository layout

| Package | What it is | Licence |
| --- | --- | --- |
| `packages/math-core` | Exact rational arithmetic, AST, LaTeX parser and serializer | MIT |
| `packages/steps` | The rule engine, explanations and step verification | MIT |
| `packages/step-motion` | Animations generated from step data | MIT |
| `packages/ocr` | Image preprocessing, LaTeX normalizer, model providers | MIT |
| `packages/corpus` | Regression problems with hand-written answers | MIT |
| `packages/bench` | The OCR accuracy benchmark and its corpus format | MIT |
| `apps/web` | The Preact PWA | MIT |

`packages/steps` is the interesting one and the part worth forking. It has no
dependency on the app, the camera, or any model.

Outside the pnpm workspace, `tools/finetune/` is a Python setup for fine-tuning
the recognition model on handwritten datasets, kept against the contingency in
[Known gaps](#known-gaps). It has never been run, and its README says so up top.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 240 tests
pnpm typecheck
```

Requires Node 22 and pnpm 10.

## Deploying

Static files, so any host works. Vercel is configured in `vercel.json`:

```bash
pnpm --filter @openmath/web build   # outputs apps/web/dist
```

First load is about 125 kB gzipped. The recognition model is a separate
download, fetched only when someone actually scans, and cached afterwards.

## Contributing

The highest-value contribution is **coverage**: a rule for a kind of problem
OpenMath cannot solve yet. [CONTRIBUTING.md](./CONTRIBUTING.md) walks through
adding one, which is roughly forty lines plus a corpus entry.

Found a wrong answer or a misread scan? Open an issue with the expression. The
app has a report button that prefills one for you.

## Known gaps

These are real and worth knowing before you rely on it:

- **Recognition is unverified on real photos.** The model providers are wired
  and the preprocessing is tested, but no accuracy benchmark has been *run* on
  actual homework. The harness to run it is `packages/bench`; what it lacks is
  photos. See ARCHITECTURE §11 step 2.
- **The photo corpus does not exist yet.** `packages/corpus` is text problems,
  which gate the solver. Photos gate the model choice, and
  [packages/bench/README.md](./packages/bench/README.md) says how to shoot and
  label the first twenty in half an hour.
- **Handwriting is untested.** Texo is the default on its published handwriting
  score, not on anything measured here.

## Privacy

The only network requests are the app itself and, on first scan, the model
weights. Images, expressions and history stay on your device. There is no
analytics, no error reporting service and no telemetry of any kind.

## Licence

MIT. See [LICENSE](./LICENSE) and [LICENSING.md](./LICENSING.md), which explains
the model-licensing question and how to change the default model.

Not affiliated with, endorsed by, or derived from any commercial math app.
