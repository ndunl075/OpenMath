import {
  add, asDiff, containsDiff, div, fn, type MathNode, mul, neg, num, pow, Rational,
} from "@openmath/math-core";

/**
 * A small symbolic differentiator, used only by the verifier.
 *
 * It exists because the verifier evaluates numerically, and `evaluateNumeric`
 * resolves a derivative with a finite difference. That is accurate enough for
 * one derivative and useless for two: a difference quotient of a difference
 * quotient loses most of its significant digits, so a *correct* step such as
 *
 *     d/dx(d/dx(d/dx(x^5)))  ->  d/dx(d/dx(5x^4))
 *
 * failed its numeric check and the UI hid a perfectly good set of working.
 * Resolving the derivative operators exactly first removes the error entirely.
 *
 * Written from the differentiation rules rather than shared with them on
 * purpose. The rules in rules/derivative.ts are what the verifier is checking,
 * and a checker that reuses the code under test only confirms it agrees with
 * itself. Two independent implementations have to agree on the answer.
 *
 * Returns null for anything it does not know, and the caller falls back to the
 * numeric path rather than treating "not differentiable here" as a mismatch.
 */
export function differentiate(n: MathNode, v: string): MathNode | null {
  switch (n.type) {
    case "num":
      return num(0);
    case "sym":
      return num(n.name === v ? 1 : 0);
    case "add": {
      const parts = n.args.map((a) => differentiate(a, v));
      if (parts.some((p) => p === null)) return null;
      return add(parts as MathNode[]);
    }
    case "neg": {
      const d = differentiate(n.arg, v);
      return d === null ? null : neg(d);
    }
    case "mul": {
      // Product rule over n factors: sum of (this one differentiated, the rest as they are).
      const terms: MathNode[] = [];
      for (let i = 0; i < n.args.length; i++) {
        const d = differentiate(n.args[i]!, v);
        if (d === null) return null;
        const others = n.args.filter((_, j) => j !== i);
        terms.push(others.length === 0 ? d : mul([d, ...others]));
      }
      return add(terms);
    }
    case "div": {
      const dn = differentiate(n.num, v);
      const dd = differentiate(n.den, v);
      if (dn === null || dd === null) return null;
      // (f/g)' = (f'g - fg') / g^2
      return div(
        add([mul([dn, n.den]), neg(mul([n.num, dd]))]),
        pow(n.den, num(2)),
      );
    }
    case "pow":
      return differentiatePower(n.base, n.exp, v);
    case "fn":
      return differentiateFn(n, v);
    default:
      return null;
  }
}

function constant(n: MathNode, v: string): boolean {
  let free = true;
  const visit = (x: MathNode): void => {
    if (x.type === "sym" && x.name === v) free = false;
    for (const c of childrenOf(x)) visit(c);
  };
  visit(n);
  return free;
}

function childrenOf(n: MathNode): MathNode[] {
  switch (n.type) {
    case "add": case "mul": return n.args;
    case "div": return [n.num, n.den];
    case "pow": return [n.base, n.exp];
    case "neg": return [n.arg];
    case "fn": return n.args;
    case "rel": return [n.lhs, n.rhs];
    default: return [];
  }
}

function differentiatePower(base: MathNode, exp: MathNode, v: string): MathNode | null {
  const dBase = differentiate(base, v);
  if (dBase === null) return null;

  if (constant(exp, v)) {
    // Power and chain: (u^k)' = k u^(k-1) u'.
    const reduced = exp.type === "num"
      ? num(exp.value.sub(Rational.of(1n)))
      : add([exp, num(-1)]);
    return mul([exp, pow(base, reduced), dBase]);
  }

  const dExp = differentiate(exp, v);
  if (dExp === null) return null;

  if (constant(base, v)) {
    // (a^u)' = a^u ln(a) u'.
    return mul([pow(base, exp), fn("ln", [base]), dExp]);
  }

  // General case, through u^w = e^(w ln u): (u^w)' = u^w (w' ln u + w u'/u).
  return mul([
    pow(base, exp),
    add([mul([dExp, fn("ln", [base])]), div(mul([exp, dBase]), base)]),
  ]);
}

function differentiateFn(n: MathNode & { type: "fn" }, v: string): MathNode | null {
  // A nested derivative: resolve it inside out.
  const inner = asDiff(n);
  if (inner) {
    const once = differentiate(inner.body, inner.variable);
    return once === null ? null : differentiate(once, v);
  }
  if (n.name === "lim" || n.name === "integral") return null;

  const u = n.args[0];
  if (!u) return null;
  const du = differentiate(u, v);
  if (du === null) return null;

  const chain = (outer: MathNode): MathNode => mul([outer, du]);
  const sq = (x: MathNode): MathNode => pow(x, num(2));

  switch (n.name) {
    case "sin": return chain(fn("cos", [u]));
    case "cos": return chain(neg(fn("sin", [u])));
    case "tan": return chain(sq(fn("sec", [u])));
    case "sec": return chain(mul([fn("sec", [u]), fn("tan", [u])]));
    case "csc": return chain(neg(mul([fn("csc", [u]), fn("cot", [u])])));
    case "cot": return chain(neg(sq(fn("csc", [u]))));
    case "sinh": return chain(fn("cosh", [u]));
    case "cosh": return chain(fn("sinh", [u]));
    case "tanh": return chain(div(num(1), sq(fn("cosh", [u]))));
    case "arcsin": return chain(div(num(1), pow(add([num(1), neg(sq(u))]), div(num(1), num(2)))));
    case "arccos": return chain(neg(div(num(1), pow(add([num(1), neg(sq(u))]), div(num(1), num(2))))));
    case "arctan": return chain(div(num(1), add([num(1), sq(u)])));
    case "ln": return div(du, u);
    case "log": return div(du, mul([u, fn("ln", [num(10)])]));
    case "exp": return chain(fn("exp", [u]));
    case "sqrt": return div(du, mul([num(2), fn("sqrt", [u])]));
    default: return null;
  }
}

/**
 * Replace every derivative operator in the tree with its exact value, so what
 * is left can be evaluated numerically without finite differences. Null when
 * any of them is beyond the differentiator above.
 */
export function resolveDerivatives(n: MathNode): MathNode | null {
  if (!containsDiff(n)) return n;

  const d = asDiff(n);
  if (d) {
    const body = resolveDerivatives(d.body);
    if (body === null) return null;
    return differentiate(body, d.variable);
  }

  switch (n.type) {
    case "add": case "mul": {
      const args = n.args.map(resolveDerivatives);
      if (args.some((a) => a === null)) return null;
      return n.type === "add" ? add(args as MathNode[]) : mul(args as MathNode[]);
    }
    case "div": {
      const a = resolveDerivatives(n.num);
      const b = resolveDerivatives(n.den);
      return a === null || b === null ? null : div(a, b);
    }
    case "pow": {
      const a = resolveDerivatives(n.base);
      const b = resolveDerivatives(n.exp);
      return a === null || b === null ? null : pow(a, b);
    }
    case "neg": {
      const a = resolveDerivatives(n.arg);
      return a === null ? null : neg(a);
    }
    case "fn": {
      const args = n.args.map((a) => (a.type === "sym" ? a : resolveDerivatives(a)));
      if (args.some((a) => a === null)) return null;
      return fn(n.name, args as MathNode[]);
    }
    case "rel": {
      const l = resolveDerivatives(n.lhs);
      const r = resolveDerivatives(n.rhs);
      return l === null || r === null ? null : { ...n, lhs: l, rhs: r };
    }
    default:
      return n;
  }
}


