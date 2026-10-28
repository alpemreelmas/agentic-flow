// Composer autocomplete, kept free of DOM so it can be tested: which token is the caret in, and
// which candidates match it.
export type Trigger = { sigil: "/" | "@" | "#"; query: string; start: number; end: number };
export interface Candidate { kind: "command" | "skill" | "file"; label: string; insert: string; detail?: string }

/** The `/x`, `@x` or `#x` token ending at the caret, or null. `/` only counts at the start of a line. */
export function triggerAt(text: string, caret: number): Trigger | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const token = text.slice(start, caret);
  const sigil = token[0];
  if (sigil !== "/" && sigil !== "@" && sigil !== "#") return null;
  if (sigil === "/" && start > 0 && text[start - 1] !== "\n") return null;
  return { sigil, query: token.slice(1), start, end: caret };
}

/** Prefix beats substring beats in-order letters; file names are matched on the basename first. */
function score(label: string, query: string): number {
  if (!query) return 1;
  const l = label.toLowerCase(), q = query.toLowerCase();
  const base = l.slice(l.lastIndexOf("/") + 1);
  if (base.startsWith(q)) return 100 - base.length * 0.01;
  if (l.startsWith(q)) return 90;
  const at = l.indexOf(q);
  if (at >= 0) return 70 - at * 0.01;
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 30 - label.length * 0.01 : 0;
}

export function rank(items: Candidate[], query: string, limit = 8): Candidate[] {
  return items
    .map((c) => ({ c, s: score(c.label, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Replaces the trigger token with the chosen text. Returns the new text and caret. */
export function accept(text: string, t: Trigger, c: Candidate): { text: string; caret: number } {
  const ins = c.insert + " ";
  return { text: text.slice(0, t.start) + ins + text.slice(t.end), caret: t.start + ins.length };
}

/** Paths mentioned as `@path` in the text that really exist in the file list. */
export function mentionedFiles(text: string, files: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)@(\S+)/g)) if (files.has(m[1])) found.add(m[1]);
  return [...found];
}

/** `#name` tokens that are known skills. */
export function mentionedSkills(text: string, skills: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\w-]+)/g)) if (skills.has(m[1])) found.add(m[1]);
  return [...found];
}
