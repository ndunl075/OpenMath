import { readFile, writeFile } from "node:fs/promises";
import { createTransformersProvider, DEFAULT_PROVIDER_ID, PROVIDER_CONFIGS } from "@openmath/ocr";
import { auditCorpus } from "./audit.js";
import { CorpusError, loadCorpus } from "./corpus.js";
import { decodeImage } from "./decode.js";
import { installNodeCanvas } from "./node-canvas.js";
import { diffResults, formatDiff, formatResults } from "./report.js";
import { ModelLoadError, runProvider } from "./run.js";
import { CATEGORIES } from "./types.js";
import type { BenchResults, Category, CorpusItem, ProviderFailure, ProviderRun } from "./types.js";

export const USAGE = `openmath ocr bench

  pnpm bench --corpus <dir> [options]

  --corpus <dir>       directory holding the photos and manifest.jsonl (required)
  --provider <id>      ${Object.keys(PROVIDER_CONFIGS).join(" | ")} | all   (default ${DEFAULT_PROVIDER_ID})
  --out <file>         where to write the machine-readable results (default results.json)
  --baseline <file>    an earlier results.json; prints the deltas
  --category <name>    only score one of ${CATEGORIES.join(", ")}
  --limit <n>          only the first n photos, for a quick check
  --device <name>      auto | wasm | webgpu   (default auto)
  --check              validate and audit the corpus, then stop; no model is loaded
  --no-preprocess      feed the model the raw photo, to A/B the preprocessing
  --misses <n>         how many failing photos to list per provider (default 10)
  -h, --help           this text
`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface CliOptions {
  corpus: string;
  providers: string[];
  out: string;
  baseline?: string;
  category?: Category;
  limit?: number;
  device: "auto" | "wasm" | "webgpu";
  preprocess: boolean;
  misses: number;
  /** Stop after auditing the labels, which needs no weights. */
  check: boolean;
}

export type ParsedArgs = { help: true } | ({ help?: false } & CliOptions);

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const inline = argv[index]!.indexOf("=");
  if (inline > 0) return argv[index]!.slice(inline + 1);
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) throw new UsageError(`${flag} needs a value`);
  return next;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let corpus: string | undefined;
  let providerArg = DEFAULT_PROVIDER_ID;
  let out = "results.json";
  let baseline: string | undefined;
  let category: Category | undefined;
  let limit: number | undefined;
  let device: CliOptions["device"] = "auto";
  let preprocess = true;
  let misses = 10;
  let check = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flag = arg.split("=")[0]!;
    const consumed = (): string => {
      const value = takeValue(argv, i, flag);
      if (!arg.includes("=")) i++;
      return value;
    };

    switch (flag) {
      case "-h":
      case "--help":
        return { help: true };
      case "--corpus":
        corpus = consumed();
        break;
      case "--provider":
        providerArg = consumed();
        break;
      case "--out":
        out = consumed();
        break;
      case "--baseline":
        baseline = consumed();
        break;
      case "--category": {
        const value = consumed();
        if (!CATEGORIES.includes(value as Category)) {
          throw new UsageError(`--category must be one of ${CATEGORIES.join(", ")}`);
        }
        category = value as Category;
        break;
      }
      case "--limit": {
        const value = Number(consumed());
        if (!Number.isInteger(value) || value <= 0) throw new UsageError("--limit must be a positive integer");
        limit = value;
        break;
      }
      case "--device": {
        const value = consumed();
        if (value !== "auto" && value !== "wasm" && value !== "webgpu") {
          throw new UsageError("--device must be auto, wasm or webgpu");
        }
        device = value;
        break;
      }
      case "--misses": {
        const value = Number(consumed());
        if (!Number.isInteger(value) || value < 0) throw new UsageError("--misses must be zero or more");
        misses = value;
        break;
      }
      case "--no-preprocess":
        preprocess = false;
        break;
      case "--check":
        check = true;
        break;
      default:
        throw new UsageError(`unknown option ${arg}`);
    }
  }

  if (!corpus) throw new UsageError("--corpus is required");

  const providers =
    providerArg === "all"
      ? Object.keys(PROVIDER_CONFIGS)
      : providerArg.split(",").map((id) => id.trim()).filter(Boolean);
  for (const id of providers) {
    if (!PROVIDER_CONFIGS[id]) {
      throw new UsageError(`unknown provider "${id}"; known: ${Object.keys(PROVIDER_CONFIGS).join(", ")}, all`);
    }
  }

  return {
    corpus,
    providers,
    out,
    ...(baseline ? { baseline } : {}),
    ...(category ? { category } : {}),
    ...(limit ? { limit } : {}),
    device,
    preprocess,
    misses,
    check,
  };
}

/**
 * The message a provider throws is written for someone holding a phone ("type
 * the problem in instead"), which is no help at a terminal. Unwrap the causes
 * so the real failure - a DNS error, a 404 on the repo - is on screen.
 */
function causeChain(error: unknown): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && lines.length < 5) {
    lines.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return lines;
}

/**
 * The models are downloaded on first use, so the usual failure is not a bug in
 * this repo. Say which model, and what to check, instead of a stack trace.
 */
export function describeLoadFailure(providerId: string, error: ModelLoadError): string {
  const config = PROVIDER_CONFIGS[providerId];
  return [
    `Could not load the ${config?.label ?? providerId} model (${config?.modelId ?? "unknown repo"}).`,
    ``,
    ...causeChain(error.cause ?? error).map((line) => `  ${line}`),
    ``,
    `  The weights are fetched from the model host on first run, so check that:`,
    `  - this machine can reach the host (sandboxes and CI often cannot),`,
    `  - the repo id above exists and serves transformers.js-compatible ONNX`,
    `    (confirming that is ARCHITECTURE section 11, step 2),`,
    `  - the quantised build named in PROVIDER_CONFIGS is present in that repo.`,
    ``,
    `  Nothing was scored for this provider.`,
  ].join("\n");
}

function selectItems(items: readonly CorpusItem[], options: CliOptions): CorpusItem[] {
  const filtered = options.category ? items.filter((i) => i.category === options.category) : [...items];
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: ParsedArgs;
  try {
    options = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n\n${USAGE}`);
      return 2;
    }
    throw e;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let items: CorpusItem[];
  let dir: string;
  try {
    const corpus = await loadCorpus(options.corpus);
    dir = corpus.dir;
    items = selectItems(corpus.items, options);
  } catch (e) {
    if (e instanceof CorpusError) {
      process.stderr.write(`${e.message}\n`);
      return 2;
    }
    throw e;
  }
  if (items.length === 0) {
    process.stderr.write("no photos left after --category and --limit\n");
    return 2;
  }

  // Check the labels before blaming a model for them.
  const audit = auditCorpus(items);
  process.stdout.write(
    `\n${audit.scorable} of ${items.length} ground truths solve; answer match is scored over those.\n`,
  );
  for (const entry of audit.unscorable) {
    process.stdout.write(`  ${entry.file}  not scorable: ${entry.reason}${entry.message ? ` (${entry.message})` : ""}\n`);
  }
  for (const entry of audit.answerMismatches) {
    process.stdout.write(
      `  ${entry.file}  labelled answer ${entry.labelled} but the solver gets ${entry.solved}; check the label\n`,
    );
  }

  if (options.check) {
    const complaints = audit.unscorable.length + audit.answerMismatches.length;
    process.stdout.write(
      complaints === 0
        ? `\n${items.length} photos labelled and readable.\n`
        : `\n${complaints} label(s) worth a second look, listed above.\n`,
    );
    return 0;
  }

  installNodeCanvas();

  const runs: ProviderRun[] = [];
  const failures: ProviderFailure[] = [];
  for (const id of options.providers) {
    const config = PROVIDER_CONFIGS[id]!;
    process.stdout.write(`\n${config.label} (${config.modelId})\n`);
    // The published configs target a phone, where the only backend is wasm.
    // On a desktop Node run "auto" picks the fastest available backend; the
    // accuracy numbers carry over to the phone, the latency numbers do not.
    const provider = createTransformersProvider({ ...config, device: options.device });
    try {
      const run = await runProvider({
        provider,
        items,
        loadImage: (item) => decodeImage(item.path),
        preprocessImages: options.preprocess,
        modelId: config.modelId,
        device: options.device,
        onItem: (result, index, total) => {
          const answer = !result.scorable ? "unscorable" : result.answerMatch ? "answer ok" : "answer miss";
          const position = String(index + 1).padStart(String(total).length);
          process.stdout.write(
            `  [${position}/${total}] ${result.file}  ${Math.round(result.ms)} ms  ${answer}\n`,
          );
        },
      });
      runs.push(run);
    } catch (e) {
      if (e instanceof ModelLoadError) {
        process.stderr.write(`\n${describeLoadFailure(id, e)}\n`);
        failures.push({ provider: id, error: e.message });
        continue;
      }
      throw e;
    } finally {
      // Release the weights before the next provider loads its own: two models
      // in memory at once is the documented iOS failure mode (ARCHITECTURE
      // section 13), and it skews the timings here too.
      provider.dispose();
    }
  }

  const byCategory: Partial<Record<Category, number>> = {};
  for (const item of items) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;

  const results: BenchResults = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    corpus: {
      dir,
      images: items.length,
      byCategory,
      unscorable: audit.unscorable.length,
    },
    runs,
    ...(failures.length > 0 ? { failures } : {}),
  };

  process.stdout.write(`\n${formatResults(results, { misses: options.misses })}\n`);
  if (runs.length === 0) {
    process.stderr.write("\nnothing was scored, so no results file was written\n");
    return 1;
  }
  await writeFile(options.out, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${options.out}\n`);

  if (options.baseline) {
    const baseline = JSON.parse(await readFile(options.baseline, "utf8")) as BenchResults;
    process.stdout.write(`\n${formatDiff(diffResults(baseline, results), baseline)}\n`);
  }

  return failures.length > 0 ? 1 : 0;
}
