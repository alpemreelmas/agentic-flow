// Queue screen. Live Linear issues (read-only) joined to local runs.
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "../tpl.ts";
import { icon } from "../icons.ts";
import { SHOWN_STYLE, activeWs, ago, runs, schedule, shown } from "../state.ts";
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
  const sub = [!activeWs() ? i.project_name : "", ...tags].filter(Boolean).join(" · ");
  return html`<div class="q-row">
    <span class="id-cell num text-body text-soft truncate">${i.identifier}</span>
    <div class="title-cell min-w-0"><div class="text-body text-ink line-clamp-2" title="${i.title}">${i.title}</div>${sub ? html`<div class="text-small text-muted truncate">${sub}</div>` : ""}</div>
    <div class="run-cell">${st ? html`<button data-act="open-run" data-id="${run!.id}" class="pill ${st.pill}" title="Run'ı aç">${st.label}</button>` : html`<span class="text-small text-muted">Run yok</span>`}</div>
    <span class="age-cell num text-small text-muted text-right whitespace-nowrap">${i.updated_at ? ago(Date.parse(i.updated_at) / 1000) : "—"}</span>
    <div class="act-cell flex justify-end">${i.url ? html`<button data-act="open-url" data-url="${i.url}" class="btn btn-icon" title="Linear'da aç" aria-label="${i.identifier} görevini Linear'da aç">${icon("external", 14)}</button>` : ""}</div>
  </div>`;
}

function section(title: string, sub: string, list: Issue[], empty: string): HTMLElement {
  const box = html`<section class="panel">
    <div class="panel-head"><div class="flex items-baseline gap-2 min-w-0"><h2 class="text-card text-ink truncate">${title}</h2><span class="num text-small text-muted">${list.length}</span></div><span class="text-small text-muted truncate">${sub}</span></div>
    <div></div></section>`;
  const body = box.lastElementChild!;
  if (!list.length && empty) body.append(html`<p class="empty">${empty}</p>`);
  list.forEach((i) => body.append(card(i)));
  return box;
}

export function queuePage(): HTMLElement {
  const w = activeWs();
  const scoped = issues.filter((i) => !w || !w.project_id || i.project_id === w.project_id);
  const by = (s: string) => scoped.filter((i) => i.state === s);
  const known = new Set([names.ready, names.progress, names.review, names.blocked]);
  const other = scoped.filter((i) => !known.has(i.state));
  const page = html`<div class="canvas">
    <div class="title-row">
      <div class="min-w-0"><h1 class="text-title text-ink">Kuyruk</h1>
        <p class="text-body text-soft mt-1">${syncedAt ? html`<span><span class="num">${scoped.length}</span> görev, sırada <span class="num">${by(names.ready).length}</span>. <span class="text-muted">Son senkronizasyon ${ago(syncedAt)} önce, yalnızca okunur.</span></span>` : html`<span class="text-muted">Henüz senkronize edilmedi, yalnızca okunur.</span>`}</p>
      </div>
      <button data-act="queue-refresh" ${loading ? "disabled" : ""} class="btn btn-primary">${icon("refresh", 14)}${loading ? "Senkronize ediliyor…" : "Şimdi senkronize et"}</button>
    </div>
    <div class="flex flex-col gap-[var(--gap)]" id="groups"></div></div>`;
  const g = page.querySelector("#groups")!;
  if (error) {
    g.append(html`<div class="panel flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <span class="flex items-center gap-2 text-body text-soft min-w-0">${icon("warn", 14, "text-negative")}<span class="min-w-0">Kuyruk alınamadı: ${error}${error.includes("LINEAR_API_KEY") || error.includes("KeyError") ? " Ayarlar'dan Linear anahtarını girin." : ""}${syncedAt ? ` Son geçerli veri ${ago(syncedAt)} önce.` : ""}</span></span>
      <button data-act="queue-refresh" class="link">Yeniden dene</button>
    </div>`);
  }
  // Never synced: the counts are unknown, so don't print "no tasks" under an error or during the first load.
  if (!syncedAt) {
    if (!error) g.append(html`<p class="empty !m-0">${loading ? "Linear'dan görevler alınıyor…" : "Görevleri görmek için senkronize edin."}</p>`);
    return page;
  }
  // Agents' work on the left, what came back to people on the right.
  const lanes = html`<div class="grid grid-cols-1 xl:grid-cols-2 gap-[var(--gap)] items-start"><div class="flex flex-col gap-[var(--gap)] min-w-0"></div><div class="flex flex-col gap-[var(--gap)] min-w-0"></div></div>`;
  lanes.children[0].append(
    section(names.progress, "Aktif ajanlar", by(names.progress), "Çalışan görev yok."),
    section(names.ready, "Sıradaki görevler", by(names.ready), "Sırada görev yok."));
  lanes.children[1].append(
    section(names.review, "PR açıldı", by(names.review), "İncelemede görev yok."),
    section(names.blocked, "Park edildi, insan bekliyor", by(names.blocked), "Park edilmiş görev yok."));
  if (other.length) lanes.children[1].append(section("Diğer", "Eşlenmemiş durumlar", other, ""));
  g.append(lanes);
  return page;
}
