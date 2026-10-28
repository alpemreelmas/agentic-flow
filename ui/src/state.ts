// Shared UI state. Pages read it and call schedule() after changing it.
import type { Run } from "./runModel.ts";

export type Page = "overview" | "runs" | "queue" | "registry" | "settings";
export interface ServiceStatus { running: boolean; phase: string; detail: string; pid: number; started_at: number }

export const runs = new Map<string, Run>();
export const ui = {
  page: "runs" as Page,
  selected: null as string | null,
  following: true, // auto-select the newest run until the user picks one
  query: "",
  statusFilter: "all" as "all" | Run["status"],
  itemFilter: "all" as "all" | "errors" | "tools",
  hideThoughts: false,
  service: { running: false, phase: "stopped", detail: "", pid: 0, started_at: 0 } as ServiceStatus,
  serviceBusy: false,
  serviceError: "", // why the last start failed (e.g. settings incomplete)
  lastEventAt: 0,
  paths: { runs: "", registry: "" },
};

let render: () => void = () => {};
let queued = false;
export function setRenderer(fn: () => void) { render = fn; }
// Events arrive in bursts (history replay); coalesce into one render per frame.
export function schedule() {
  if (!queued) {
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }
}

export const sortedRuns = () => [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
export const STAGES = ["TRIAGE", "IMPLEMENT", "VERIFY", "REVIEW", "DELIVER"];
const STAGE_ICON = ["checklist", "code", "fact_check", "rate_review", "rocket_launch"];
export const stageIcon = (i: number) => STAGE_ICON[i];

/** Furthest stage a run has reached, from the items it holds (-1: none yet). */
export function stageOf(run: Run): number {
  let n = -1;
  for (const i of run.items) {
    const k = i.kind;
    if (k === "stage" || k === "triage") n = Math.max(n, 0);
    else if (k === "attempt") n = Math.max(n, 1);
    else if (k === "verify") n = Math.max(n, 2);
    else if (k === "review" || k === "findings") n = Math.max(n, 3);
    else if (k === "deliver") n = Math.max(n, 4);
  }
  return n;
}

export const hasError = (r: Run) => r.items.some((i) => i.kind === "error" || (i.kind === "deliver" && !i.ok));
export const prUrl = (r: Run) => r.items.find((i) => i.kind === "deliver" && i.ok && i.url);
/** Design status vocabulary on top of the three the model knows. */
export type Shown = "running" | "needs_human" | "review" | "failed";
export const shown = (r: Run): Shown => (r.status === "needs_human" && hasError(r) ? "failed" : r.status);
export const SHOWN_STYLE: Record<Shown, { label: string; dot: string; chip: string; text: string }> = {
  running: { label: "RUNNING", dot: "bg-secondary", chip: "bg-secondary/10 text-secondary", text: "text-secondary" },
  needs_human: { label: "NEEDS HUMAN", dot: "bg-tertiary", chip: "bg-tertiary/10 text-tertiary", text: "text-tertiary" },
  review: { label: "IN REVIEW", dot: "bg-tertiary-container", chip: "bg-tertiary-container/20 text-tertiary", text: "text-tertiary" },
  failed: { label: "FAILED", dot: "bg-error", chip: "bg-error-container/30 text-error", text: "text-error" },
};

export function elapsed(r: Run): string {
  const s = Math.max(0, Math.floor((r.endedAt ?? Date.now() / 1000) - r.startedAt));
  return s >= 3600 ? `${Math.floor(s / 3600)}s ${Math.floor((s % 3600) / 60)}d` : `${String(Math.floor(s / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}d` : `${Math.floor(s / 3600)}sa`;
}
export const shortId = (r: Run) => r.title.match(/^[A-Z]+-\d+/)?.[0] ?? r.id.replace(/^\d{8}T\d{6}-/, "").slice(0, 14);
