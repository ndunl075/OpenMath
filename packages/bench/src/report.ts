import type { BenchResults, Category, ItemResult, Metrics, ProviderRun } from "./types.js";

/**
 * Everything here returns a string rather than printing, so the report is
 * testable and can be written to a file as easily as to a terminal.
 */

type Align = "left" | "right";

function table(headers: readonly string[], rows: readonly (readonly string[])[], align: readonly Align[]): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => (align[i] === "right" ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [
    line(headers),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map(line),
  ];
}

export function formatPercent(rate: number, denominator: number): string {
  if (denominator === 0) return "-";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function metricRow(name: string, m: Metrics): string[] {
  return [
    name,
    String(m.n),
    formatPercent(m.answerMatchRate, m.scorable),
    formatPercent(m.exactMatchRate, m.n),
    m.cer.toFixed(3),
    formatPercent(m.solvableRate, m.n),
    formatMs(m.medianMs),
    formatMs(m.p90Ms),
  ];
}

function missLine(item: ItemResult): string {
  const why = item.error
    ? `recognition failed: ${item.error}`
    : !item.solvable
      ? `${item.failure ?? "unreadable"}`
      : "different answer";
  const predicted = item.predicted || "(nothing)";
  return `    ${item.file}  [${item.category}]  ${item.expected}  ->  ${predicted}   (${why})`;
}

export interface ReportOptions {
  /** How many failing photos to list per provider. The rest are in results.json. */
  misses?: number;
}

export function formatRun(run: ProviderRun, options: ReportOptions = {}): string {
  const misses = options.misses ?? 10;
  const out: string[] = [];
  const head = [run.provider, run.label, run.license, run.modelId, run.device && `device ${run.device}`]
    .filter(Boolean)
    .join("  ");
  out.push(head);
  out.push(`model load ${formatMs(run.loadMs)}`);
  out.push("");

  const rows = [metricRow("all", run.overall)];
  for (const category of Object.keys(run.byCategory).sort() as Category[]) {
    const m = run.byCategory[category];
    if (m) rows.push(metricRow(category, m));
  }
  out.push(
    ...table(
      ["category", "n", "answer", "exact", "CER", "solvable", "median", "p90"],
      rows,
      ["left", "right", "right", "right", "right", "right", "right", "right"],
    ).map((l) => `  ${l}`),
  );
  out.push("");

  const { overall } = run;
  out.push(
    `  answer match is over the ${overall.scorable} of ${overall.n} images whose ground truth the solver can answer`,
  );
  const failureCounts = Object.entries(overall.failures)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
  if (failureCounts) out.push(`  reads that produced no answer: ${failureCounts}`);
  if (overall.errors > 0) out.push(`  recognition threw on ${overall.errors} image(s)`);

  const failed = run.items.filter((i) => i.scorable && !i.answerMatch);
  if (failed.length > 0) {
    out.push("");
    out.push(`  misses (${failed.length})`);
    for (const item of failed.slice(0, misses)) out.push(missLine(item));
    if (failed.length > misses) {
      out.push(`    ... ${failed.length - misses} more, see results.json`);
    }
  }
  return out.join("\n");
}

export function formatResults(results: BenchResults, options: ReportOptions = {}): string {
  const counts = Object.entries(results.corpus.byCategory)
    .map(([category, count]) => `${category} ${count}`)
    .join(", ");
  const out = [
    "OpenMath OCR bench",
    `corpus  ${results.corpus.dir}  (${results.corpus.images} images: ${counts})`,
  ];
  if (results.corpus.unscorable > 0) {
    out.push(
      `        ${results.corpus.unscorable} ground truth(s) the solver itself cannot answer, excluded from answer match`,
    );
  }
  for (const run of results.runs) {
    out.push("", formatRun(run, options));
  }
  for (const failure of results.failures ?? []) {
    out.push("", `${failure.provider}  did not run: ${failure.error}`);
  }
  return out.join("\n");
}

export interface MetricComparison {
  provider: string;
  category: "all" | Category;
  current: Metrics;
  previous: Metrics;
}

export interface ItemChange {
  provider: string;
  file: string;
  expected: string;
  before: string;
  after: string;
}

export interface BenchDiff {
  comparisons: MetricComparison[];
  /** Photos the change fixed, and photos it broke. The second list is the one that matters. */
  fixed: ItemChange[];
  regressed: ItemChange[];
  newProviders: string[];
  missingProviders: string[];
}

/** Compare a run against an earlier results.json, so a fine-tune can be judged. */
export function diffResults(baseline: BenchResults, current: BenchResults): BenchDiff {
  const previousRuns = new Map(baseline.runs.map((r) => [r.provider, r]));
  const comparisons: MetricComparison[] = [];
  const fixed: ItemChange[] = [];
  const regressed: ItemChange[] = [];
  const newProviders: string[] = [];

  for (const run of current.runs) {
    const previous = previousRuns.get(run.provider);
    if (!previous) {
      newProviders.push(run.provider);
      continue;
    }
    comparisons.push({ provider: run.provider, category: "all", current: run.overall, previous: previous.overall });
    for (const category of Object.keys(run.byCategory).sort() as Category[]) {
      const now = run.byCategory[category];
      const before = previous.byCategory[category];
      if (now && before) {
        comparisons.push({ provider: run.provider, category, current: now, previous: before });
      }
    }

    const previousItems = new Map(previous.items.map((i) => [i.file, i]));
    for (const item of run.items) {
      const was = previousItems.get(item.file);
      // Only photos scorable in both runs can move; a relabelled ground truth is not a regression.
      if (!was || !was.scorable || !item.scorable) continue;
      const change: ItemChange = {
        provider: run.provider,
        file: item.file,
        expected: item.expected,
        before: was.predicted,
        after: item.predicted,
      };
      if (was.answerMatch && !item.answerMatch) regressed.push(change);
      if (!was.answerMatch && item.answerMatch) fixed.push(change);
    }
  }

  const currentProviders = new Set(current.runs.map((r) => r.provider));
  const missingProviders = baseline.runs.map((r) => r.provider).filter((id) => !currentProviders.has(id));
  return { comparisons, fixed, regressed, newProviders, missingProviders };
}

function signed(value: number, digits: number, suffix = ""): string {
  const rounded = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${rounded}${suffix}`;
}

export function formatDiff(diff: BenchDiff, baseline: BenchResults): string {
  const out = [`vs baseline recorded ${baseline.generatedAt}`, ""];

  const rows = diff.comparisons.map((c) => [
    c.provider,
    c.category,
    `${formatPercent(c.current.answerMatchRate, c.current.scorable)} (${signed(
      (c.current.answerMatchRate - c.previous.answerMatchRate) * 100, 1,
    )})`,
    `${formatPercent(c.current.exactMatchRate, c.current.n)} (${signed(
      (c.current.exactMatchRate - c.previous.exactMatchRate) * 100, 1,
    )})`,
    `${c.current.cer.toFixed(3)} (${signed(c.current.cer - c.previous.cer, 3)})`,
    `${formatMs(c.current.medianMs)} (${signed(c.current.medianMs - c.previous.medianMs, 0, " ms")})`,
  ]);
  out.push(
    ...table(
      ["provider", "category", "answer", "exact", "CER", "median"],
      rows,
      ["left", "left", "right", "right", "right", "right"],
    ).map((l) => `  ${l}`),
  );

  if (diff.regressed.length > 0) {
    out.push("", `  regressed (${diff.regressed.length})`);
    for (const change of diff.regressed) {
      out.push(`    ${change.file}  ${change.expected}   was  ${change.before}   now  ${change.after}`);
    }
  }
  if (diff.fixed.length > 0) {
    out.push("", `  fixed (${diff.fixed.length}): ${diff.fixed.map((c) => c.file).join(", ")}`);
  }
  if (diff.newProviders.length > 0) {
    out.push("", `  not in the baseline: ${diff.newProviders.join(", ")}`);
  }
  if (diff.missingProviders.length > 0) {
    out.push(`  in the baseline but not run: ${diff.missingProviders.join(", ")}`);
  }
  return out.join("\n");
}
