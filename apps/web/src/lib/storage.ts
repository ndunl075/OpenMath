import type { Solution } from "@openmath/steps";

export interface HistoryEntry {
  id: string;
  latex: string;
  answer: string;
  kind: Solution["kind"];
  at: number;
}

const KEY = "openmath.history.v1";
const LIMIT = 60;

/**
 * History lives only in this browser and is never sent anywhere. localStorage
 * throws in a few contexts (private mode, blocked site data), so every access
 * is guarded and the app works fine with none.
 */
export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e === "object" && typeof (e as HistoryEntry).latex === "string",
    );
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Out of quota or storage blocked. History is a convenience, not the product.
  }
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "at">): HistoryEntry[] {
  const existing = readHistory().filter((e) => e.latex !== entry.latex);
  const next: HistoryEntry[] = [
    { ...entry, id: crypto.randomUUID(), at: Date.now() },
    ...existing,
  ];
  write(next);
  return next;
}

export function removeHistory(id: string): HistoryEntry[] {
  const next = readHistory().filter((e) => e.id !== id);
  write(next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return [];
}

const PREF_KEY = "openmath.prefs.v1";

export interface Preferences {
  speed: number;
  providerId?: string;
}

export function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { speed: 1 };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { speed: typeof parsed.speed === "number" ? parsed.speed : 1, ...parsed };
  } catch {
    return { speed: 1 };
  }
}

export function writePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
