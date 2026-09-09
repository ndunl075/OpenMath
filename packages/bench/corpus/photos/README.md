# Photo corpus

Drop homework photos in this directory. Nothing else here has to be done by
hand: the labelling is the slow part and is better done by reading the photos
than by typing them twice.

## What to shoot

Twenty is enough to be useful. Shoot for **variety, not quality** — clean,
well-lit photos of printed text already work, so they measure nothing. What is
worth having:

- handwriting, including untidy handwriting
- printed textbook and worksheet pages
- a photo taken at an angle, and one taken in poor light
- a problem crowded by other text on the page, so the viewfinder crop matters
- Calc 1 and Calc 2, because that is the coverage the solver claims and the
  part the recogniser has never been measured on

A photo the app gets wrong is more valuable than one it gets right. Do not
discard the bad ones.

## Naming

`001.jpg`, `002.jpg`, … Any image format the browser can decode is fine.

## What happens next

Each photo needs a line in `../manifest.jsonl` giving the LaTeX a careful human
reads off it:

```jsonl
{"file": "001.jpg", "latex": "2x + 3 = 7", "category": "print"}
{"file": "002.jpg", "latex": "\\frac{d}{dx}\\sin(2x)", "category": "handwriting", "notes": "faint pencil"}
```

Then `pnpm bench --corpus packages/bench/corpus/photos` gives the accuracy
number. `--check` validates the labels without loading any weights, so it runs
offline; the real run needs network for the model.

See `packages/bench/README.md` for the full manifest schema and CLI flags.
