# OpenMath — Architecture Guide

Free, open-source, camera-to-steps math solver. Runs 100% in the browser. No backend, no accounts, no LLMs, $0 to host.

> **Status, updated during implementation.** Everything below is built except the
> photo corpus and the OCR bench (§11 steps 1 and 2), which need real homework
> photos. Three decisions changed once the code existed; each is marked
> **[revised]** with the reason. See the [README](./README.md) for what works today.

## 0. Decisions (read this if nothing else)

| Decision | Choice | Why |
|---|---|---|
| Platform | PWA (installable web app), mobile-first | No app-store review, no $99/yr, no copycat rejection, works on every phone |
| Compute | Everything on-device in the browser | $0 hosting, no cold starts, images never leave the phone (local-first) |
| Parser + CAS | **[revised]** Own AST and LaTeX parser, not compute-engine | compute-engine canonicalises on parse, so `x + x` arrives already folded to `2x` and the `before` state a step engine must show is gone. Own AST also gives the stable node ids animations need |
| OCR | Texo (20M params, in-browser via transformers.js) behind a swappable `OcrProvider` | Best accuracy-per-byte available; handwriting-capable; reference web impl exists |
| Solver | **[revised]** Own TypeScript rule engine written directly, not vendored mathsteps; every step verified | mathsteps pins mathjs 3.11.2 from 2017 and was archived Aug 2024. Bundling it ships a large CommonJS dependency into an app whose pitch is a small download. Its rule coverage informed ours; none of its code is used |
| Calculus | v2 derivatives in TS; v3 integrals via lazy-loaded SymPy (Pyodide) | Keeps v1 small; SymPy is the only free step-capable integrator |
| Hosting | **[revised]** Vercel (app) + Hugging Face Hub (weights) | Vercel by owner preference; the app is static files so any host works. `vercel.json` is committed |
| UI | Copy Photomath's *flow* (screens, gestures, the idea of animated steps); build every asset ourselves | Flow is functional and free; files, artwork, and authored animations are Google's |
| Step animations | Generated programmatically from our own step data (§6.1), not hand-authored | Scales with the rule engine; cannot reproduce anyone's assets by construction |
| License | **[revised]** MIT throughout. See [LICENSING.md](./LICENSING.md) | The app ships no Texo code and no Texo weights: transformers.js does inference and the browser fetches weights at runtime. Nothing copyleft is in the repo or the bundle, so AGPL would be a choice rather than an obligation |
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
| Parser / CAS | `packages/math-core` (ours) | MIT | small | Exact BigInt rationals, AST with stable node ids, LaTeX parser and serializer, numeric and exact evaluators. No runtime dependencies |
| Math input | Plain field + KaTeX preview + custom keypad | MIT | — | MathLive dropped: a full math editor is a large dependency for something mostly used to fix two characters after a scan |
| Step engine | `packages/steps` (ours) | MIT | small | 30 rules, explanations, CAS verification. Coverage informed by [google/mathsteps](https://github.com/google/mathsteps) (Apache-2.0, archived Aug 2024); no code used |
| Render | KaTeX | MIT | — | Step cards; faster than MathJax |
| Calculus (v3) | SymPy via Pyodide | BSD / MPL | ~15–20 MB lazy | `sympy.integrals.manualintegrate.integral_steps` + SymPy Gamma's step renderers |
| Hosting | Vercel | free | — | Static output, so Cloudflare Pages and GitHub Pages work with no code change |
| Weights hosting | Hugging Face Hub model repo | free | — | Model repos are still free; only Spaces compute went paid. Mirror to GitHub Releases |
| CI | GitHub Actions | free for public repos | — | Corpus tests block merge |

Explicitly **not** used: any LLM API, Cloud Run, Cloudflare Workers, HF Spaces, OpenCV.js, MathLive, mathjs, compute-engine, and pix2tex/LaTeX-OCR (100 K rendered-only training set, weak on handwriting, >100 MB ONNX).

Measured first load: **125 kB gzipped** (KaTeX 76, app 33, CSS 12, worker 5). Enforced in CI by `scripts/check-bundle-size.mjs` against a 200 kB budget. The OCR model is a separate deferred download and is excluded from that budget.

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
  changes: Change[];     // what moved/merged/vanished; drives highlighting + animation (§6.1)
  substeps?: Step[];
};
type Change = {
  kind: "move" | "combine" | "cancel" | "add" | "replace" | "apply-both-sides";
  from: Path[];          // MathJSON paths in `before`
  to: Path[];            // MathJSON paths in `after`
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

## 6. UI: copy the flow, own every asset

**The rule.** Interaction model, screen order, layout proportions, gestures, and the *concept* of animated step-by-step solving are functional ideas. Nobody owns them, and we use them freely. What we never copy is a file or a piece of artwork: name, logo, icons, illustrations, the palette as a set, microcopy, and Photomath's authored tutorial animations. Everything below is built from scratch with our own assets. The step animations are generated from our own step data (§6.1), so they cannot reproduce anyone's files by construction. Don't describe the app as a "clone" in launch content; describe what it does.

### 6.0 Screens and gestures (the flow we copy)

1. **Scan** — full-bleed live camera. Viewfinder box with rounded corners and corner handles: drag to move, pinch or drag handles to resize; everything outside the box is dimmed. Bottom bar: gallery (left), large capture button (center), flash toggle (right). Top bar: history, keyboard-entry, help. Tap capture → frame freezes → scan-line sweeps the box (~600 ms) → result sheet slides up. Optional: auto-scan when the box has been still for 1 s.
2. **Confirm** — top of the result sheet shows the recognized expression rendered large, with an edit pencil. Tap → MathLive editor with math keyboard. Fix, then "Solve". Low OCR confidence opens the editor automatically.
3. **Result sheet** — bottom sheet at ~45 % height with a drag handle. Answer rendered large. Primary button: "Show solving steps". Drag up → sheet expands to full height (steps view). Drag down → dismiss back to live camera. Sheet uses a spring, not a linear ease.
4. **Steps** — vertical list of step cards. Card = plain-English rule label ("Combine like terms"), `before` → `after` math, changed sub-expression highlighted. Tap a card → expands to show the explanation text and substeps. Each card has ▶ to animate that step (§6.1). Header has "Play all" with speed control. Method switcher tabs (e.g. factor vs quadratic formula) when the engine has more than one method (v2).
5. **Unsupported** — "Can't solve this type yet" + list of what *is* supported + "Report" (prefilled GitHub issue with the LaTeX; the user attaches the photo manually — zero infra).
6. **Type-in** — same MathLive editor, entered from the scan screen's keyboard icon. Solves the "no camera / laptop" case and doubles as a calculator.
7. **History** — local only (IndexedDB), newest first, tap to reopen, swipe to delete, one-tap clear all.

Transitions: camera → sheet (sheet spring + camera dim), card expand (height + fade), step highlight (pulse), steps autoplay (§6.1). Every animation respects `prefers-reduced-motion` (instant states, highlight only).

### 6.1 Step animations (the feature Photomath paywalls)

Each step *animates the transformation* instead of showing two static lines: terms slide across the equals sign, like terms converge and merge, canceled factors strike through and fade, a distributed factor fans out to each term, a substituted value drops into place. Photomath hand-authors these per problem type. We generate them from step data, which is cheaper, scales with every new rule, and is provably ours.

**Data.** Every `Step` carries `changes: Change[]` (§5). The rule that made the step knows exactly what it did, so it emits the change list; nothing is inferred by screen-diffing. v1 (vendored mathsteps): derive changes from mathsteps' `changeGroup` node marks plus `ruleId` → supports highlight, move, combine, cancel for most algebra rules. v1.5 (native rules): every rule emits exact `from`/`to` paths.

**Pipeline** (`packages/step-motion`, MIT, framework-free):

```
Step {before, after, changes}
  └─ path-match MathJSON nodes before ↔ after
      └─ timeline spec  [{ targetPath, op: move|fade-out|fade-in|pulse|strike, t0, dur }]
          └─ renderer (apps/web): KaTeX with `trust` + \htmlId{} on addressed sub-expressions
              └─ FLIP: measure spans in `before` and `after` renders, animate via Web Animations API
```

Rendering detail: wrap every addressable sub-expression in `\htmlId{p-<path>}{...}` when serializing MathJSON → LaTeX, so each MathJSON node maps to a DOM span. Render `before` and `after` off-screen, measure both, then FLIP-animate matched spans, fade out removed ones, fade in added ones. MathLive's per-atom DOM is the alternative if KaTeX's `trust` mode gets awkward.

**Choreography per rule family** (one entry each in `choreography.ts`; adding a rule means adding a line here):

| `Change.kind` / rule family | Motion |
|---|---|
| `move` (term across `=`) | Slide across the equals sign; sign flips with a brief pulse on arrival |
| `combine` (like terms, fractions with common denominator) | Sources converge to the destination position and merge into the result |
| `cancel` (common factors, additive inverses) | Strike-through, then fade out; remaining terms close the gap |
| `apply-both-sides` (÷, ×, ±, √ on both sides) | The operation appears under both sides simultaneously, then simplifies |
| `replace` (distribute, expand, evaluate arithmetic) | Source pulses, arrows fan out to each destination term, destinations fade in |
| `add` (introduce a term, e.g. complete the square) | Fade in with a pulse |

**Controls**: play one step, play all (sequential, 0.5×–2× speed), scrub, pause. Reduced motion → highlight-only mode. Every animation is derived from a step that passed CAS verification (§5), so an animation can never show a transformation the engine didn't verify.

**Design references** for the motion language (study, never copy assets): Graspable Math, Algebra Touch, Mathigon Polypad.

### 6.2 Design system (ours)

- **Icons**: Lucide (ISC) or Phosphor (MIT). Covers camera, flash, image, keyboard, history, chevron, play, pencil. Never hand-trace a competitor's glyph.
- **Palette**: our own tokens. One accent color in our own shade (not Photomath's red as a set), neutral grays, semantic success/warn/error. Light + dark. Keep the OKLCH values in `tokens.css`.
- **Type**: system font stack for UI; KaTeX fonts for math. No licensed fonts.
- **Motion tokens**: durations 150 / 250 / 400 ms; standard, emphasized, and spring easings; all animation reads from these.
- **Layout**: mobile-first at 360 px, safe-area insets, sheet heights as viewport fractions, 44 px minimum tap targets.

## 7. Hosting and delivery

- **App**: **[revised]** Vercel from `main`, configured in `vercel.json`: build `pnpm --filter @openmath/web build`, output `apps/web/dist`, SPA rewrite, immutable asset caching, and `no-cache` on the service worker so updates actually land. Static output, so Cloudflare Pages or GitHub Pages need no code change.
- **Not set**: `Cross-Origin-Embedder-Policy`. It would unlock multi-threaded WASM, but `require-corp` blocks the cross-origin model fetch. Single-threaded inference is the deliberate trade.
- **Weights**: Hugging Face Hub model repo; transformers.js fetches from it by default. Mirror the ONNX files to GitHub Releases and make the host configurable (`env.remoteHost`) so a provider change is a one-line fix.
- **PWA**: service worker precaches the app shell; weights cached on first run; manifest for "Add to Home Screen"; works fully offline afterward.
- **CI**: `.github/workflows/ci.yml` runs typecheck, the full test suite including the corpus, the production build, and the bundle-size budget. Corpus regressions block merge.
- **No telemetry, no analytics, no error reporting service.** The GitHub issue flow is the feedback channel.

## 8. Privacy

Images and expressions never leave the device. The only outbound requests are the app shell and model weights. State this on the landing page in one sentence; it is the differentiator against every ad-supported clone.

## 9. Licensing — **[revised]** resolved as MIT

Full reasoning in [LICENSING.md](./LICENSING.md). Short version: this section assumed Texo would be bundled into the browser, which under a conservative reading would make the app a derivative work of AGPL-3.0 code. It is not bundled. Inference runs through transformers.js (Apache-2.0) and the viewer's own browser fetches weights from the model host at runtime, so no copyleft code sits in this repo or in the deployed bundle.

Everything is therefore MIT, `apps/web` included. Three things would put the AGPL question back, and none should happen without deciding the licence first: bundling Texo weights into the build, self-hosting them on our own domain, or vendoring Texo source.

For zero exposure, `DEFAULT_PROVIDER_ID = "pix2text-mfr"` (MIT) is a one-line switch, at the cost of a larger download and an unmeasured accuracy gap. Run the bench (§11 step 2) before choosing.

## 10. Repo layout (pnpm workspace)

As built:

```
apps/web/              PWA (Vite + Preact + KaTeX), own icons and design tokens, service worker
apps/web/tools/        icon SVGs + generator for every PNG and ICO size
packages/math-core/    Rational, AST with stable ids, LaTeX lexer/parser/serializer, evaluators
packages/ocr/          OcrProvider interface, pure image pipeline, LaTeX normalizer, worker, providers
packages/steps/        rule engine, rules/, explanations/, poly, quadratic, verify
packages/step-motion/  Change[] → timeline spec, choreography table (§6.1), FLIP DOM player
packages/corpus/       77 text problems with hand-written answers; the CI gate
packages/bench/        OCR accuracy harness: corpus format, metrics, runner, baseline diffs
scripts/               bundle-size budget check
```

`packages/math-parse` was folded into `math-core` (the parser) and `ocr` (the normalizer and scope check) rather than existing separately. `tools/models/` is unnecessary while weights are fetched from the hub rather than re-exported.

## 11. Build order

1. **Photo corpus — NOT DONE, and it is the blocker.** 200 photos of real homework: printed textbook, worksheets, handwriting, bad lighting, each labelled with ground-truth LaTeX and expected answer. Needs a human with a phone. Step 2 depends entirely on it.
2. **OCR bench — harness DONE (`packages/bench`), the run is NOT.** Texo vs TexTeller vs Pix2Text MFR on that corpus. The harness scores accuracy per category (answer match as the headline, plus exact match, character error rate and solvable rate), separates model load from per-image inference, and diffs a run against an earlier one. It runs in Node, so its latencies are desktop latencies: the in-browser measurement on a mid-range Android and an older iPhone, and confirming the model repo ids actually serve transformers.js-compatible ONNX, still need doing on device.
3. ~~Vertical slice~~ **DONE**: photo → LaTeX → rule engine → KaTeX, on a phone-sized viewport.
4. ~~Product~~ **DONE**: every screen in §6.0, own design system (§6.2), PWA, offline, report flow.
5. **v1 launch** — blocked only on steps 1 and 2. The solver covers arithmetic, exact fractions, roots, expanding, like terms, linear equations, inequalities and quadratics, verified against 77 corpus problems, three of which must be refused rather than answered.
6. **v1.5**: method switcher, more rule coverage from contributors. **v2**: derivatives (TS). **v3**: integrals (Pyodide + SymPy). The native rule engine that was **v4** landed first, in v1.

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
| Model repo ids or ONNX availability wrong | Unverified from the build environment; step 2 confirms it. The app falls back to the type-in path if a model fails to load |
| mathsteps bugs (archived) | It's a seed, not a dependency; verification hides bad output; native engine replaces it |
| Lookalike takedown (DMCA to Cloudflare/GitHub, no lawsuit needed) | Zero copied files: own icons, palette, copy, animations generated from our data (§6); never call it a clone |

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
