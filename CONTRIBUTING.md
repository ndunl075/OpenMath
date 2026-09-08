# Contributing

The most useful thing you can add is **coverage**: a rule for a kind of problem
OpenMath cannot solve yet. This guide is about that. Everything else is
ordinary.

## Setup

```bash
pnpm install
pnpm test
```

Node 22, pnpm 10. No other tooling.

## Adding a rule

A rule is a function that spots one pattern and rewrites it. Five steps.

### 1. Add the problem to the corpus first

`packages/corpus/src/index.ts`. Write the answer **by hand**, the way you would
on paper:

```ts
{ latex: "\\frac{x}{2}+\\frac{x}{3}", kind: "simplify", answer: "\\frac{5 x}{6}", tags: ["fractions"] },
```

Never paste in what the engine currently outputs. The point of the corpus is
that a wrong rewrite fails the build instead of being recorded as correct.

Run `pnpm test` and watch it fail. That failure is your specification.

### 2. Write the rule

Rules live in `packages/steps/src/rules/`. Return `null` when the rule does not
apply, and a replacement node when it does:

```ts
export const myRule: Rule = {
  id: "MY_RULE",
  apply(node) {
    if (node.type !== "add") return null;
    // ...find the pattern, or return null
    return {
      node: replacement,
      changes: [{ kind: "combine", fromIds: [a.id, b.id], toIds: [merged.id] }],
      vars: { terms: toLatex(a) },
    };
  },
};
```

**Reuse node objects where a term survives the step.** Each node carries a
stable id, and the animation layer matches terms across a step by that id. If
you rebuild a term that merely moved, it will fade out and back in instead of
sliding.

`changes` is what the animation is built from. Pick the kind that describes what
happened: `move`, `combine`, `cancel`, `add`, `replace`, `apply-both-sides`.
There is no animation to write; the choreography table already covers all six.

### 3. Add the explanation

`packages/steps/src/explanations/en.json`, keyed by your rule id:

```json
"MY_RULE": {
  "title": "Combine the fractions",
  "text": "Both fractions are over {denominator}, so add the numerators."
}
```

Placeholders come from the `vars` your rule returned. A test fails if a rule has
no explanation, so this is not optional.

Write the title as an instruction a teacher would give. Write the text as one
sentence saying *why*, not restating the algebra.

### 4. Register it

Add it to the exported list in its file, then place it in the priority order in
`packages/steps/src/rules/index.ts`. Order matters: the engine takes the first
rule that applies anywhere in the expression, so the list reads as a curriculum.
Fold numbers before collecting terms; collect terms before expanding.

### 5. Run the corpus

```bash
pnpm test
```

Your problem should pass, and so should the other seventy-odd. If an unrelated
problem breaks, your rule is firing too eagerly, usually because it is missing a
guard.

## Rules that will be sent back

- **A rule that can produce a wrong step.** Verification will catch it and hide
  the steps, which is worse than not having the rule.
- **A rule with no corpus entry.** There is nothing to stop it regressing.
- **A rule that fires when it changes nothing.** The engine rejects no-op steps,
  but a rule that constantly proposes them slows every solve down.
- **Loosening a guard to make one problem work.** Add the guard the other
  problems need instead.

## Translating

`packages/steps/src/explanations/` is plain JSON keyed by rule id. Copy
`en.json`, translate the strings, keep the `{placeholders}` intact. That is the
whole job; no code changes.

## Reporting a bad result

Open an issue with the expression and, if you can, the photo. The app's report
button prefills one. Nothing is uploaded automatically, so the photo only
reaches us if you attach it yourself.
