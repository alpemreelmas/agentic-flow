// Shared UI state. Pages read it and call schedule() after changing it.
import type { Run } from "./runModel.ts";

export type Page = "overview" | "runs" | "queue" | "chat" | "registry" | "settings";
export interface ServiceStatus { running: boolean; phase: string; detail: string; pid: number; started_at: number }

export interface Workspace { id: string; name: string; repo: string; project_id: string; project_name: string; enabled: boolean; skills?: string[] }
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
  workspaces: [] as Workspace[],
  activeWorkspace: "", // workspace id; "" = all
  serviceBusy: false,
  serviceError: "", // why the last start failed (e.g. settings incomplete)
  lastEventAt: 0,
  paths: { runs: "", registry: "" },
  version: "",
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

export const activeWs = () => ui.workspaces.find((w) => w.id === ui.activeWorkspace);
/** Runs of the selected workspace (all when none is selected). Runs from before workspaces existed have no name and show everywhere. */
export const inScope = (r: Run) => { const w = activeWs(); return !w || !r.workspace || r.workspace === w.name; };
export const sortedRuns = () => [...runs.values()].filter(inScope).sort((a, b) => b.startedAt - a.startedAt);
export const STAGES = ["Triage", "Geliştirme", "Doğrulama", "İnceleme", "Teslim"];

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
export function prUrl(r: Run): string | undefined {
  const d = r.items.find((i) => i.kind === "deliver" && i.ok && i.url);
  return d?.kind === "deliver" ? d.url : undefined;
}
/** Design status vocabulary on top of the three the model knows. */
export type Shown = "running" | "needs_human" | "review" | "failed";
export const shown = (r: Run): Shown => (r.status === "needs_human" && hasError(r) ? "failed" : r.status);
export const SHOWN_STYLE: Record<Shown, { label: string; pill: string; text: string }> = {
  running: { label: "Çalışıyor", pill: "pill-accent", text: "text-accent" },
  needs_human: { label: "İnsan bekliyor", pill: "pill-warning", text: "text-warning" },
  review: { label: "İncelemede", pill: "pill-neutral", text: "text-soft" },
  failed: { label: "Hata", pill: "pill-negative", text: "text-negative" },
};

export function elapsed(r: Run): string {
  const s = Math.max(0, Math.floor((r.endedAt ?? Date.now() / 1000) - r.startedAt));
  return s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk` : `${Math.floor(s / 60)} dk ${s % 60} sn`;
}
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.floor(s / 60)} dk` : s < 86400 ? `${Math.floor(s / 3600)} sa` : `${Math.floor(s / 86400)} gün`;
}
export const shortId = (r: Run) => r.title.match(/^[A-Z]+-\d+/)?.[0] ?? r.id.replace(/^\d{8}T\d{6}-/, "").slice(0, 14);
/** The title without the issue id the row already shows beside it. */
export const plainTitle = (r: Run) => r.title.replace(/^[A-Z]+-\d+\s*[:·-]?\s*/, "") || r.title;
