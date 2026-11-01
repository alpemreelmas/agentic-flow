// Setup health: first-run checklist (key, workspace, service, tools) and diagnostics for bug reports.
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "./tpl.ts";
import { schedule, ui } from "./state.ts";

interface Item { name: string; ok: boolean; detail: string; hint: string; optional?: boolean }
interface Doctor { ok: boolean; items: Item[] }

export const health = {
  keySet: false,
  doctor: null as Doctor | null,
  loading: false,
  error: "",
  note: "", // result of the last diagnostics action
  log: "",
};

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function loadHealth() {
  if (!inTauri() || health.loading) return;
  health.loading = true;
  health.error = "";
  schedule();
  try {
    health.keySet = await invoke<boolean>("key_status");
    health.doctor = JSON.parse(await invoke<string>("doctor"));
  } catch (e) {
    health.error = String(e);
  }
  health.loading = false;
  schedule();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

act("doctor-run", () => void loadHealth());
act("diag-copy", async () => {
  try {
    const text = await invoke<string>("diagnostics");
    health.note = (await copyText(text)) ? "Teşhis panoya kopyalandı. Hata bildirirken yapıştırın." : "Pano kullanılamadı; log'u gösterip elle kopyalayın.";
    if (health.note.startsWith("Pano kullanılamadı")) health.log = text;
  } catch (e) {
    health.note = `Teşhis alınamadı: ${e}`;
  }
  schedule();
});
act("data-open", () => void invoke("open_data_dir").catch((e) => { health.note = `Klasör açılamadı: ${e}`; schedule(); }));
act("log-show", async () => {
  health.log = health.log ? "" : (await invoke<string>("service_log", { lines: 200 }).catch((e) => `Okunamadı: ${e}`)) || "Log henüz boş.";
  schedule();
});

const dot = (ok: boolean, optional = false) => `dot ${ok ? "text-positive" : optional ? "text-muted" : "text-warning"}`;

export function row(ok: boolean, title: string, detail: string, action?: HTMLElement | string): HTMLElement {
  return html`<div class="flex items-center gap-3 px-5 py-2.5 border-t border-rule">
    <span class="${dot(ok)}"></span>
    <div class="min-w-0 flex-1"><div class="text-body text-ink">${title}</div><div class="text-small text-muted break-words">${detail}</div></div>
    ${action ?? ""}
  </div>`;
}

const toSettings = () => html`<button data-act="nav" data-page="settings" class="btn btn-sm">Ayarlar</button>`;

/** True once everything the loop needs is in place. */
export function setupComplete(): boolean {
  return !!health.doctor?.ok && health.keySet && ui.workspaces.length > 0;
}

/** First-run checklist; null when there is nothing left to fix (or outside the app). */
export function setupPanel(): HTMLElement | null {
  if (!inTauri() || (health.doctor && setupComplete() && !health.error)) return null;
  const panel = html`<section class="panel" aria-labelledby="setup-title">
    <div class="panel-head"><h2 id="setup-title" class="text-card text-ink">Kurulum kontrolü</h2>
      <button data-act="doctor-run" class="btn btn-sm" ${health.loading ? "disabled" : ""}>${health.loading ? "Kontrol ediliyor…" : "Yeniden kontrol et"}</button></div>
  </section>`;
  panel.append(
    row(health.keySet, "Linear API anahtarı", health.keySet ? "Kayıtlı" : "Ayarlar'dan Linear anahtarınızı girin.", health.keySet ? "" : toSettings()),
    row(ui.workspaces.length > 0, "Workspace", ui.workspaces.length ? `${ui.workspaces.length} workspace tanımlı` : "Bir Linear projesini git klasörüne bağlayın.", ui.workspaces.length ? "" : toSettings()),
    row(ui.service.running, "Servis", ui.service.running ? "Çalışıyor" : ui.serviceError || "Çalışmıyor. Yukarıdan Başlat'a basın."),
  );
  if (health.error) panel.append(row(false, "Araç kontrolü çalışmadı", health.error));
  for (const i of health.doctor?.items ?? []) {
    panel.append(row(i.ok || !!i.optional, i.name, i.ok ? i.detail : [i.detail, i.hint].filter(Boolean).join(" · ")));
  }
  return panel;
}

/** Settings section: tool check, diagnostics for bug reports, log. */
export function diagnosticsPanel(): HTMLElement {
  const panel = html`<section class="panel mb-6 overflow-hidden" aria-labelledby="diag-title">
    <div class="panel-head"><h2 id="diag-title" class="text-card text-ink">Teşhis</h2></div>
    <div class="flex flex-wrap items-center gap-2 px-5 py-3">
      <button data-act="diag-copy" class="btn btn-sm">Teşhisi kopyala</button>
      <button data-act="log-show" class="btn btn-sm">${health.log ? "Log'u gizle" : "Log'u göster"}</button>
      <button data-act="data-open" class="btn btn-sm">Veri klasörünü aç</button>
      <button data-act="doctor-run" class="btn btn-sm">Araçları kontrol et</button>
    </div>
    ${health.note ? html`<p class="text-small text-soft px-5 pb-3" role="status">${health.note}</p>` : ""}
  </section>`;
  if (health.log) panel.append(html`<pre class="code text-soft !max-h-64">${health.log}</pre>`);
  return panel;
}

/** Last resort when startup itself fails: plain DOM, no dependency on the renderer. */
export function showFatal(error: unknown) {
  console.error(error);
  const root = document.getElementById("root") ?? document.body;
  const box = document.createElement("div");
  box.className = "canvas";
  box.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.className = "text-title text-ink";
  title.textContent = "Uygulama başlatılamadı";
  const msg = document.createElement("pre");
  msg.className = "code text-soft";
  msg.textContent = String(error instanceof Error ? error.message : error);
  const copy = document.createElement("button");
  copy.className = "btn";
  copy.textContent = "Teşhisi kopyala";
  copy.onclick = async () => {
    let text = `Başlatma hatası: ${msg.textContent}`;
    try { text = `${text}\n\n${await invoke<string>("diagnostics")}`; } catch { /* backend unavailable */ }
    copy.textContent = (await copyText(text)) ? "Kopyalandı" : "Pano kullanılamadı";
  };
  box.append(title, msg, copy);
  root.replaceChildren(box);
}
