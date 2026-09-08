import katex from "katex";
import { type MathNode, toLatex } from "@openmath/math-core";

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
