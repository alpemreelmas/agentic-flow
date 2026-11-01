// Top bar + icon rail. The rail keeps the width for the list and detail panes.
import { invoke } from "@tauri-apps/api/core";
import { act, html, selectEl } from "./tpl.ts";
import { icon, mark, type IconName } from "./icons.ts";
import { loadQueue } from "./pages/queue.ts";
import { invoke as call } from "@tauri-apps/api/core";
import { schedule, sortedRuns, ui, type Page } from "./state.ts";
import { loadHealth } from "./health.ts";

/** Surfaces why the service is down: setup's silent autostart refuses when settings are incomplete. */
export async function tryStartOnce() {
  await refreshService();
  if (!ui.service.running) await serviceAction("start");
}

export async function refreshService() {
  try {
    ui.service = await invoke("service_status");
    if (ui.service.running) {
      ui.serviceBusy = false;
      ui.serviceError = "";
    }
  } catch (e) { console.error("service_status failed", e); /* keep the last known status */ }
  schedule();
}

async function serviceAction(kind: "start" | "stop" | "restart") {
  ui.serviceBusy = kind !== "stop";
  ui.serviceError = "";
  schedule();
  try {
    if (kind !== "start") await invoke("stop_service");
    if (kind === "restart") await new Promise((r) => setTimeout(r, 2500)); // let the old process release its lock
    if (kind !== "stop") await invoke("start_service");
  } catch (e) {
    ui.serviceBusy = false;
    ui.serviceError = String(e);
  }
  setTimeout(refreshService, 1500);
  if (kind !== "stop") setTimeout(explainSilentExit, 6000);
}

/** The process can spawn and die at once (bad PATH, missing binary): show the log's last line instead of just "Kapalı". */
async function explainSilentExit() {
  await refreshService();
  if (ui.service.running || ui.serviceError) return;
  ui.serviceBusy = false;
  try {
    const last = (await invoke<string>("service_log", { lines: 5 })).split("\n").filter(Boolean).pop();
    ui.serviceError = last ? `Servis kapandı: ${last}` : "Servis başlamadı. Ayarlar > Teşhis'ten log'a bakın.";
  } catch { ui.serviceError = "Servis başlamadı. Ayarlar > Teşhis'ten log'a bakın."; }
  schedule();
}
act("svc-start", () => serviceAction("start"));
act("svc-stop", () => serviceAction("stop"));
act("svc-restart", () => serviceAction("restart"));
act("nav", (el) => {
  ui.page = el.dataset.page as Page;
  if (ui.page === "queue") void loadQueue(); // fresh snapshot each time the page opens
  if (ui.page === "overview") void loadHealth();
  schedule();
});

function uptime(since: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - since));
  return s < 3600 ? `${Math.floor(s / 60)} dk` : `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
}

export function header(): HTMLElement {
  const s = ui.service;
  const live = ui.lastEventAt && Date.now() / 1000 - ui.lastEventAt < 30;
  const state = s.running ? "Çalışıyor" : ui.serviceBusy ? "Başlatılıyor…" : "Kapalı";
  const sw = selectEl("field field-sm !w-auto max-w-[200px] !bg-ground", [
    { value: "", label: "Tüm workspace'ler" },
    ...ui.workspaces.map((w) => ({ value: w.id, label: `${w.name}${w.enabled ? "" : " (kapalı)"}` })),
  ], ui.activeWorkspace, { id: "ws-switch", "aria-label": "Çalışma alanı" });
  sw.onchange = () => {
    ui.activeWorkspace = sw.value;
    ui.following = true;
    void call("set_active_workspace", { id: sw.value }).catch(() => {});
    schedule();
  };
  return html`<header class="topbar">
    <div class="flex items-center gap-3 flex-none">
      <span class="text-body font-semibold text-ink whitespace-nowrap topbar-wide topbar-hide">Linear Looper</span>
      ${sw}
    </div>
    <div class="flex items-center gap-3 min-w-0">
      ${ui.serviceError && !s.running ? html`<button data-act="nav" data-page="settings" class="text-small text-negative truncate max-w-[360px]" title="${ui.serviceError}">${ui.serviceError}</button>` : ""}
      <span class="flex items-center gap-1.5 text-small text-soft whitespace-nowrap" title="${s.pid ? `Daemon PID ${s.pid}` : "Daemon çalışmıyor"}">
        <span class="dot ${s.running ? "text-positive" : ui.serviceBusy ? "text-warning live" : "text-muted"}"></span>${state}
        ${s.running ? html`<span class="num text-muted topbar-wide topbar-hide">${uptime(s.started_at)}</span>` : ""}
      </span>
      ${s.running && s.detail ? html`<span class="text-small text-muted truncate topbar-wide topbar-hide max-w-[220px]">${s.detail}</span>` : ""}
      <span class="flex items-center gap-1.5 text-small text-muted whitespace-nowrap topbar-hide" title="Olay akışı"><span class="dot ${live ? "text-accent live" : "text-control"}"></span>${live ? "Canlı" : "Boşta"}</span>
      ${s.running
        ? html`<span class="flex items-center gap-1.5"><button data-act="svc-stop" class="btn btn-sm">${icon("stop", 12)}Durdur</button><button data-act="svc-restart" class="btn btn-sm topbar-hide">${icon("restart", 12)}Yeniden başlat</button></span>`
        : html`<button data-act="svc-start" ${ui.serviceBusy ? "disabled" : ""} class="btn btn-sm btn-primary">${icon("play", 12)}Başlat</button>`}
    </div>
  </header>`;
}

export function sidebar(): HTMLElement {
  const waiting = sortedRuns().filter((r) => r.status === "needs_human").length;
  const item = (id: Page, ic: IconName, label: string, count = 0, short = label) => {
    const tip = count ? `${label} · ${count} insan bekliyor` : label;
    return html`<a data-act="nav" data-page="${id}" href="#" aria-label="${tip}" aria-current="${ui.page === id ? "page" : "false"}" data-tip="${tip}" class="rail-item ${ui.page === id ? "active" : ""}">
      ${icon(ic, 18)}<span class="rail-label">${short}</span>${count ? html`<span class="rail-count">${count}</span>` : ""}
    </a>`;
  };
  return html`<nav class="rail" aria-label="Ana menü">
    <div class="rail-mark" title="Linear Looper">${mark()}</div>
    <div class="rail-group">
      ${item("overview", "overview", "Genel Bakış", 0, "Genel")}
      ${item("runs", "runs", "Runs", waiting)}
      ${item("queue", "queue", "Kuyruk")}
      ${item("chat", "chat", "Sohbet")}
    </div>
    <div class="rail-gap"></div>
    <div class="rail-group">
      ${item("registry", "registry", "Registry")}
      ${item("settings", "settings", "Ayarlar")}
    </div>
  </nav>`;
}
