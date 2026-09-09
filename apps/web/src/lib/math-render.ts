import katex from "katex";
import { type MathNode, toLatex } from "@openmath/math-core";
import { CARET, decorateForDisplay } from "./latex-caret.js";

/**
 * KaTeX needs `trust` to emit \htmlId, which is how a rendered sub-expression
 * maps back to its AST node for the animations. The predicate allows only that
 * one command, so a malformed scan cannot inject markup.
 */
const OPTIONS: katex.KatexOptions = {
  throwOnError: false,
  strict: false,
  output: "html",
  trust: (context) => context.command === "\\htmlId",
};

export function renderLatex(latex: string, displayMode = false): string {
  try {
    return katex.renderToString(latex, { ...OPTIONS, displayMode });
  } catch {
    // KaTeX already swallows most errors; this is the last resort.
    return `<span class="math-error">${escapeHtml(latex)}</span>`;
  }
}

/**
 * The maths field: `latex` is the normalised problem with the caret marker
 * still in it. KaTeX is asked to be strict here, because a caret that has
 * landed somewhere it cannot go must not turn the whole line red; it is moved
 * to the end instead. When the line itself is not maths yet, a control word
 * half typed, the source is shown as text with the caret in it, rather than
 * KaTeX's error rendering, which would print the caret's own markup.
 */
export function renderEditable(latex: string, displayMode = true): string {
  const strict = { ...OPTIONS, displayMode, throwOnError: true };
  try {
    return katex.renderToString(decorateForDisplay(latex), strict);
  } catch {
    // Try again with the caret out of the way.
  }
  const plain = latex.split(CARET).join("");
  try {
    return katex.renderToString(decorateForDisplay(plain + CARET), strict);
  } catch {
    // Not maths yet.
  }
  const at = latex.indexOf(CARET);
  const left = at < 0 ? plain : latex.slice(0, at);
  const right = at < 0 ? "" : latex.slice(at + 1).split(CARET).join("");
  return `<span class="math-source">${escapeHtml(left)}<span id="om-caret"></span>${escapeHtml(right)}</span>`;
}

/** Render an AST with every node tagged, ready for FLIP animation. */
export function renderNode(node: MathNode, idPrefix: string, displayMode = false): string {
  return renderLatex(toLatex(node, { annotate: true, idPrefix }), displayMode);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Unique per step card, so ids stay unique across a whole solution. */
export function stepIdPrefix(solutionId: string, stepIndex: number): string {
  return `om-${solutionId}-${stepIndex}-`;
}
