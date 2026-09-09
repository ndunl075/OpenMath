import { useCallback, useEffect, useState } from "preact/hooks";
import { trySolve } from "@openmath/steps";
import { DEFAULT_PROVIDER_ID, detectOutOfScope, normalizeLatex, normalizeWithReport } from "@openmath/ocr";
import type { Rect } from "@openmath/ocr";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { Icon } from "./components/Icon.js";
import { MathInput } from "./components/MathInput.js";
import { ResultSheet, type ResultOutcome, type SheetHeight } from "./components/ResultSheet.js";
import { Scanner } from "./components/Scanner.js";
import { useOcr } from "./hooks/useOcr.js";
import { useReducedMotion } from "./hooks/useReducedMotion.js";
import {
  addHistory, clearHistory, type HistoryEntry, readHistory, readPreferences,
  removeHistory, writePreferences,
} from "./lib/storage.js";

type Mode = "scan" | "input" | "history";

let counter = 0;
const nextId = () => `s${++counter}`;

export function App() {
  const [mode, setMode] = useState<Mode>("scan");
  const [draft, setDraft] = useState("");
  const [outcome, setOutcome] = useState<ResultOutcome | null>(null);
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>("peek");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [speed, setSpeed] = useState(1);

  const reducedMotion = useReducedMotion();
  const { status, recognize, reset, provider } = useOcr(DEFAULT_PROVIDER_ID);

  useEffect(() => {
    setHistory(readHistory());
    setSpeed(readPreferences().speed);
  }, []);

  const changeSpeed = useCallback((next: number) => {
    setSpeed(next);
    writePreferences({ ...readPreferences(), speed: next });
  }, []);

  const solveLatex = useCallback((latex: string, raw?: string) => {
    // Normalised here rather than only on the scan path. Someone typing on a
    // keyboard writes cos, not \cos, and an unrepaired cos(0) is read as
    // c*o*s*0 and answered 0 — the same confidently wrong answer a scan used
    // to give, on the input people reach for when the camera misreads.
    // Normalising is idempotent, so the scan path passing through twice is
    // harmless.
    const report = normalizeWithReport(latex);
    const trimmed = report.latex.trim();
    if (!trimmed) return;

    const scope = detectOutOfScope(trimmed);
    if (scope) {
      setOutcome({
        id: nextId(),
        latex: trimmed,
        ...(raw ? { raw } : {}),
        error: { reason: "unsupported", message: `${scope} are not supported yet.` },
      });
      setSheetHeight("peek");
      return;
    }

    // "Solve for y" names the variable; without it a two-variable equation like
    // y = 6x + 2 is answered for x, which is a different question.
    const result = trySolve(trimmed, report.solveFor);
    if (!result.ok) {
      setOutcome({
        id: nextId(),
        latex: trimmed,
        ...(raw ? { raw } : {}),
        error: { reason: result.reason, message: result.message },
      });
      setSheetHeight("peek");
      return;
    }

    setOutcome({
      id: nextId(),
      latex: trimmed,
      ...(raw ? { raw } : {}),
      solution: result.solution,
    });
    setSheetHeight("peek");
    setHistory(
      addHistory({
        latex: trimmed,
        answer: result.solution.answer,
        kind: result.solution.kind,
      }),
    );
  }, []);

  const onCapture = useCallback(
    async (source: HTMLCanvasElement | Blob, crop?: Rect) => {
      const result = await recognize(source, crop);
      if (!result) return;
      // Normalised once, here, for the draft the editor shows. The raw result
      // is what goes to the solver: normalising strips an instruction like
      // "solve for y", and doing it twice would drop the variable before the
      // solver ever saw it.
      const latex = normalizeLatex(result.latex);
      setDraft(latex);
      // Nothing usable came back: open the editor rather than an error card, so
      // the next tap is a fix instead of a retry.
      if (!latex.trim()) {
        setMode("input");
        return;
      }
      solveLatex(result.latex, result.raw);
    },
    [recognize, solveLatex],
  );

  const openEditor = useCallback(() => {
    if (outcome) setDraft(outcome.latex);
    setOutcome(null);
    setMode("input");
  }, [outcome]);

  const dismissSheet = useCallback(() => {
    setOutcome(null);
    reset();
  }, [reset]);

  return (
    <div class="app">
      {mode === "history" ? (
        <HistoryPanel
          entries={history}
          onOpen={(entry) => {
            setMode("scan");
            solveLatex(entry.latex);
          }}
          onRemove={(id) => setHistory(removeHistory(id))}
          onClear={() => setHistory(clearHistory())}
          onClose={() => setMode("scan")}
        />
      ) : mode === "input" ? (
        <div class="panel">
          <nav class="panel__nav" aria-label="Screens">
            <button
              type="button"
              class="nav-link"
              onClick={() => setMode("scan")}
              aria-label="Back to the camera"
            >
              <Icon name="camera" size={18} />
              Camera
            </button>
            <button type="button" class="nav-link" onClick={() => setMode("history")}>
              History
              <Icon name="history" size={18} />
            </button>
          </nav>
          <MathInput
            value={draft}
            onChange={setDraft}
            onSubmit={(value) => {
              solveLatex(value);
            }}
            autoFocus
          />
        </div>
      ) : (
        <Scanner
          active={mode === "scan" && !outcome}
          status={status}
          providerLabel={provider.label}
          providerBytes={provider.approximateBytes}
          onCapture={(source, crop) => void onCapture(source, crop)}
          onTypeIn={() => setMode("input")}
          onOpenHistory={() => setMode("history")}
        />
      )}

      {outcome ? (
        <>
          <div class="sheet-scrim" onClick={dismissSheet} aria-hidden="true" />
          <ResultSheet
            outcome={outcome}
            height={sheetHeight}
            onHeightChange={setSheetHeight}
            onDismiss={dismissSheet}
            onEdit={openEditor}
            speed={speed}
            onSpeedChange={changeSpeed}
            reducedMotion={reducedMotion}
          />
        </>
      ) : null}
    </div>
  );
}
