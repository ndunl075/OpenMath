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
      <header class="panel__head">
        <button type="button" class="icon-button icon-button--subtle" onClick={onClose} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        <h1>History</h1>
        {entries.length > 0 ? (
          <button type="button" class="button button--ghost button--small" onClick={onClear}>
            Clear all
          </button>
        ) : (
          <span class="icon-button icon-button--placeholder" aria-hidden="true" />
        )}
      </header>

      {entries.length === 0 ? (
        <div class="panel__empty">
          <Icon name="history" size={30} />
          <p>Nothing here yet. Problems you solve are saved on this device only.</p>
        </div>
      ) : (
        <ul class="history">
          {entries.map((entry) => (
            <li class="history__item" key={entry.id}>
              <button type="button" class="history__open" onClick={() => onOpen(entry)}>
                <MathView latex={entry.latex} label={entry.latex} />
                <span class="history__meta">
                  <span class="history__answer">
                    <MathView latex={entry.answer} label={`Answer ${entry.answer}`} />
                  </span>
                  <time dateTime={new Date(entry.at).toISOString()}>{relativeTime(entry.at)}</time>
                </span>
              </button>
              <button
                type="button"
                class="icon-button icon-button--subtle"
                onClick={() => onRemove(entry.id)}
                aria-label={`Delete ${entry.latex}`}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p class="panel__footnote">
        <Icon name="shield" size={15} />
        History lives in this browser and is never uploaded.
      </p>
    </div>
  );
}
