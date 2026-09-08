# Licensing

**Everything in this repository is MIT.** See [LICENSE](./LICENSE).

That is a change from the plan in [ARCHITECTURE.md](./ARCHITECTURE.md) §9, which
expected the app to end up under AGPL-3.0. The reason is what actually got
built. It is worth understanding before you change anything about how models are
loaded.

## Why the AGPL question does not currently apply

ARCHITECTURE §9 assumed the Texo model would be shipped inside the browser
bundle, which under a conservative reading would make the app a derivative work
of AGPL-3.0 code.

The app does not do that. It ships **no Texo code and no Texo weights**:

- Inference runs through `transformers.js` (Apache-2.0).
- Model weights are fetched at runtime, by the viewer's own browser, directly
  from the model host. We neither redistribute them nor serve them.
- Every other dependency is permissive: Preact (MIT), KaTeX (MIT).

So there is nothing copyleft in this repository or in the deployed bundle.
Making the app AGPL today would be a choice rather than an obligation, and it
would put a licence conversation in front of exactly the people we want forking
this, which §9 was trying to avoid in the first place.

## When that changes

Three things would put the AGPL question back on the table. Do not do any of
them without deciding the licence first:

1. **Bundling Texo weights** into `apps/web/public` or into the build output.
2. **Self-hosting Texo weights** on our own domain and serving them to viewers.
3. **Vendoring Texo code** (its training or inference source) into this repo.

Fetching from a third-party model host at the viewer's request is none of these.

## If you would rather have zero exposure

Switch the default model to one that is permissively licensed. It is a one-line
change, which is the whole point of the `OcrProvider` seam:

```ts
// packages/ocr/src/providers/index.ts
export const DEFAULT_PROVIDER_ID = "pix2text-mfr"; // MIT, larger download
```

| Provider | Licence | Approx download |
| --- | --- | --- |
| `texo` (default) | AGPL-3.0 | ~22 MB |
| `texteller` | Apache-2.0 | ~90 MB |
| `pix2text-mfr` | MIT | ~120 MB |

Run the OCR bench (ARCHITECTURE §11 step 2) before choosing: the accuracy gap on
a real photo corpus, not the licence, should decide it.

## If you would rather be maximally cautious

Relicense `apps/web` as AGPL-3.0-or-later by adding the official licence text
from <https://www.gnu.org/licenses/agpl-3.0.txt> as `apps/web/LICENSE` and
setting `"license": "AGPL-3.0-or-later"` in `apps/web/package.json`. Keep the
packages MIT either way: `packages/steps` is the part anyone would actually
fork, and it should stay permissive.

## Third-party notices

| Component | Licence |
| --- | --- |
| Preact | MIT |
| KaTeX | MIT |
| transformers.js (`@huggingface/transformers`) | Apache-2.0 |
| ONNX Runtime Web (via transformers.js) | MIT |
| Texo model weights (fetched at runtime, not redistributed) | AGPL-3.0 |
| Pix2Text MFR model weights | MIT |
| TexTeller model weights | Apache-2.0 |

Algebra rule coverage and its test cases were informed by
[google/mathsteps](https://github.com/google/mathsteps) (Apache-2.0), which is
archived. No mathsteps code is used; the rule engine here is an independent
implementation over our own AST.
