# OpenMath — Architecture Guide

Free, open-source, camera-to-steps math solver. Runs 100% in the browser. No backend, no accounts, no LLMs, $0 to host.

## 0. Decisions (read this if nothing else)

| Decision | Choice | Why |
|---|---|---|
| Platform | PWA (installable web app), mobile-first | No app-store review, no $99/yr, no copycat rejection, works on every phone |
| Compute | Everything on-device in the browser | $0 hosting, no cold starts, images never leave the phone (local-first) |
| OCR | Texo (20M params, in-browser via transformers.js) behind a swappable `OcrProvider` | Best accuracy-per-byte available; handwriting-capable; reference web impl exists |
| Solver | Own TypeScript rule engine, seeded from google/mathsteps, every step verified by a CAS | No maintained off-the-shelf step engine exists; the step engine *is* the product |
| Calculus | v2 derivatives in TS; v3 integrals via lazy-loaded SymPy (Pyodide) | Keeps v1 small; SymPy is the only free step-capable integrator |
| Hosting | Cloudflare Pages (app) + Hugging Face Hub (weights) | Both free, CDN-backed, CORS-enabled |
| UI | Copy Photomath's *flow*, not its brand | Google owns Photomath; trade dress + asset copyright risk |
| License | See §9 — Texo is AGPL-3.0, which forces a choice | Decide before first release |
| v1 scope | Algebra only (simplify, solve linear/quadratic, factor, fractions, exponents) | Ship a measured 80%+ on a real corpus, then widen |

## 1. Pipeline

```
camera / photo upload
  └─ viewfinder crop (user positions the box → no detection model needed)
      └─ preprocess (canvas: grayscale, resize, contrast; no OpenCV.js)
          └─ OCR  [Web Worker]  image → LaTeX          (Texo via transformers.js)
              └─ normalize LaTeX (fix OCR quirks)
                  └─ parse  LaTeX → MathJSON             (@cortex-js/compute-engine)
                      └─ classify (simplify | solve | derivative | integral | unsupported)
                          └─ step engine  MathJSON → Step[]   (packages/steps)
                              └─ verify each step with CAS   (compute-engine isEqual / numeric sampling)
                                  └─ render (KaTeX), editable input (MathLive)
```

Zero network calls after first load except fetching the app shell and model weights, both cached by the service worker.

## 2. Component table

| Layer | Library | License | Size (approx) | Notes |
|---|---|---|---|---|
| OCR model | [Texo](https://github.com/alephpi/Texo) | AGPL-3.0 | 20M params → ~20 MB int8 / ~40 MB fp16 | PPHGNetV2 encoder + transformer decoder; fine-tuned on UniMER-1M; HWE (handwritten) BLEU 0.86 |
| OCR fallback (all-MIT path) | [Pix2Text MFR 1.5](https://github.com/breezedeus/Pix2Text) | MIT | ~120 MB fp32 ONNX → ~30 MB int8 | TrOCR-based; use if AGPL is unacceptable |
| OCR runtime | transformers.js (or onnxruntime-web) | Apache-2.0 | — | WASM now, WebGPU when stable; run in a Worker |
| Parser / CAS | [@cortex-js/compute-engine](https://github.com/cortex-js/compute-engine) | MIT | — | LaTeX ↔ MathJSON, simplify, solve, numeric eval, equality |
| Math input | MathLive | MIT | — | Math keyboard + "fix the scan" editor; emits MathJSON natively |
| Step engine | `packages/steps` (ours) | MIT | — | Seeded from [google/mathsteps](https://github.com/google/mathsteps) (Apache-2.0, archived Aug 2024, pins mathjs 3.11.2) |
| Render | KaTeX | MIT | — | Step cards; faster than MathJax |
| Calculus (v3) | SymPy via Pyodide | BSD / MPL | ~15–20 MB lazy | `sympy.integrals.manualintegrate.integral_steps` + SymPy Gamma's step renderers |
| Hosting | Cloudflare Pages | free | 25 MiB/file cap | Unlimited bandwidth; GitHub Pages is the fallback (100 MB/file) |
| Weights hosting | Hugging Face Hub model repo | free | — | Model repos are still free; only Spaces compute went paid. Mirror to GitHub Releases |
| CI | GitHub Actions | free for public repos | — | Corpus tests block merge |

Explicitly **not** used: any LLM API, Cloud Run, Cloudflare Workers, HF Spaces, OpenCV.js, pix2tex/LaTeX-OCR (100 K rendered-only training set, weak on handwriting, >100 MB ONNX).

## 3. OCR

**Interface** (everything above it must not know which model is loaded):

```ts
interface OcrProvider {
  id: string;
  load(onProgress?: (pct: number) => void): Promise<void>;
  recognize(img: ImageBitmap): Promise<{ latex: string; confidence?: number }>;
}
```

**Preprocessing** (plain canvas, ~50 lines): crop to viewfinder → grayscale → resize longest side to the model's expected input → contrast stretch. Perspective correction is out of scope; the viewfinder does the job.

**Runtime**: model runs in a Web Worker so the camera view never janks. First load shows a progress bar with the byte count; weights are cached (Cache Storage) so the second scan is offline. Keep the int8 build as default for iOS Safari memory limits.

**Editable result**: always show the recognized LaTeX in a MathLive field before solving. Users fix OCR mistakes in two taps instead of rescanning. This one UX choice covers more OCR failures than any model swap.

**Handwriting**: Texo is trained on printed + handwritten (UniMER-1M includes HWE). If handwriting is weak on the corpus, fine-tune Texo using its open training pipeline on MathWriting (Google, 230 k handwritten expressions) / HME100K / CROHME. Consumer-GPU trainable per the Texo README.

## 4. Parsing and classification

1. **Normalize** OCR LaTeX: strip `\left`/`\right`, `\displaystyle`, `\,`; map `\times`/`\cdot` consistently; `x^{2}` ↔ `x^2`; fix `\frac` without braces; collapse whitespace.
2. **Parse** with compute-engine → MathJSON. Parse failure = "couldn't read that, edit or rescan."
3. **Classify** by MathJSON root:
   - `Equal` with one free variable → **solve**
   - `Equal` with 2+ variables → solve for `x`/`y` heuristically, else unsupported
   - `Less`/`Greater` → **inequality** (v1.5)
   - `D`, `\frac{d}{dx}` → **derivative** (v2)
   - `Integrate`, `\int` → **integral** (v3)
   - otherwise → **simplify / evaluate**
   - anything with words, matrices, or systems → unsupported (graceful state + report button)

## 5. Step engine (`packages/steps`) — the product

```ts
type Step = {
  ruleId: string;        // e.g. "ADD_LIKE_TERMS"
  before: string;        // LaTeX
  after: string;         // LaTeX
  explanation: string;   // from explanations/<locale>.json, templated
  substeps?: Step[];
};
interface StepEngine {
  canSolve(p: Problem): boolean;
  solve(p: Problem): { steps: Step[]; answer: string };
}
```

**v1 = vendored mathsteps behind an adapter.** MathJSON → mathjs-3 expression string → mathsteps `simplifyExpression` / `solveEquation` → each `newNode.toTex()` → LaTeX. Buys 2 years of pedagogical rules plus their test suite. Don't upgrade its mathjs; it is pinned for a reason.

**v1.5+ = native MathJSON rules.** Port rules one category at a time, using mathsteps' tests as the acceptance corpus, then delete the adapter. This is where contributors add coverage. Rule = `{ id, match(expr) → boolean, apply(expr) → expr }`; the engine runs a fixed ordering (simplify arithmetic → collect terms → move terms across equals → isolate → check).

**Explanations** live in `explanations/en.json` keyed by `ruleId` with placeholders (`"Move {term} to the other side"`). Adding a rule requires adding its explanation; CI enforces it. Localization is a JSON PR.

**Verification (non-negotiable).** For every step, `ce.parse(before).isEqual(ce.parse(after))`; for equations, substitute solutions back; if the CAS can't decide, sample 5 random points with tolerance. Fails → show the answer only, hide steps, surface the report button. Same check runs in CI over the corpus. A hand-written rewrite engine will produce wrong steps; this is what keeps them off screen.

**Roadmap**: derivatives in TS (power/product/quotient/chain rules are a clean rule set, ~1–2 weeks). Integrals via Pyodide + SymPy `integral_steps`, loaded only when an `\int` is classified.

## 6. UI

Copy the interaction model, which is functional and not protectable:

1. **Scan**: full-screen camera, draggable/resizable viewfinder, one big capture button, gallery upload, flashlight.
2. **Confirm**: recognized expression in a MathLive field (editable), "Solve" button.
3. **Result**: bottom sheet with the answer, then a "Show steps" expander.
4. **Steps**: one card per step, before → after, changed sub-expression highlighted, tap for the explanation; nested cards for substeps.
5. **Unsupported**: "Can't solve this type yet" + what *is* supported + "Report" (opens a prefilled GitHub issue with the LaTeX; the user attaches the photo manually — zero infra).
6. **History**: local only (IndexedDB), clearable.

Do **not** copy: name, logo, red palette, icon set, illustrations, animations, microcopy. Build your own identity; the launch content needs to be visually distinguishable anyway.

## 7. Hosting and delivery

- **App**: Cloudflare Pages from `main` (free, unlimited bandwidth, `*.pages.dev` subdomain; a custom domain is the only optional cost).
- **Weights**: Hugging Face Hub model repo; transformers.js fetches from it by default. Mirror the ONNX files to GitHub Releases and make the host configurable (`env.remoteHost`) so a provider change is a one-line fix.
- **PWA**: service worker precaches the app shell; weights cached on first run; manifest for "Add to Home Screen"; works fully offline afterward.
- **CI**: lint, typecheck, unit tests, corpus tests (`packages/corpus`), and a bundle-size budget. Corpus regressions block merge.
- **No telemetry, no analytics, no error reporting service.** The GitHub issue flow is the feedback channel.

## 8. Privacy

Images and expressions never leave the device. The only outbound requests are the app shell and model weights. State this on the landing page in one sentence; it is the differentiator against every ad-supported clone.

## 9. Licensing — decide before release

Texo (code and weights) is AGPL-3.0. Shipping it in the browser bundle makes the app a derivative work in any conservative reading. Two clean options:

- **A (recommended)**: `apps/web` under AGPL-3.0; `packages/steps`, `packages/math-parse`, `packages/corpus` under MIT with their own LICENSE files. The step engine is the thing others would actually fork, and it stays permissive. Students and contributors don't care about AGPL; only companies do.
- **B (all-MIT)**: swap the default `OcrProvider` to Pix2Text MFR 1.5 (MIT). Cost: larger download, unmeasured accuracy gap. Run both on the corpus before choosing.

Never mix: don't put AGPL code in the MIT packages.

## 10. Repo layout (pnpm workspace)

```
apps/web/              PWA (Vite + TS; reuse Texo-web's Nuxt inference code only if you accept AGPL)
packages/ocr/          OcrProvider interface, preprocess, providers/texo, providers/pix2text
packages/math-parse/   LaTeX normalizer, compute-engine wrapper, classifier
packages/steps/        step engine, rules/, explanations/, verify/
packages/corpus/       real problem photos + LaTeX + expected answer/steps; bench + test runners
tools/models/          Python: export + int8-quantize ONNX, push to HF Hub
```

## 11. Build order

1. **Corpus first** (before any code): 200 photos of real homework — printed textbook, worksheets, handwriting, bad lighting — each labeled with ground-truth LaTeX and expected answer. This decides everything downstream.
2. **OCR bench**: Texo vs Pix2Text MFR on the corpus, in-browser on a mid-range Android and an older iPhone. Record accuracy, load time, latency. Pick the license path (§9).
3. **Vertical slice**: photo → LaTeX → mathsteps → KaTeX, ugly UI, on a phone. Measure corpus solve coverage.
4. **Product**: scan/confirm/result/steps screens, PWA, offline, report flow.
5. **v1 launch**: algebra at ≥80% corpus coverage, with the unsupported-state honest about limits.
6. **v2**: derivatives (TS). **v3**: integrals (Pyodide + SymPy). **v4**: native MathJSON rule engine replaces mathsteps.

## 12. Non-goals (v1)

Word problems (reading comprehension is an LLM-shaped problem; revisit only by reopening the no-LLM decision), graphs, geometry figures, matrices, systems of equations, accounts, sync, native apps, any server.

## 13. Risks

| Risk | Mitigation |
|---|---|
| OCR fails on handwriting / bad photos | Viewfinder crop, preprocessing, editable result field, fine-tune on MathWriting, report flow |
| Wrong step shown | CAS verification per step (§5); corpus tests in CI |
| 20–40 MB first download on cellular | Show size, download once, cache forever, int8 default |
| iOS Safari WASM memory | Worker + int8 model; avoid loading two models at once |
| Texo / HF hosting terms change | `OcrProvider` swap + configurable weight host + GitHub Releases mirror |
| mathsteps bugs (archived) | It's a seed, not a dependency; verification hides bad output; native engine replaces it |

## 14. Market check (verified Sep 2026)

- Photomath free tier shows steps for basic problems; Plus ($9.99/mo, $69.99/yr) paywalls steps for harder problems, explanations, animated tutorials, textbook solutions.
- Microsoft Math Solver, the main free-with-steps competitor, was discontinued in July 2025 (mobile apps pulled, site down).
- Hugging Face removed free CPU Spaces and made Gradio/Docker Spaces paid in 2026; model/dataset repo hosting is unaffected.
- google/mathsteps was archived Aug 29, 2024.

Launch message: *steps for the hard problems, full explanations, offline, no account, no ads, open source.*

## References

- Texo: https://github.com/alephpi/Texo · web app: https://github.com/alephpi/Texo-web · demo: https://texocr.netlify.app/
- Pix2Text: https://github.com/breezedeus/Pix2Text · MFR model: https://huggingface.co/breezedeus/pix2text-mfr-1.5
- UniMERNet (benchmark + dataset; models too large for browser): https://github.com/opendatalab/UniMERNet
- mathsteps: https://github.com/google/mathsteps
- Compute Engine: https://github.com/cortex-js/compute-engine · MathLive: https://mathlive.io
- SymPy Gamma step renderers: https://github.com/sympy/sympy_gamma
- MathWriting dataset: https://dl.acm.org/doi/10.1145/3711896.3737436
- Photomath pricing/free tier: https://www.myengineeringbuddy.com/blog/photomath-reviews-alternatives-pricing-offerings/
- Microsoft Math Solver shutdown: https://x.com/MicrosoftMath/status/1832066391169810572 · https://learn.microsoft.com/en-us/answers/questions/4749595/please-bring-back-math-solver
- HF Spaces free-tier change: https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703
