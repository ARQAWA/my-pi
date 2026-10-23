// Display-only facts from completed RQW results. Never retain output, requested replacement text or diffs.
export type NestedDisplay =
  | { version: 1; tool: "bash"; exitCode: number }
  | { version: 1; tool: "edit"; files: { path: string; ok: boolean; outcome?: "possibly_changed"; added?: number; removed?: number }[] };
export type NestedDisplayRecord = NestedDisplay & { id: string };

function counts(details: any): { added: number; removed: number } | undefined {
  if (typeof details?.patch === "string") {
    let added = 0, removed = 0, oldLeft = 0, newLeft = 0, hunks = 0;
    for (const line of details.patch.split(/\r?\n/)) {
      if (oldLeft > 0 || newLeft > 0) {
        if (line.startsWith("\\")) continue;
        if (line.startsWith("+")) { added++; newLeft--; }
        else if (line.startsWith("-")) { removed++; oldLeft--; }
        else { oldLeft--; newLeft--; }
      } else {
        const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
        if (h) { hunks++; oldLeft = Number(h[1] ?? 1); newLeft = Number(h[2] ?? 1); }
      }
    }
    if (hunks) return { added, removed };
  }
  if (typeof details?.diff !== "string") return undefined;
  let added = 0, removed = 0, lines = 0;
  for (const line of details.diff.split(/\r?\n/)) {
    const m = /^([+\- ]) *\d+(?: |$)/.exec(line);
    if (!m) continue;
    lines++;
    if (m[1] === "+") added++;
    else if (m[1] === "-") removed++;
  }
  return lines ? { added, removed } : undefined;
}

export function nestedDisplay(tool: string, params: any, result: any): NestedDisplay | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (tool === "bash") {
    const exitCode = result.structuredContent?.exit_code;
    return Number.isInteger(exitCode) ? { version: 1, tool, exitCode } : undefined;
  }
  if (tool !== "edit") return undefined;
  if (Array.isArray(result.details?.files)) {
    const files = result.details.files.filter((f: any) => typeof f?.path === "string" && typeof f.ok === "boolean").map((f: any) => ({
      path: f.path, ok: f.ok,
      ...(f.outcome === "possibly_changed" ? { outcome: "possibly_changed" as const } : {}),
      ...(f.ok ? counts(f.details) : undefined),
    }));
    return files.length ? { version: 1, tool, files } : undefined;
  }
  // A single-file stock result has no path field. Use only the target spelling, never the requested edit text.
  const path = params?.edits?.[0]?.path || params?.path;
  const confirmed = counts(result.details);
  return typeof path === "string" && result.isError !== true && confirmed
    ? { version: 1, tool, files: [{ path, ok: true, ...confirmed }] } : undefined;
}

export function withNestedDisplay<T>(result: T, calls: NestedDisplayRecord[]): T {
  if (!calls.length || !result || typeof result !== "object") return result;
  const r = result as any;
  return { ...r, details: { ...r.details, rqwToolsNested: { version: 1, calls } } };
}
