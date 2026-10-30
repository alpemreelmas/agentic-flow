// Pure reducer: folds the JSONL events written by looper/events.py into a per-run view model.
// No DOM, no Tauri, so it can be tested with plain `node --test`.

export type RunEvent = { ts: number; type: string; [k: string]: unknown };

export interface ToolDiff { path: string; oldText: string; newText: string }

export interface ToolItem {
  kind: "tool";
  id: string;
  title: string;
  status: string;
  toolKind: string;   // read / edit / execute ... as reported by the agent
  input: string;      // the shell command, or the tool's input as JSON
  output: string[];   // text blocks the tool returned (terminal output etc.)
  rawOutput: string;  // fallback when the agent sent raw_output but no content blocks
  diffs: ToolDiff[];
}

export interface FindingView { severity: string; file: string; line: number; text: string }

export type Item =
  | { kind: "attempt"; n: number; role: string; cli: string }
  | { kind: "review"; reviewer: string; cli: string }
  | { kind: "findings"; reviewer: string; parsed: boolean; findings: FindingView[] }
  | { kind: "note"; text: string }
  | { kind: "stage"; label: string }
  | { kind: "triage"; decision: string; size: string; summary: string; questions: string[]; plan: string[];
      criteria: string[]; risks: string[]; proposedVerify: string }
  | { kind: "deliver"; ok: boolean; url: string; note: string; draft: boolean }
  | { kind: "prompt"; role: string; text: string; skills?: string[] }
  | { kind: "user"; text: string }
  | { kind: "message"; text: string }
  | { kind: "thought"; text: string }
  | ToolItem
  | { kind: "permission"; title: string; granted: boolean }
  | { kind: "plan"; entries: string[] }
  | { kind: "stop"; reason: string }
  | { kind: "verify"; ok: boolean; command: string; output: string }
  | { kind: "error"; error: string };

export type RunStatus = "running" | "review" | "needs_human";

export interface Run {
  id: string;
  title: string;
  role: string;
  workspace: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  items: Item[];
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const pretty = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

// A shell tool's input is {command, ...}: show just the command. Anything else (edits, reads) as JSON.
function formatInput(v: unknown): string {
  const command = (v as { command?: unknown } | null)?.command;
  return typeof command === "string" ? command : pretty(v);
}

function extractContent(content: unknown[]): { output: string[]; diffs: ToolDiff[] } {
  const output: string[] = [];
  const diffs: ToolDiff[] = [];
  for (const c of content as Record<string, any>[]) {
    if (c.type === "content" && c.content?.type === "text") output.push(str(c.content.text));
    else if (c.type === "diff") diffs.push({ path: str(c.path), oldText: str(c.old_text), newText: str(c.new_text) });
    else if (c.type === "terminal") output.push(`[terminal ${str(c.terminal_id)}]`);
  }
  return { output, diffs };
}

// tool_call_update fields replace what was there (ACP semantics), they don't append.
function mergeTool(tool: ToolItem, ev: RunEvent): void {
  if (typeof ev.title === "string") tool.title = ev.title;
  if (typeof ev.status === "string") tool.status = ev.status;
  if (typeof ev.tool_kind === "string") tool.toolKind = ev.tool_kind;
  if (ev.raw_input !== undefined) tool.input = formatInput(ev.raw_input);
  if (Array.isArray(ev.content)) Object.assign(tool, extractContent(ev.content));
  if (ev.raw_output !== undefined) tool.rawOutput = pretty(ev.raw_output);
}

export function applyEvent(runs: Map<string, Run>, runId: string, ev: RunEvent): void {
  let run = runs.get(runId);
  if (!run) {
    run = { id: runId, title: runId, role: "", workspace: "", status: "running", startedAt: ev.ts, items: [] };
    runs.set(runId, run);
  }
  const last = run.items[run.items.length - 1];
  switch (ev.type) {
    case "run_start":
      run.title = str(ev.title, run.title);
      run.role = str(ev.role);
      run.workspace = str(ev.workspace);
      break;
    case "attempt_start":
      run.status = "running"; // a run resumed after a crash starts a new attempt in the same file
      run.items.push({ kind: "attempt", n: Number(ev.attempt), role: str(ev.role), cli: str(ev.cli) });
      break;
    case "user_message":
      run.items.push({ kind: "user", text: str(ev.text) });
      break;
    case "agent_message":
    case "agent_thought": {
      const kind = ev.type === "agent_message" ? "message" : "thought";
      if (last && last.kind === kind) last.text += str(ev.text); // chunks of one message merge
      else run.items.push({ kind, text: str(ev.text) });
      break;
    }
    case "triage_start":
      run.items.push({ kind: "stage", label: `Triage · ${str(ev.role)} · ${str(ev.cli)}` });
      break;
    case "triage_result":
      run.items.push({ kind: "triage", decision: str(ev.decision), size: str(ev.size), summary: str(ev.summary),
                       questions: strList(ev.questions), plan: strList(ev.plan), criteria: strList(ev.criteria),
                       risks: strList(ev.risks), proposedVerify: str(ev.proposed_verify) });
      break;
    case "triage_skipped":
      run.items.push({ kind: "note", text: `Triage skipped: ${str(ev.reason)}` });
      break;
    case "review_start":
      run.items.push({ kind: "review", reviewer: str(ev.reviewer), cli: str(ev.cli) });
      break;
    case "review_result": {
      const raw = Array.isArray(ev.findings) ? (ev.findings as Record<string, unknown>[]) : [];
      run.items.push({
        kind: "findings", reviewer: str(ev.reviewer), parsed: ev.parsed === true,
        findings: raw.map((f) => ({ severity: str(f.severity, "minor"), file: str(f.file),
                                    line: typeof f.line === "number" ? f.line : 0, text: str(f.text) })),
      });
      break;
    }
    case "deliver":
      run.items.push({ kind: "deliver", ok: ev.ok === true, url: str(ev.url), note: str(ev.note), draft: ev.draft === true });
      break;
    case "review_skipped":
      run.items.push({ kind: "note", text: `Review skipped: ${str(ev.reason)}` });
      break;
    case "skills_used":
      if (Array.isArray(ev.skills) && ev.skills.length) run.items.push({ kind: "note", text: "Skills · " + ev.skills.map((s: any) => `${s.name} (${s.source})`).join(", ") });
      break;
    case "prompt":
      run.items.push({ kind: "prompt", role: str(ev.role), text: str(ev.text), ...(Array.isArray(ev.skills) && ev.skills.length ? {skills: ev.skills.map((s: any) => String(s.id))} : {}) });
      break;
    case "attempt_end":
      run.items.push({ kind: "stop", reason: str(ev.stop_reason) });
      break;
    case "tool_call": {
      const tool: ToolItem = { kind: "tool", id: str(ev.id), title: "", status: "pending", toolKind: "",
                               input: "", output: [], rawOutput: "", diffs: [] };
      mergeTool(tool, ev);
      run.items.push(tool);
      break;
    }
    case "tool_update": {
      const tool = run.items.find((i): i is ToolItem => i.kind === "tool" && i.id === ev.id);
      if (tool) mergeTool(tool, ev);
      break;
    }
    case "permission":
      run.items.push({ kind: "permission", title: str(ev.title), granted: ev.granted === true });
      break;
    case "plan":
      run.items.push({ kind: "plan", entries: Array.isArray(ev.entries) ? ev.entries.map(String) : [] });
      break;
    case "verify":
      run.items.push({ kind: "verify", ok: ev.ok === true, command: str(ev.command), output: str(ev.output) });
      break;
    case "agent_error":
      run.items.push({ kind: "error", error: str(ev.error) });
      break;
    case "interrupted":
      run.items.push({ kind: "note", text: `Interrupted: ${str(ev.reason)}` });
      run.status = "needs_human";
      break;
    case "run_end":
      run.status = ev.status === "review" ? "review" : "needs_human";
      run.endedAt = ev.ts;
      break;
  }
}
