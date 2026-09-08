import { describe, expect, it, vi } from "vitest";
import { OcrUnavailableError } from "@openmath/ocr";
import { describeLoadFailure, main, ModelLoadError, parseArgs, USAGE, UsageError } from "@openmath/bench";

function options(...argv: string[]): Exclude<ReturnType<typeof parseArgs>, { help: true }> {
  const parsed = parseArgs(argv);
  if (parsed.help) throw new Error("expected options, got help");
  return parsed;
}

describe("command line", () => {
  it("defaults to the shipped provider and a results.json next to the run", () => {
    const parsed = options("--corpus", "corpus");
    expect(parsed.corpus).toBe("corpus");
    expect(parsed.providers).toEqual(["texo"]);
    expect(parsed.out).toBe("results.json");
    expect(parsed.preprocess).toBe(true);
    expect(parsed.device).toBe("auto");
  });

  it("accepts --flag value and --flag=value alike", () => {
    expect(options("--corpus=corpus", "--provider=texteller").providers).toEqual(["texteller"]);
    expect(options("--corpus", "corpus", "--limit", "5").limit).toBe(5);
  });

  it("expands --provider all", () => {
    expect(options("--corpus", "c", "--provider", "all").providers).toEqual([
      "texo",
      "texteller",
      "pix2text-mfr",
    ]);
  });

  it("takes a comma-separated pair of providers", () => {
    expect(options("--corpus", "c", "--provider", "texo,texteller").providers).toEqual([
      "texo",
      "texteller",
    ]);
  });

  it("refuses a corpus-less run", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  it("names the known providers when given an unknown one", () => {
    expect(() => parseArgs(["--corpus", "c", "--provider", "gpt"])).toThrow(/texo/);
  });

  it("refuses a category that is not one of the three", () => {
    expect(() => parseArgs(["--corpus", "c", "--category", "whiteboard"])).toThrow(/printed/);
    expect(options("--corpus", "c", "--category", "handwritten").category).toBe("handwritten");
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    expect(() => parseArgs(["--corpus", "c", "--fast"])).toThrow(/unknown option --fast/);
  });

  it("refuses a flag with no value", () => {
    expect(() => parseArgs(["--corpus"])).toThrow(/needs a value/);
  });

  it("can stop after checking the labels, which needs no model", () => {
    expect(options("--corpus", "c", "--check").check).toBe(true);
    expect(options("--corpus", "c").check).toBe(false);
  });

  it("turns preprocessing off", () => {
    expect(options("--corpus", "c", "--no-preprocess").preprocess).toBe(false);
  });

  it("answers --help without needing a corpus", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(USAGE).toContain("--baseline");
  });
});

describe("when the weights will not load", () => {
  it("says which model, why, and what to check", () => {
    // What a provider actually throws: a message written for a phone screen,
    // wrapped around the real cause.
    const thrown = new OcrUnavailableError(
      "Could not load the Texo model. Check your connection, or type the problem in instead.",
      new Error("fetch failed: getaddrinfo ENOTFOUND huggingface.co"),
    );
    const message = describeLoadFailure("texo", new ModelLoadError("texo", thrown));

    expect(message).toContain("Texo");
    expect(message).toContain("alephpi/FormulaNet");
    expect(message).toContain("getaddrinfo ENOTFOUND huggingface.co");
    expect(message).toContain("Nothing was scored for this provider.");
  });
});

/** Capture what the harness prints, so the exit codes can be checked quietly. */
async function runMain(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main(argv), out, err };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe("the harness before any model is involved", () => {
  it("prints usage and succeeds for --help", async () => {
    const { code, out } = await runMain("--help");
    expect(code).toBe(0);
    expect(out).toContain("--corpus");
  });

  it("fails with usage, not a stack trace, on a bad flag", async () => {
    const { code, err } = await runMain("--corpus", "c", "--nope");
    expect(code).toBe(2);
    expect(err).toContain("unknown option --nope");
    expect(err).toContain("pnpm bench");
  });

  it("says what is missing when the corpus directory is not one", async () => {
    const { code, err } = await runMain("--corpus", "/definitely/not/a/corpus");
    expect(code).toBe(2);
    expect(err).toContain("manifest.jsonl");
  });
});
