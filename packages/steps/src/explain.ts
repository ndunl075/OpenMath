import en from "./explanations/en.json" with { type: "json" };

export interface Explanation {
  title: string;
  text: string;
}

type Catalogue = Record<string, Explanation>;

const CATALOGUES: Record<string, Catalogue> = { en: en as Catalogue };

export function availableLocales(): string[] {
  return Object.keys(CATALOGUES);
}

export function explanationKeys(locale = "en"): string[] {
  return Object.keys(CATALOGUES[locale] ?? {});
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/**
 * Look up the wording for a rule. Every rule must have an entry; a missing one
 * is a build error rather than a silent fallback, enforced by a test.
 */
export function explain(
  ruleId: string,
  vars: Record<string, string> = {},
  locale = "en",
): Explanation {
  const cat = CATALOGUES[locale] ?? CATALOGUES.en!;
  const entry = cat[ruleId] ?? CATALOGUES.en![ruleId];
  if (!entry) {
    return { title: ruleId.toLowerCase().replace(/_/g, " "), text: "" };
  }
  return { title: fill(entry.title, vars), text: fill(entry.text, vars) };
}
