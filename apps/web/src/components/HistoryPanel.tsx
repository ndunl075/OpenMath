import type { HistoryEntry } from "../lib/storage.js";
import { Icon } from "./Icon.js";
import { MathView } from "./MathView.js";

export interface HistoryPanelProps {
  entries: HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function HistoryPanel({ entries, onOpen, onRemove, onClear, onClose }: HistoryPanelProps) {
  return (
    <div class="panel">
      <nav class="panel__nav" aria-label="Screens">
        <button type="button" class="nav-link" onClick={onClose} aria-label="Back to the camera">
          <Icon name="camera" size={18} />
          Camera
        </button>
      </nav>

      <header class="page-head">
        <h1 class="t-display">History</h1>
        {entries.length > 0 ? (
          <button type="button" class="text-button" onClick={onClear}>
            Clear all
          </button>
        ) : null}
      </header>
      <p class="page-lede">
        {entries.length === 0
          ? "Problems you solve are kept here, in this browser only. Nothing is uploaded."
          : `${entries.length === 1 ? "One problem" : `${entries.length} problems`}, kept in this browser only. Nothing is uploaded.`}
      </p>

      {entries.length === 0 ? (
        <p class="panel__empty">Nothing solved yet.</p>
      ) : (
        <ul class="history">
          {entries.map((entry) => (
            <li class="history__item" key={entry.id}>
              <button type="button" class="history__open" onClick={() => onOpen(entry)}>
                <MathView latex={entry.latex} label={entry.latex} class="history__problem" />
                <span class="history__meta">
                  <span class="history__answer">
                    <MathView latex={entry.answer} label={`Answer ${entry.answer}`} />
                  </span>
                  <time dateTime={new Date(entry.at).toISOString()}>{relativeTime(entry.at)}</time>
                </span>
              </button>
              <button
                type="button"
                class="icon-button"
                onClick={() => onRemove(entry.id)}
                aria-label={`Delete ${entry.latex}`}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
