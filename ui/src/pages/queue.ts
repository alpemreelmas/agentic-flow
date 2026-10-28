// Queue screen: design/kuyruk_linear_senkronizasyonu. Live Linear issues (read-only) joined to local runs.
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "../tpl.ts";
import { SHOWN_STYLE, activeWs, ago, runs, schedule, shown, ui } from "../state.ts";
import type { Run } from "../runModel.ts";
import "./overview.ts"; // registers open-run

interface Issue { project_id: string; project_name: string; id: string; identifier: string; title: string; url: string; state: string; updated_at: string; labels: string[] }
interface Names { ready: string; progress: string; review: string; blocked: string }

let issues: Issue[] = [];
let names: Names = { ready: "Todo", progress: "In Progress", review: "In Review", blocked: "Backlog" };
let loading = false;
let error = "";
let syncedAt = 0;

export async function loadQueue() {
  if (loading) return;
  loading = true;
  schedule();
  try {
    names = await invoke<Names>("get_config");
    issues = JSON.parse(await invoke<string>("list_queue"));
    error = "";
    syncedAt = Date.now() / 1000;
  } catch (e) {
    error = String(e);
  }
  loading = false;
  schedule();
}
act("queue-refresh", () => loadQueue());
act("open-url", (el) => { if (el.dataset.url) void invoke("open_url", { url: el.dataset.url }); });

const runFor = (i: Issue): Run | undefined =>
  [...runs.values()].filter((r) => r.title.startsWith(i.identifier)).sort((a, b) => b.startedAt - a.startedAt)[0];

function card(i: Issue): HTMLElement {
  const run = runFor(i);
  const st = run ? SHOWN_STYLE[shown(run)] : null;
  const tags = i.labels.filter((l) => l !== "agent");
  return html`<div class="p-space-md rounded bg-surface-container-low hover:bg-surface-container transition-all shadow-sm flex items-center gap-3">
    <span class="font-code-sm text-code-sm text-secondary font-medium flex-shrink-0">${i.identifier}</span>${i.project_name && !activeWs() ? html`<span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-outline">${i.project_name}</span>` : ""}
    <span class="font-headline-sm text-headline-sm text-on-surface truncate flex-1">${i.title}</span>
    ${tags.map((t) => html`<span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant">${t}</span>`)}
    ${st ? html`<button data-act="open-run" data-id="${run!.id}" class="px-1.5 py-0.5 rounded font-label-sm text-label-sm ${st.chip}">RUN: ${st.label}</button>` : ""}
    <span class="font-code-sm text-code-sm text-outline flex-shrink-0">${i.updated_at ? ago(Date.parse(i.updated_at) / 1000) + " önce" : ""}</span>
    ${i.url ? html`<button data-act="open-url" data-url="${i.url}" class="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">open_in_new</span>Linear'da Aç</button>` : ""}
  </div>`;
}

function section(title: string, sub: string, icon: string, list: Issue[], empty: string): HTMLElement {
  const box = html`<section class="flex flex-col gap-space-sm">
    <div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px] text-secondary">${icon}</span><h2 class="font-headline-sm text-headline-sm text-on-surface">${title}</h2><span class="font-code-sm text-code-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">${list.length} Görev</span></div><span class="font-label-sm text-label-sm text-outline uppercase tracking-wider">${sub}</span></div>
    <div class="flex flex-col gap-space-sm"></div></section>`;
  const body = box.lastElementChild!;
  if (!list.length) body.append(html`<p class="text-outline font-body-sm text-body-sm">${empty}</p>`);
  list.forEach((i) => body.append(card(i)));
  return box;
}

export function queuePage(): HTMLElement {
  const w = activeWs();
  const scoped = issues.filter((i) => !w || !w.project_id || i.project_id === w.project_id);
  const by = (s: string) => scoped.filter((i) => i.state === s);
  const known = new Set([names.ready, names.progress, names.review, names.blocked]);
  const other = scoped.filter((i) => !known.has(i.state));
  const page = html`<div class="flex flex-col w-full">
    <div class="px-space-xl pt-space-lg pb-space-md bg-surface-container-lowest flex items-center justify-between gap-space-md">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">sync_alt</span><span class="font-headline-md text-headline-md text-on-surface tracking-tight">Kuyruk</span><span class="font-code-sm text-code-sm text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-high">${scoped.length} görev</span></div>
        <p class="font-body-sm text-body-sm text-outline">${syncedAt ? `Son senkronizasyon: ${ago(syncedAt)} önce` : "Henüz senkronize edilmedi"} · yalnızca okunur</p>
      </div>
      <button data-act="queue-refresh" ${loading ? "disabled" : ""} class="px-3 py-1.5 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-label-md text-label-md flex items-center gap-1.5 disabled:opacity-50"><span class="material-symbols-outlined text-[15px]">refresh</span>${loading ? "Senkronize ediliyor…" : "Şimdi Senkronize Et"}</button>
    </div>
    <div class="px-space-xl py-space-lg flex flex-col gap-space-xl" id="groups"></div></div>`;
  const g = page.querySelector("#groups")!;
  if (error) g.append(html`<div class="px-space-md py-2 rounded bg-error-container/30 text-error font-body-sm text-body-sm">${error}${error.includes("LINEAR_API_KEY") || error.includes("KeyError") ? " — Ayarlar'dan Linear anahtarını girin." : ""}</div>`);
  g.append(
    section(names.progress, "Aktif ajanlar", "autorenew", by(names.progress), "Çalışan görev yok."),
    section(names.ready, "Sıradaki görevler", "low_priority", by(names.ready), "Sırada görev yok."),
    section(names.review, "PR açıldı", "fact_check", by(names.review), "İncelemede görev yok."),
    section(names.blocked, "Park / insan bekliyor", "pause_circle", by(names.blocked), "Park edilmiş görev yok."),
  );
  if (other.length) g.append(section("Diğer", "Eşlenmemiş durumlar", "help", other, ""));
  return page;
}
