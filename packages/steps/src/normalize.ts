import {
  add, children, div, type MathNode, mul, neg, num, pow, Rational, withChildren,
} from "@openmath/math-core";

/**
 * Silent structural tidying applied between visible steps: flattening nested
 * sums and products, collapsing double negatives, and floating a minus sign to
 * the front of a product. None of this is worth a step card, but without it the
 * rules below would need to handle every equivalent shape.
 *
 * Node ids are preserved wherever a node survives, so the animation layer can
 * still match terms across the step boundary.
 */
function once(n: MathNode): MathNode {
  const original = children(n);
  const kids = original.map(once);
  // Rebuild only when a child actually changed. Returning the same object when
  // nothing did is what lets `normalize` below stop after one pass instead of
  // running its whole budget on every call.
  const touched = kids.some((k, i) => k !== original[i]);
  let node = touched ? withChildren(n, kids) : n;

  // -(-x) -> x
  if (node.type === "neg" && node.arg.type === "neg") {
    return node.arg.arg;
  }
  // -(number) -> negative number, keeping the outer id
  if (node.type === "neg" && node.arg.type === "num") {
    return num(node.arg.value.neg(), node.id);
  }

  // x^{1/3}: the exponent parses as a division, and both the power rule and the
  // integral power rule want a single number there, so they were declining a
  // fractional exponent outright. Folded only in exponent position — folding
  // 8/2 into 4 everywhere would delete the "simplify the fraction" step that
  // solving 2x = 8 is supposed to show.
  if (
    node.type === "pow" && node.exp.type === "div" &&
    node.exp.num.type === "num" && node.exp.den.type === "num" &&
    !node.exp.den.value.isZero()
  ) {
    return pow(node.base, num(node.exp.num.value.div(node.exp.den.value), node.exp.id), node.id);
  }

  if (node.type === "div") {
    // -1/x^2 reads as a negative fraction, not a fraction of a negative.
    if (node.num.type === "neg") {
      return neg(div(node.num.arg, node.den, node.id));
    }
    if (node.num.type === "num" && node.num.value.isNegative()) {
      return neg(div(num(node.num.value.neg()), node.den, node.id));
    }
    // Same again when the sign is on the leading coefficient of a product, so
    // an odd power of sine does not finish as "- (-2 cos^3 x)/3".
    if (node.num.type === "mul") {
      const factors = node.num.args;
      const lead = factors[0];
      if (lead && lead.type === "num" && lead.value.isNegative()) {
        const flipped = mul(
          [num(lead.value.neg(), lead.id), ...factors.slice(1)],
          node.num.id,
        );
        return neg(div(flipped, node.den, node.id));
      }
    }
  }

  if (node.type === "add") {
    // flatten nested sums
    if (node.args.some((a) => a.type === "add")) {
      const args: MathNode[] = [];
      for (const a of node.args) {
        if (a.type === "add") args.push(...a.args);
        else args.push(a);
      }
      node = add(args, node.id);
    }
    if (node.type === "add" && node.args.length === 1) return node.args[0]!;
    if (node.type === "add" && node.args.length === 0) return num(Rational.ZERO, node.id);
  }

  if (node.type === "mul") {
    if (node.args.some((a) => a.type === "mul")) {
      const args: MathNode[] = [];
      for (const a of node.args) {
        if (a.type === "mul") args.push(...a.args);
        else args.push(a);
      }
      node = mul(args, node.id);
    }
    if (node.type === "mul") {
      // Coefficient first: "2x" is how a student writes it, "x \\cdot 2" is not.
      const numbers = node.args.filter((a) => a.type === "num");
      if (numbers.length > 0 && node.args[0]!.type !== "num") {
        const others = node.args.filter((a) => a.type !== "num");
        node = mul([...numbers, ...others], node.id);
      }
    }

    if (node.type === "mul" && node.args.length > 1) {
      // A leading -1 is a minus sign, not a factor: without this a root prints
      // as "-1 \\sqrt{2}" instead of "-\\sqrt{2}".
      const [first, ...others] = node.args;
      if (first && first.type === "num" && first.value.equals(Rational.NEG_ONE)) {
        const body = others.length === 1 ? others[0]! : mul(others, node.id);
        return neg(body);
      }
    }

    if (node.type === "mul") {
      // float minus signs out of the product
      const negCount = node.args.filter((a) => a.type === "neg").length;
      if (negCount > 0) {
        const stripped = node.args.map((a) => (a.type === "neg" ? a.arg : a));
        const body = mul(stripped, node.id);
        return negCount % 2 === 1 ? neg(body) : body;
      }
      if (node.args.length === 1) return node.args[0]!;
      if (node.args.length === 0) return num(Rational.ONE, node.id);
    }
  }

  return node;
}

export function normalize(n: MathNode): MathNode {
  let cur = n;
  for (let i = 0; i < 50; i++) {
    const next = once(cur);
    if (next === cur) return next;
    cur = next;
  }
  return cur;
}
