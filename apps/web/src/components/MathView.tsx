import { renderLatex } from "../lib/math-render.js";

export interface MathViewProps {
  latex: string;
  display?: boolean;
  class?: string;
  /** Screen-reader text; the rendered math is hidden from assistive tech. */
  label?: string;
}

/**
 * Renders LaTeX with KaTeX. Wide expressions scroll inside their own box so the
 * page itself never scrolls sideways.
 */
export function MathView({ latex, display = false, class: className, label }: MathViewProps) {
  return (
    <div class={`math-scroll ${className ?? ""}`}>
      {label ? <span class="visually-hidden">{label}</span> : null}
      <span
        aria-hidden={label ? "true" : undefined}
        dangerouslySetInnerHTML={{ __html: renderLatex(latex, display) }}
      />
    </div>
  );
}
