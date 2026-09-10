# Corpus

## What this is

Six images that test **refusal**, not accuracy. Five of the six are
deliberately out of scope — a system of differential equations, a system of
linear equations, a 4×4 matrix, two integrals with no closed form — and the
sixth is a handwritten l'Hôpital limit that OpenMath should actually solve.

That is a real thing to test. A photograph of a matrix must come back saying
"matrices", not a confident wrong answer and not a message naming the wrong
limitation. That exact bug shipped once already: every layout-wrapped scan was
refused as *"matrices and aligned environments"*, a message that named two
things and described neither.

## What this is not

**This is not the accuracy corpus, and the number it produces is not an
accuracy figure.** These came from an OCR project's documentation, and such
examples are chosen to show a recogniser handling hard typography: matrices,
norms, multi-line systems, complex analysis. That is close to the opposite of
homework. Of fourteen images downloaded, one was in scope.

They are also already cropped to the expression, so they exercise the
recogniser and skip the parts of the pipeline most likely to be wrong: the
viewfinder crop, the angle, the lighting, the phone camera.

## What is still missing

Real photos, taken on a phone, of the maths a student actually has in front of
them. `photos/README.md` says what to shoot. Twenty is enough. Until those
exist, OpenMath has no measured answer to "how often does the camera work",
and the only evidence in either direction is that the first real scan ever
taken found three bugs.

## Running it

```
pnpm bench --corpus packages/bench/corpus --check   # labels only, no weights, offline
pnpm bench --corpus packages/bench/corpus           # the real run, needs network
```

`--check` is the part that works everywhere. The real run needs to reach the
model, which CI can do and the development sandbox cannot.
