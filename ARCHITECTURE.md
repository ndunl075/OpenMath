# OpenMath — Architecture Guide

Free, open-source, camera-to-steps math solver. Runs 100% in the browser. No backend, no accounts, no LLMs, $0 to host.

> **Status, updated during implementation.** Everything below is built except
> the photo corpus and the OCR bench (§11 steps 1 and 2), which need real
> homework photos, and §12a, which is design notes for work not started. Three
> decisions changed once the code existed; each is marked **[revised]** with the
> reason. See the [README](./README.md) for what works today.

## 0. Decisions (read this if nothing else)

| Decision | Choice | Why |
|---|---|---|
| Platform | PWA (installable web app), mobile-first | No app-store review, no $99/yr, no copycat rejection, works on every phone |
| Compute | Everything on-device in the browser | $0 hosting, no cold starts, images never leave the phone (local-first) |
| Parser + CAS | **[revised]** Own AST and LaTeX parser, not compute-engine | compute-engine canonicalises on parse, so `x + x` arrives already folded to `2x` and the `before` state a step engine must show is gone. Own AST also gives the stable node ids animations need |
| OCR | Texo (20M params, in-browser via transformers.js) behind a swappable `OcrProvider` | Best accuracy-per-byte available; handwriting-capable; reference web impl exists |
| Solver | **[revised]** Own TypeScript rule engine written directly, not vendored mathsteps; every step verified | mathsteps pins mathjs 3.11.2 from 2017 and was archived Aug 2024. Bundling it ships a large CommonJS dependency into an app whose pitch is a small download. Its rule coverage informed ours; none of its code is used |
| Calculus | **[revised]** derivatives and integrals both in TS, no Pyodide | Integration is a heuristic search, but its answers are completely checkable: differentiate the candidate and compare it with the integrand. That check makes an aggressive search safe, and it is a few hundred lines against a 15–20 MB Python runtime that the owner did not want |
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
| Math input | **[revised]** Shadow input: KaTeX renders the editing surface, a transparent `<input>` takes the keystrokes, custom keypad | MIT | +2.3 kB | MathLive is still dropped, for the same reason and now a measured one: first load is 173.2 kB of a 200 kB budget, and a full editor is several times the headroom. Editing raw LaTeX was the wrong surface, though, so the caret, unit-wise delete and structural arrow motion are ours, in `apps/web/src/lib/latex-caret.ts`. Tapping to place the caret mid-expression is deliberately not supported; arrows do that |
| Step engine | `packages/steps` (ours) | MIT | small | 138 rules, explanations, CAS verification. Coverage informed by [google/mathsteps](https://github.com/google/mathsteps) (Apache-2.0, archived Aug 2024); no code used |
| Render | KaTeX | MIT | — | Step cards; faster than MathJax |
| Calculus | `packages/steps/src/rules/` (ours) | MIT | small | Derivative rules, then integral rules: table, substitution, by parts, partial fractions. Every antiderivative is differentiated back before it is shown. SymPy via Pyodide was the plan and is **[revised]** away; nothing here is Python |
| Hosting | Vercel | free | — | Static output, so Cloudflare Pages and GitHub Pages work with no code change |
| Weights hosting | Hugging Face Hub model repo | free | — | Model repos are still free; only Spaces compute went paid. Mirror to GitHub Releases |
| CI | GitHub Actions | free for public repos | — | Corpus tests block merge |

Explicitly **not** used: any LLM API, Cloud Run, Cloudflare Workers, HF Spaces, OpenCV.js, MathLive, mathjs, compute-engine, and pix2tex/LaTeX-OCR (100 K rendered-only training set, weak on handwriting, >100 MB ONNX).

Measured first load: **136 kB gzipped** (KaTeX 76, app 44, CSS 12, worker 5). Enforced in CI by `scripts/check-bundle-size.mjs` against a 200 kB budget. The OCR model is a separate deferred download and is excluded from that budget.

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

**Repairing what the model emits — [revised]**, and the highest-value fix in the project so far. A recognition model tokenises digit by digit and often drops the backslash off a function name. Neither is a parse error, so both went straight through the solver and came back as a *wrong answer with a full set of working*:

| Scanned | Was solved as | Answer given | Truth |
|---|---|---|---|
| `1 2 3 + 4 5 6` | `1*2*3 + 4*5*6` | 126 | 579 |
| `2 x + 3 = 1 1` | `2x + 3 = 1` | x = -1 | x = 4 |
| `cos(0)` | `c*o*s*0` | 0 | 1 |

Every multi-digit number in a photograph was becoming a product. `normalize.ts` now rejoins split digit runs — before the spacing commands that legitimately separate digits are stripped — and restores the backslash on function names it recognises, including inside `\operatorname` and `\mathrm`. Two backstops behind it, because normalization cannot catch every shape: the **parser refuses two juxtaposed numerals** outright (no real notation writes multiplication that way, so what reaches it is a scan artefact, and declining beats answering 126), and bare `dy/dx` is out of scope rather than read as `d*y/(d*x)` and cancelled to `y*x`. `scan-handoff.test.ts` locks all of it in.

**Editable result**: always show the recognized LaTeX in a MathLive field before solving. Users fix OCR mistakes in two taps instead of rescanning. This one UX choice covers more OCR failures than any model swap — and note it is the *only* defence against the class above that a scan can produce but the repairs above have not anticipated.

**Unverified — [revised]**: no model has ever been loaded. `huggingface.co` is unreachable from the build environment, so the provider config (Hub id, dtype, the `VisionEncoderDecoderModel` path, the UniMERNet preprocessing chain) is correct by reading the reference implementation's source, not by observation. Everything downstream of the model is tested; the model itself is the standing risk in §13.

**Handwriting**: Texo is trained on printed + handwritten (UniMER-1M includes HWE). If handwriting is weak on the corpus, fine-tune Texo using its open training pipeline on MathWriting (Google, 230 k handwritten expressions) / HME100K / CROHME. Consumer-GPU trainable per the Texo README.

## 4. Parsing and classification

1. **Normalize** OCR LaTeX: strip `\left`/`\right`, `\displaystyle`, `\,`; map `\times`/`\cdot` consistently; `x^{2}` ↔ `x^2`; fix `\frac` without braces; collapse whitespace.
2. **Parse** with compute-engine → MathJSON. Parse failure = "couldn't read that, edit or rescan."
3. **Classify** by MathJSON root:
   - `Equal` with one free variable → **solve**
   - `Equal` with 2+ variables → solve for `x`/`y` heuristically, else unsupported
   - `Less`/`Greater` → **inequality** (v1.5)
   - `D`, `\frac{d}{dx}` → **derivative** (v2)
   - `Integrate`, `\int` → **integral**
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

**Native rules throughout — [revised]** the vendored-mathsteps plan was skipped. Nothing is vendored: `rules/` holds 14 files of rules written against our own AST, and the adapter that was going to translate to mathjs-3 never existed. Going native immediately cost more up front and avoided pinning a 2015 dependency forever, keeping exact rational arithmetic and stable node ids (which §6.1's animations need and mathjs would not have given us).

Rule = `{ id, apply(node, ctx) → { node, changes } | null }`. The engine tries rules in priority order and takes the first that matches anywhere in the tree, so **the ordering of the rule list is the curriculum**. Two guards stop it looping: a candidate whose LaTeX matches the current expression is rejected (no empty step cards), and so is one already seen (no rule ping-pong).

**Explanations** live in `explanations/en.json` keyed by `ruleId` with placeholders (`"Move {term} to the other side"`). Adding a rule requires adding its explanation; CI enforces it. Localization is a JSON PR.

**Verification (non-negotiable).** For every step, `ce.parse(before).isEqual(ce.parse(after))`; for equations, substitute solutions back; if the CAS can't decide, sample 5 random points with tolerance. Fails → show the answer only, hide steps, surface the report button. Same check runs in CI over the corpus. A hand-written rewrite engine will produce wrong steps; this is what keeps them off screen.

### 5.1 Coverage, and what is deliberately missing

Kept honest because the alternative is a student photographing homework the app cannot do and finding out one problem at a time. A refusal is a supported outcome: the engine declines rather than guessing, and every refusal below is a decline with a message, not a wrong answer.

**Arithmetic and algebra.** Exact rational arithmetic, fractions, radicals, powers. Expanding, factoring (common factor, difference of squares, quadratics, rational roots for cubics and quartics), collecting like terms. Linear and quadratic equations, higher-degree by rational roots, radical equations with extraneous-root checks, exponential and logarithmic equations with domain checks, absolute value, quadratic inequalities.

**Calculus 1.** The full derivative table: power (integer, negative and fractional exponents), product, quotient, chain, all six trig functions, the three inverse trig, the three hyperbolic, `ln`, base-ten `log`, `exp` and general `a^x`. Higher-order derivatives. Limits by substitution, by factor-and-cancel, by degree comparison at infinity, and by l'Hopital for `0/0` and `inf/inf`.

**Calculus 2 — [revised]** now the whole course, not just the integration chapter.

*Techniques of integration.* Substitution, including the kind that leaves a stray x and has to be inverted (`int x sqrt(x+1) dx`). Integration by parts, repeated, and the cyclic case where parts reproduces the integral and it is solved for algebraically (`int e^x sin x dx`). Partial fractions, long division. Power reduction for `sin^2` and `cos^2`, odd powers of sine and cosine, `tan`, `cot`, `sec`, `csc`, `sec^3` and its cosecant mirror. Trigonometric substitution in all three shapes — `sqrt(a^2-x^2)`, `sqrt(a^2+x^2)`, `sqrt(x^2-a^2)` — with the triangle back-substitution, and a constant pulled out of the root first when the square term does not carry a coefficient of one. Inverse tangent and sine forms including completing the square. Improper integrals with one infinite bound, rewritten as a limit.

*Applications.* Arc length, volumes of revolution by disks, washers and shells, surface area, average value, area between curves, work — all reachable once the student writes the integral, which is the form they arrive in.

*Sequences and series.* Sigma notation and factorials. Finite sums. For infinite series, the tests in the order a course teaches them: nth-term, geometric (with an exact sum), p-series, alternating, ratio, limit comparison against the dominant power, and the integral test, which hands the problem to the integration engine. Every verdict names the test that produced it.

*Power series.* Radius and interval of convergence by the ratio test, with each endpoint put back in and settled separately, and centres away from zero read off the `(x-a)^n`. The standard Maclaurin series are recognised by what they sum to, so `sum x^n/n!` comes back as `e^x` with its reach in the note.

*Taylor series, both directions — **[revised]***. `maclaurin(f, n)` and `taylor(f, a, n)` build the expansion from the function; recognising a series that is written down is the other half, above. There is no *notation* for "find the Maclaurin series of f", so it is offered as a **named operation** the way every CAS does — typed as a word, which needs no symbol nobody would type, and the scan normalizer restores the backslash exactly as it does for `cos`. Coefficients stay symbolic, so `taylor(e^x, 1, 3)` keeps its `e` rather than refusing a number with no decimal.

**Not supported, and what happens instead:**

| Missing | Behaviour |
|---|---|
| Parametric and polar curves | no notation for them |
| Multivariable anything (Calc 3) | out of scope by an earlier decision |
| Limits of the form `0 * inf` and `1^inf` | declined by name |
| Divergent limits | refused; there is no way to report infinity as an answer |
| An answer that is irrational, e.g. `int 1/(x^2+x+1) dx` | declined rather than approximated |
| Both integration bounds infinite | declined, with a note to split the integral first |
| A series none of the tests settle | declined by name |

The last four are policy rather than gaps. Approximating an irrational would break the promise that every answer is exact, picking a split point for a doubly-infinite integral would be putting words in the student's mouth, and a convergence test that guessed would be worse than one that declines.

**On naming operations.** Taylor was once listed here as blocked by the input model, on the grounds that a photograph carries mathematics rather than the sentence asking for it. Half of that was true and half was an excuse: there is no notation, but nothing stopped the app offering it as a named operation. Anything else that needs a verb rather than a symbol should follow the same route — a word a student can type, restored by the normalizer, parsed as a function.


**How accuracy is checked.** Three layers, deliberately not sharing code. Per step, the engine samples `before` against `after` (equations by checking `lhs - rhs` stays proportional, integrals by differentiating both sides, limits by measurement, and l'Hopital structurally). Per problem, the corpus records a hand-written answer and confirms it by measuring the problem itself — which is why a limit that cannot be measured and an integral running to infinity are tested elsewhere rather than weakening that rule. Across the whole engine, `accuracy-sweep.test.ts` cross-checks against a separately written differentiator, Simpson's rule, and substitution back into the original.

**Series are derived, not measured — [revised].** They were once the exception: convergence cannot be confirmed by adding terms, since enough of `sum 1/n` looks perfectly settled, so the verdicts rested on sampling a ratio — and a factorial passes the largest double at 171, so the sampling ran out of numbers before the ratio did. The ratio test now builds `a(n+1)/a(n)` as an expression, cancels the factorials and subtracts the exponents, and hands what is left to the limit engine. Sampling stays as the fallback and still earns it: `sum n!/2^n` has ratio `(n+1)/2`, whose limit is infinity, and there is no way to report that as an answer.

**Roadmap**: done — derivatives and integrals are both native rules. Integration differs from differentiation in kind: there is no complete algorithm, so `integral.ts` searches (candidate substitutions, a LIATE choice for parts, a rational-root factorisation for partial fractions) and every candidate is differentiated back before it is returned. A guess that does not match the integrand is discarded, and an integral no heuristic finishes is declined rather than half-answered.

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
- **Palette**: our own tokens. One accent colour in our own shade (not Photomath's red as a set), neutral greys, semantic success/warn/error. **[revised]** Light only (`color-scheme: light`); the camera stage stays dark in its own `--stage-*` tokens because a viewfinder is not a theme choice. Keep the OKLCH values in `tokens.css`.
- **Three rules, checked not remembered**: no pill shapes, no purple, no gradients. `scripts/check-design-constraints.mjs` enforces them in CI across `apps/` and `packages/`. It is chroma-aware about purple, because a near-neutral grey at hue 285 reads as grey and banning it would force pure greys for no reason. The accent earns its keep in three places — primary button, focus ring, animating step — and everything else is ink on paper.
- **Type**: system font stack for UI; KaTeX fonts for math. No licensed fonts.
- **Motion tokens**: durations 150 / 250 / 400 ms; standard, emphasized, and spring easings; all animation reads from these.
- **Layout**: mobile-first at 360 px, safe-area insets, 44 px minimum tap targets. **[revised]** The result sheet sizes itself to its content (`height: auto` bounded by a `max-height`) rather than to a viewport fraction, so the peek state does not open onto a void. Both its heights being `auto` is why `tokens.css` sets `interpolate-size: allow-keywords`: without it the drag between peek and full snaps instead of animating.

## 7. Hosting and delivery

- **App**: **[revised]** Vercel from `main`, configured in `vercel.json`: build `pnpm --filter @openmath/web build`, output `apps/web/dist`, SPA rewrite, immutable asset caching, and `no-cache` on the service worker so updates actually land. Static output, so Cloudflare Pages or GitHub Pages need no code change.
- **Not set**: `Cross-Origin-Embedder-Policy`. It would unlock multi-threaded WASM, but `require-corp` blocks the cross-origin model fetch. Single-threaded inference is the deliberate trade.
- **Weights**: Hugging Face Hub model repo; transformers.js fetches from it by default. Mirror the ONNX files to GitHub Releases and make the host configurable (`env.remoteHost`) so a provider change is a one-line fix.
- **PWA**: service worker precaches the app shell; weights cached on first run; manifest for "Add to Home Screen"; works fully offline afterward.
- **CI**: `.github/workflows/ci.yml` runs typecheck, the full test suite including the corpus, the production build, and the bundle-size budget. Corpus regressions block merge.
- **No telemetry, no analytics, no error reporting service.** The GitHub issue flow is the feedback channel.

**Two `vercel.json` files, and why — [revised].** Vercel reads only the one sitting at whatever it has been told the project's Root Directory is. Left empty it reads the top-level file; set to `apps/web` it reads `apps/web/vercel.json` and the top-level one is invisible to it. Two deployments failed on that: the first because the output path in the file being read was wrong, the second because the fix moved the build outside the directory Vercel was looking in. Worse than the failures, the SPA rewrite, the immutable asset caching and `Service-Worker-Allowed` lived only in the top-level file, so under a Root Directory of `apps/web` none of them applied — a green deploy would have 404'd every deep link and cached the service worker wrongly, and said nothing. Both files now exist and describe the same site; `scripts/check-bundle-size.mjs` runs after the build in CI and fails if either points somewhere the build does not land, or if the two disagree about routing or headers.

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
packages/corpus/       194 text problems with hand-written answers; the CI gate
packages/bench/        OCR accuracy harness: corpus format, metrics, runner, baseline diffs
scripts/               bundle-size budget check
```

`packages/math-parse` was folded into `math-core` (the parser) and `ocr` (the normalizer and scope check) rather than existing separately. `tools/models/` is unnecessary while weights are fetched from the hub rather than re-exported.

## 11. Build order

1. **Photo corpus — NOT DONE, and it is the blocker.** 200 photos of real homework: printed textbook, worksheets, handwriting, bad lighting, each labelled with ground-truth LaTeX and expected answer. Needs a human with a phone. Step 2 depends entirely on it.
2. **OCR bench — harness DONE (`packages/bench`), the run is NOT.** Texo vs TexTeller vs Pix2Text MFR on that corpus. The harness scores accuracy per category (answer match as the headline, plus exact match, character error rate and solvable rate), separates model load from per-image inference, and diffs a run against an earlier one. It runs in Node, so its latencies are desktop latencies: the in-browser measurement on a mid-range Android and an older iPhone, still needs doing on device. The Texo repo id, dtype, download size and preprocessing have since been confirmed against the model's own shipped browser app and corrected; the other two providers have not been checked that way.
3. ~~Vertical slice~~ **DONE**: photo → LaTeX → rule engine → KaTeX, on a phone-sized viewport.
4. ~~Product~~ **DONE**: every screen in §6.0, own design system (§6.2), PWA, offline, report flow.
5. **v1 launch** — blocked only on steps 1 and 2. The solver covers arithmetic, exact fractions, roots, expanding, like terms, factoring, linear, quadratic and higher-degree polynomial equations, radical, exponential and logarithmic equations, linear, absolute value and quadratic inequalities, derivatives, integrals, exact trigonometric and logarithmic values, and limits, verified against 325 corpus problems, 29 of which must be refused rather than answered.
6. **v1.5**: method switcher, more rule coverage from contributors. **v2**: ~~derivatives~~ **DONE**. **v3**: ~~integrals~~ **DONE**, in TypeScript rather than Pyodide + SymPy. The native rule engine that was **v4** landed first, in v1.

## 12. Non-goals (v1)

Word problems (reading comprehension is an LLM-shaped problem; revisit only by reopening the no-LLM decision), graphs, geometry figures, matrices, systems of equations, accounts, sync, native apps, any server.

## 12a. Planned, not built

Two things the owner wants next. Neither exists yet; both are recorded here so
the design decisions are made before the code is.

### 12a.1 Landing page

A public page explaining what OpenMath is, so the app is not the only front
door. Built with Fable, like the app's interface, and held to the same three
rules — no pill shapes, no purple, no gradients — so it and the app read as one
product. It is a separate build target rather than a route inside the PWA:
folding marketing copy into the app bundle would spend the 200 kB budget on
people who have already installed it.

Two constraints carry over from §6.2, and one is new:

- The trademark line is unchanged. The page may describe what the app does and
  compare features on the merits. It may not use a competitor's name as a
  descriptor of ours, borrow its palette as a set, or call this a clone.
- It states the honest scope. The solver's coverage is real and measured, so the
  page should say what it handles and what it does not rather than implying
  everything. A landing page that oversells is the fastest way to make the
  refusals look like bugs.
- The claim that everything runs on-device is the strongest thing we have and
  the easiest to undermine. If the page adds analytics, embedded fonts, or a
  third-party form, that claim needs qualifying — or, better, do not add them.

### 12a.2 Browser extension

On a laptop the phone-camera flow is the wrong shape: the problem is already on
the screen. The extension lets someone select a region of a page — a PDF
worksheet, a courseware question, a scanned assignment — and get the same steps
in place.

The important property is that this changes almost nothing architecturally. The
extension is another **host** for the existing pipeline: capture → crop → OCR →
normalize → solve → steps. `packages/ocr`, `packages/math-core`, `packages/steps`
and `packages/step-motion` are already host-agnostic, and the work is a new entry
point in `apps/`, not a second solver. If building it starts requiring changes
inside `packages/`, that is a signal the split is wrong, not that the packages
need special cases.

Decisions to make before writing it:

- **Capture path.** `chrome.tabs.captureVisibleTab` needs only `activeTab` and
  returns exactly what the reader sees, including PDFs rendered by the built-in
  viewer. Injecting a content script to read the DOM is more precise on
  HTML-rendered maths but fails on the PDFs students actually get sent. Prefer
  the screenshot path; treat DOM extraction as an optimisation for later.
- **Permissions.** `activeTab` plus a click, never `<all_urls>`. An extension
  that can read every page you visit is a different product with a different
  privacy story, and the whole pitch here is that nothing leaves the device.
  Whatever the manifest asks for is what reviewers and users will judge.
- **Where the model runs.** The OCR weights are 20–40 MB. Loading them per tab
  is wasteful; the service worker is the natural home, with the offscreen
  document API for the WASM runtime. This wants measuring before committing.
- **Reading the screen is not watching the screen.** Capture happens on an
  explicit user action and the image stays local, exactly as on the phone. Any
  design where the extension observes continuously breaks the privacy claim in
  §8, and no amount of "it never leaves your machine" copy will repair the
  impression once it is in the manifest.
- **Store review.** Both stores reject extensions that look like a competitor's
  product. The §6.2 line — flow is free, assets are not — applies to the
  extension's own icon, name and listing screenshots as much as to the app.

## 13. Risks

| Risk | Mitigation |
|---|---|
| OCR fails on handwriting / bad photos | Viewfinder crop, preprocessing, editable result field, fine-tune on MathWriting, report flow |
| Wrong step shown | CAS verification per step (§5); corpus tests in CI |
| 20–40 MB first download on cellular | Show size, download once, cache forever, int8 default |
| iOS Safari WASM memory | Worker + int8 model; avoid loading two models at once |
| Texo / HF hosting terms change | `OcrProvider` swap + configurable weight host + GitHub Releases mirror |
| Model repo ids or ONNX availability wrong | **This one was real.** The Texo entry pointed at a repository that does not exist and asked for a quantised export that is not published, so the default OCR could never have loaded. Corrected against the model's own shipped app. TexTeller and Pix2Text MFR remain unverified in exactly the same way, including their preprocessing, so bench them before trusting them |
| mathsteps bugs (archived) | It's a seed, not a dependency; verification hides bad output; native engine replaces it |
| Lookalike takedown (DMCA to Cloudflare/GitHub, no lawsuit needed) | Zero copied files: own icons, palette, copy, animations generated from our data (§6); never call it a clone |
| Extension permissions read as spyware (§12a.2) | `activeTab` and an explicit click only, never `<all_urls>`; capture on user action, image stays local |
| Landing page undercuts the on-device claim (§12a.1) | No analytics, no third-party embeds, no hosted fonts; the claim in §8 is the product |

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
