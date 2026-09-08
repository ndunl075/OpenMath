const REPO = "ndunl075/OpenMath";

/**
 * Opens a prefilled GitHub issue. No server, no upload, no telemetry: the user
 * attaches the photo themselves if they want to, which is the zero-infra
 * feedback channel from ARCHITECTURE section 6.
 */
export function reportUrl(options: {
  latex: string;
  raw?: string;
  reason: string;
  detail?: string;
}): string {
  const title = `Bad result: ${options.latex.slice(0, 60)}`;
  const body = [
    "**What went wrong**",
    "",
    options.reason,
    "",
    "**Recognised expression**",
    "",
    "```latex",
    options.latex || "(empty)",
    "```",
    ...(options.raw && options.raw !== options.latex
      ? ["", "**Raw model output**", "", "```latex", options.raw, "```"]
      : []),
    ...(options.detail ? ["", "**Details**", "", options.detail] : []),
    "",
    "**The photo**",
    "",
    "Please attach it here if you can. Nothing is uploaded automatically.",
  ].join("\n");

  const params = new URLSearchParams({ title, body, labels: "bad-result" });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
