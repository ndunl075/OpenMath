import { asLimit, children, INFINITY, key, type MathNode, num } from "./ast.js";

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu",
  "pi", "rho", "sigma", "tau", "phi", "omega",
]);

/** Function names LaTeX spells with a backslash. Anything else is a plain letter. */
const LATEX_FUNCTIONS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "ln", "log", "exp",
]);

export interface SerializeOptions {
  /**
   * Wrap every node in \htmlId{om-<id>}{...} so the renderer can find the DOM
   * element for each sub-expression. Requires KaTeX `trust` to be enabled.
   */
  annotate?: boolean;
  /** Prefix for generated element ids. */
  idPrefix?: string;
}

/** Binding strength, used to decide parentheses. */
function prec(n: MathNode): number {
  switch (n.type) {
    case "rel": return 0;
    case "add": return 1;
    case "neg": return 1;
    case "mul": return 2;
    case "pow": return 3;
    case "num": return n.value.isNegative() ? 1 : 4;
    case "div":
    case "sym":
    case "fn": return 4;
  }
}

function symbolToLatex(name: string): string {
  if (name === INFINITY) return "\\infty";
  const [head = "", ...restParts] = name.split("_");
  const sub = restParts.join("_");
  const base = GREEK.has(head) ? `\\${head}` : head;
  return sub ? `${base}_{${sub}}` : base;
}

/**
 * The same product with its negative leading coefficient made positive, or null
 * when the term does not have one. Node ids are carried over so a term that is
 * only being reprinted with the minus sign in front of it is still the same term
 * to the animation layer.
 */
function negatedTerm(n: MathNode): MathNode | null {
  if (n.type !== "mul" || n.args.length < 2) return null;
  const lead = n.args[0];
  if (!lead || lead.type !== "num" || !lead.value.isNegative()) return null;
  const positive = lead.value.neg();
  const rest = n.args.slice(1);
  return positive.isOne()
    ? { ...n, args: rest }
    : { ...n, args: [num(positive, lead.id), ...rest] };
}

/** Does this rendered fragment begin with something that would read as a digit? */
function startsWithDigit(s: string): boolean {
  return /^[\s{(]*\\?-?\d/.test(s);
}

class Serializer {
  private readonly annotate: boolean;
  private readonly prefix: string;

  constructor(opts: SerializeOptions) {
    this.annotate = opts.annotate ?? false;
    this.prefix = opts.idPrefix ?? "om-";
  }

  render(n: MathNode): string {
    const body = this.renderInner(n);
    return this.annotate ? `\\htmlId{${this.prefix}${n.id}}{${body}}` : body;
  }

  private wrap(child: MathNode, minPrec: number): string {
    const s = this.render(child);
    return prec(child) < minPrec ? `\\left(${s}\\right)` : s;
  }

  private renderInner(n: MathNode): string {
    switch (n.type) {
      case "num":
        return n.value.toLatex();

      case "sym":
        return symbolToLatex(n.name);

      case "add": {
        let out = "";
        n.args.forEach((a, i) => {
          const negated = i > 0 ? negatedTerm(a) : null;
          if (a.type === "neg") {
            const inner = this.render(a.arg);
            const needParens = prec(a.arg) < 1;
            const body = needParens ? `\\left(${inner}\\right)` : inner;
            out += i === 0 ? `-${body}` : ` - ${body}`;
          } else if (a.type === "num" && a.value.isNegative() && i > 0) {
            out += ` - ${a.value.neg().toLatex()}`;
          } else if (negated) {
            // A term whose coefficient is negative, such as the -2x that comes
            // out of collecting like terms, is written as a subtraction. Without
            // this the sum reads "x^2 + -2x". Every id survives the flip, so the
            // animation still matches the term across the step.
            out += ` - ${this.wrap(negated, 1)}`;
          } else {
            out += i === 0 ? this.wrap(a, 1) : ` + ${this.wrap(a, 1)}`;
          }
        });
        return out;
      }

      case "mul": {
        const parts = n.args.map((a, i) => {
          // -2x reads correctly; 2(-3) needs the brackets.
          if (i === 0 && a.type === "num") return this.render(a);
          const min = i === 0 ? 2 : a.type === "num" && a.value.isNegative() ? 4 : 2;
          return this.wrap(a, min);
        });
        let out = parts[0] ?? "";
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i]!;
          // A dot is needed before a digit, and between repeated factors, or
          // x times x renders as "xx" and reads like one symbol.
          const repeated = key(n.args[i]!) === key(n.args[i - 1]!);
          out += startsWithDigit(p) || repeated ? ` \\cdot ${p}` : ` ${p}`;
        }
        return out;
      }

      case "div":
        return `\\frac{${this.render(n.num)}}{${this.render(n.den)}}`;

      case "pow": {
        const base =
          n.base.type === "add" || n.base.type === "mul" || n.base.type === "neg" ||
          n.base.type === "div" || n.base.type === "pow" ||
          (n.base.type === "num" && n.base.value.isNegative())
            ? `\\left(${this.render(n.base)}\\right)`
            : this.render(n.base);
        return `${base}^{${this.render(n.exp)}}`;
      }

      case "neg":
        return `-${this.wrap(n.arg, 2)}`;

      case "fn": {
        const [a0, a1] = n.args;
        if (n.name === "sqrt") return `\\sqrt{${this.render(a0!)}}`;
        if (n.name === "root") return `\\sqrt[${this.render(a1!)}]{${this.render(a0!)}}`;
        if (n.name === "abs") return `\\left|${this.render(a0!)}\\right|`;
        if (n.name === "log" && a1) {
          return `\\log_{${this.render(a1)}}\\left(${this.render(a0!)}\\right)`;
        }
        if (n.name === "lim") {
          const l = asLimit(n);
          if (l) {
            const marker = l.side === "right" ? "^{+}" : l.side === "left" ? "^{-}" : "";
            // The body is always bracketed for the same reason a derivative's
            // is: nothing written after the limit can be read back into it.
            return `\\lim_{${this.render(n.args[1]!)} \\to ${this.render(l.point)}${marker}}\\left(${this.render(l.body)}\\right)`;
          }
        }
        if (n.name === "diff" && a0 && a1) {
          // The operand is always bracketed, so re-reading this cannot pick up
          // a factor that comes after it as part of the derivative.
          return `\\frac{d}{d${this.render(a1)}}\\left(${this.render(a0)}\\right)`;
        }
        const args = n.args.map((a) => this.render(a)).join(", ");
        const head = LATEX_FUNCTIONS.has(n.name) ? `\\${n.name}` : n.name;
        return `${head}\\left(${args}\\right)`;
      }

      case "rel": {
        const op =
          n.rel === "<=" ? "\\le" : n.rel === ">=" ? "\\ge" : n.rel;
        return `${this.render(n.lhs)} ${op} ${this.render(n.rhs)}`;
      }
    }
  }
}

/** Render an AST back to LaTeX. */
export function toLatex(n: MathNode, opts: SerializeOptions = {}): string {
  return new Serializer(opts).render(n);
}

/** Compact debug form, handy in tests and error messages. */
export function toDebug(n: MathNode): string {
  switch (n.type) {
    case "num": return n.value.toString();
    case "sym": return n.name;
    case "add": return `(+ ${n.args.map(toDebug).join(" ")})`;
    case "mul": return `(* ${n.args.map(toDebug).join(" ")})`;
    case "div": return `(/ ${toDebug(n.num)} ${toDebug(n.den)})`;
    case "pow": return `(^ ${toDebug(n.base)} ${toDebug(n.exp)})`;
    case "neg": return `(- ${toDebug(n.arg)})`;
    case "fn": return `(${n.name} ${n.args.map(toDebug).join(" ")})`;
    case "rel": return `(${n.rel} ${toDebug(n.lhs)} ${toDebug(n.rhs)})`;
  }
}

/** All node ids present, in document order. Used by the animation layer. */
export function idOrder(n: MathNode): number[] {
  const out: number[] = [n.id];
  for (const c of children(n)) out.push(...idOrder(c));
  return out;
}
