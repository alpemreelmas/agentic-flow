// Header + sidebar, from design/*/code.html (identical on every screen).
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "./tpl.ts";
import { loadQueue } from "./pages/queue.ts";
import { invoke as call } from "@tauri-apps/api/core";
import { runs, schedule, sortedRuns, ui, type Page } from "./state.ts";

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
  } catch { /* keep the last known status */ }
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
}
act("svc-start", () => serviceAction("start"));
act("svc-stop", () => serviceAction("stop"));
act("svc-restart", () => serviceAction("restart"));
act("nav", (el) => {
  ui.page = el.dataset.page as Page;
  if (ui.page === "queue") void loadQueue(); // fresh snapshot each time the page opens
  schedule();
});

function uptime(since: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - since));
  return s < 3600 ? `${Math.floor(s / 60)}d ${s % 60}s` : `${Math.floor(s / 3600)}s ${Math.floor((s % 3600) / 60)}d`;
}

export function header(): HTMLElement {
  const s = ui.service;
  const btn = "px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm transition-colors";
  const live = ui.lastEventAt && Date.now() / 1000 - ui.lastEventAt < 30;
  return html`<header class="fixed top-0 left-0 right-0 h-10 z-50 bg-surface-container-lowest/90 backdrop-blur-md flex items-center justify-between px-space-md border-b border-outline-variant/30">
    <div class="flex items-center gap-space-md">
      <div class="flex items-center gap-space-sm">
        <div class="flex items-center gap-1.5 px-space-xs py-0.5 rounded bg-surface-container-high">
          <span class="w-1.5 h-1.5 rounded-full ${s.running ? "bg-secondary animate-pulse" : "bg-outline"}"></span>
          <span class="font-label-sm text-label-sm uppercase ${s.running ? "text-secondary" : "text-outline"}">${s.running ? "Çalışıyor" : ui.serviceBusy ? "Başlatılıyor…" : "Kapalı"}</span>
        </div>
        ${s.running ? html`<span class="font-code-sm text-code-sm text-on-surface-variant">uptime: ${uptime(s.started_at)}</span>` : ""}
        ${s.running && s.detail ? html`<span class="text-outline-variant">•</span>` : ""}
        ${s.running && s.detail ? html`<span class="font-code-sm text-code-sm text-on-surface-variant">${s.detail}</span>` : ""}
      </div>
      ${ui.serviceError && !s.running ? html`<span data-act="nav" data-page="settings" class="cursor-pointer font-code-sm text-code-sm text-error truncate max-w-[420px]" title="${ui.serviceError}">${ui.serviceError}</span>` : ""}
      <div class="flex items-center gap-1 ml-space-xs">
        ${s.running
          ? html`<span class="contents"><button data-act="svc-stop" class="${btn}">Durdur</button><button data-act="svc-restart" class="${btn}">Yeniden Başlat</button></span>`
          : html`<button data-act="svc-start" ${ui.serviceBusy ? "disabled" : ""} class="px-2 py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-label-sm text-label-sm transition-colors flex items-center gap-1 disabled:opacity-50"><span class="material-symbols-outlined text-[12px]">play_arrow</span>Başlat</button>`}
      </div>
    </div>
    <div class="flex items-center gap-space-md">
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full ${live ? "bg-secondary-container" : "bg-outline-variant"}" title="Olay akışı"></span>
        <span class="font-code-sm text-code-sm text-on-surface-variant">${live ? "Canlı" : "Boşta"}</span>
      </div>
    </div>
  </header>`;
}

export function sidebar(): HTMLElement {
  const el = sidebarEl();
  const sel = el.querySelector<HTMLSelectElement>("#ws-switch")!;
  sel.onchange = () => {
    ui.activeWorkspace = sel.value;
    ui.following = true;
    void call("set_active_workspace", { id: sel.value }).catch(() => {});
    schedule();
  };
  return el;
}

function sidebarEl(): HTMLElement {
  const active = sortedRuns().filter((r) => r.status === "running").length;
  const item = (id: Page, icon: string, label: string, badge = "") => html`<a data-act="nav" data-page="${id}" href="#"
      class="flex items-center justify-between px-space-sm py-1.5 rounded transition-colors ${ui.page === id
        ? "bg-surface-container-high text-on-surface font-semibold border-l-2 border-primary"
        : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}">
      <div class="flex items-center gap-2.5"><span class="material-symbols-outlined text-[16px]">${icon}</span><span class="font-body-sm text-body-sm">${label}</span></div>
      ${badge ? html`<span class="font-label-sm text-label-sm px-1.5 rounded bg-surface-container-highest ${id === "runs" ? "text-secondary" : "text-on-surface-variant"}">${badge}</span>` : ""}
    </a>`;
  return html`<aside class="fixed left-0 top-10 bottom-0 w-64 bg-surface-container-lowest z-40 flex flex-col justify-between border-r border-outline-variant/30">
    <div class="flex flex-col">
      <div class="h-12 px-space-md flex items-center justify-between border-b border-outline-variant/20">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[18px]">all_inclusive</span><span class="font-headline-sm text-headline-sm text-on-surface tracking-tight">Linear Looper</span></div>
        <span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">DESKTOP</span>
      </div>
      <div class="px-space-md pt-space-md pb-space-xs"><span class="font-label-sm text-label-sm uppercase text-outline tracking-wider">Çalışma Alanı</span></div>
      <div class="px-space-sm pb-space-sm"><select id="ws-switch" class="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-body-sm text-body-sm focus:outline-none cursor-pointer">
        <option value="">Tüm workspace'ler</option>
        ${ui.workspaces.map((w) => html`<option value="${w.id}" ${w.id === ui.activeWorkspace ? "selected" : ""}>${w.name}${w.enabled ? "" : " (kapalı)"}</option>`)}
      </select></div>
      <nav class="flex flex-col gap-0.5 px-space-sm">
        ${item("overview", "grid_view", "Genel Bakış")}
        ${item("runs", "play_circle", "Runs", active ? `${active} Aktif` : "")}
        ${item("queue", "queue", "Kuyruk")}
        ${item("chat", "forum", "Sohbet")}
        ${item("registry", "extension", "Registry")}
        ${item("settings", "tune", "Ayarlar")}
      </nav>
    </div>
    <div class="p-space-sm border-t border-outline-variant/30 bg-surface-container-lowest">
      <div class="px-space-sm py-space-xs rounded bg-surface-container/60 flex flex-col gap-1 border border-outline-variant/20">
        <div class="flex items-center justify-between"><span class="font-label-sm text-label-sm text-outline uppercase">Daemon PID</span><span class="font-code-sm text-code-sm text-on-surface font-medium">${ui.service.pid || "—"}</span></div>
        <div class="flex items-center justify-between"><span class="font-label-sm text-label-sm text-outline uppercase">JSONL Stream</span><span class="flex items-center gap-1 font-code-sm text-code-sm text-secondary"><span class="w-1 h-1 rounded-full bg-secondary"></span>${sortedRuns().length} run</span></div>
        <div class="flex items-center justify-between pt-0.5 border-t border-outline-variant/20"><span class="font-label-sm text-label-sm text-outline uppercase">Sürüm</span><span class="font-code-sm text-code-sm text-on-surface-variant">v0.1.0 (Tauri 2)</span></div>
      </div>
    </div>
  </aside>`;
}
