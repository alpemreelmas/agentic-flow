// Settings screen, bound to config.json + the OS keychain.
import { invoke } from "@tauri-apps/api/core";
import { act, html, selectEl } from "../tpl.ts";
import { icon } from "../icons.ts";
import { schedule, ui, type Workspace } from "../state.ts";

interface Config {
  workspaces: Workspace[]; active_workspace: string; label: string; ready: string; progress: string; review: string; blocked: string;
  deliver: string; reviewers: string; triage: string; agent: string;
  max_attempts: number; timeout: number; interval: number;
}

let cfg: Config | null = null;
let keySet = false;
let message = "";
let checkOutput = "";
let checking = false;

export async function loadSettings() {
  try {
    cfg = await invoke<Config>("get_config");
    ui.workspaces = cfg.workspaces;
    ui.activeWorkspace = cfg.workspaces.some((w) => w.id === cfg!.active_workspace) ? cfg.active_workspace : "";
    keySet = await invoke<boolean>("key_status");
    void loadProjects();
  } catch { /* browser preview: keep defaults */ }
  schedule();
}

interface Project { id: string; name: string; state: string }
let projects: Project[] = [];
let projectsError = "";

async function loadProjects() {
  if (!keySet) return;
  try {
    projects = JSON.parse(await invoke<string>("list_projects"));
    projectsError = "";
  } catch (e) {
    projectsError = String(e);
  }
  schedule();
}

const newId = () => `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
act("ws-add", () => {
  cfg!.workspaces.push({ id: newId(), name: "", repo: "", project_id: "", project_name: "", enabled: true });
  schedule();
});
act("ws-del", (el) => {
  cfg!.workspaces = cfg!.workspaces.filter((w) => w.id !== el.dataset.id);
  ui.workspaces = cfg!.workspaces;
  if (ui.activeWorkspace === el.dataset.id) ui.activeWorkspace = "";
  schedule();
});
act("ws-pick", async (el) => {
  const dir = await invoke<string | null>("pick_folder");
  const w = cfg!.workspaces.find((x) => x.id === el.dataset.id);
  if (dir && w) {
    w.repo = dir;
    if (!w.name) w.name = dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
    schedule();
  }
});
act("projects-reload", () => loadProjects());

// The page is re-rendered on every service/run event; keep what the user typed so far in the model.
let keyDraft = "";
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (!cfg || !t.id?.startsWith("cfg-")) return;
  const k = t.id.slice(4);
  if (k === "key") keyDraft = t.value;
  else if (k in cfg) (cfg as unknown as Record<string, string | number>)[k] = typeof (cfg as unknown as Record<string, unknown>)[k] === "number" ? Number(t.value) : t.value;
});

const field = (id: string) => document.getElementById(`cfg-${id}`) as HTMLInputElement | HTMLSelectElement | null;
const val = (id: string) => field(id)?.value ?? "";

function readForm(): Config {
  return {
    workspaces: cfg!.workspaces.map((w) => ({ ...w, name: w.name.trim() })), active_workspace: ui.activeWorkspace, label: val("label").trim(), ready: val("ready").trim(), progress: val("progress").trim(),
    review: val("review").trim(), blocked: val("blocked").trim(), deliver: val("deliver"), reviewers: val("reviewers").trim(),
    triage: val("triage").trim(), agent: val("agent"),
    max_attempts: Number(val("max_attempts")), timeout: Number(val("timeout")), interval: Number(val("interval")),
  };
}

act("cfg-save", async () => {
  const next = readForm();
  try {
    await invoke("set_config", { config: next });
    cfg = next;
    ui.workspaces = next.workspaces;
    message = "Kaydedildi. Değişiklik servisin bir sonraki başlatılışında geçerli olur.";
  } catch (e) {
    message = `Kaydedilmedi: ${e}`;
  }
  schedule();
});

act("key-save", async () => {
  const input = field("key") as HTMLInputElement;
  try {
    await invoke("set_linear_key", { key: input.value });
    input.value = "";
    keyDraft = "";
    keySet = true;
    void loadProjects();
    message = "Linear anahtarı sistem anahtar zincirine kaydedildi.";
  } catch (e) {
    message = `Anahtar kaydedilmedi: ${e}`;
  }
  schedule();
});

act("key-clear", async () => {
  try {
    await invoke("clear_linear_key");
    keySet = false;
    message = "Linear anahtarı sistem anahtar zincirinden silindi.";
  } catch (e) {
    message = `Silinemedi: ${e}`;
  }
  schedule();
});

act("cfg-check", async () => {
  checking = true;
  checkOutput = "";
  schedule();
  try {
    checkOutput = await invoke<string>("check_connection");
  } catch (e) {
    checkOutput = `Hata: ${e}`;
  }
  checking = false;
  schedule();
});

const input = "field field-mono";

function text(id: keyof Config, title: string, hint = "", cls = ""): HTMLElement {
  return html`<label class="flex flex-col gap-1.5 min-w-0 ${cls}"><span class="label">${title}</span><input id="cfg-${id}" class="${input}" value="${String(cfg![id])}"/>${hint ? html`<span class="hint">${hint}</span>` : ""}</label>`;
}
function select(id: keyof Config, title: string, options: [string, string][], cls = ""): HTMLElement {
  const box = html`<label class="flex flex-col gap-1.5 min-w-0 ${cls}"><span class="label">${title}</span></label>`;
  box.append(selectEl("field", options.map(([value, label]) => ({ value, label })), String(cfg![id]), { id: `cfg-${id}` }));
  return box;
}
function block(title: string, about: string, body: Node[], result = ""): HTMLElement {
  const b = html`<section class="settings-row"><div class="min-w-0"><h2 class="text-card text-ink">${title}</h2><p class="text-body text-muted mt-1">${about}</p>${result ? html`<p class="text-body text-soft mt-3">${result}</p>` : ""}</div><div class="panel settings-grid"></div></section>`;
  b.lastElementChild!.append(...body);
  return b;
}

export function settingsPage(): HTMLElement {
  const s = ui.service;
  const page = html`<div class="canvas !gap-0">
    <div class="title-row pb-6">
      <div class="min-w-0"><h1 class="text-title text-ink">Ayarlar</h1>
      <p class="text-body text-soft mt-1">Servis ${s.running ? "çalışıyor. Değişiklikler yeniden başlatınca geçerli olur." : "kapalı. Değişiklikler bir sonraki başlatmada geçerli olur."}</p></div>
      <div class="flex items-center gap-2">
        <button data-act="cfg-check" ${checking ? "disabled" : ""} class="btn">${checking ? "Kontrol ediliyor…" : "Bağlantıyı test et"}</button>
        <button data-act="cfg-save" class="btn btn-primary">Kaydet</button>
      </div>
    </div>
    <div id="blocks"></div></div>`;
  const blocks = page.querySelector("#blocks")!;
  const bad = message.includes("ilmedi") || message.includes("Hata") || message.includes("eksik") || message.includes("Silinemedi");
  if (message) blocks.append(html`<div class="flex items-center gap-2 pb-4 text-body ${bad ? "text-negative" : "text-soft"}" role="status">${icon(bad ? "warn" : "check", 14, bad ? "" : "text-positive")}${message}</div>`);
  if (checkOutput) blocks.append(html`<div class="panel mb-6 overflow-hidden"><div class="panel-head"><h2 class="text-card text-ink">Bağlantı testi</h2></div><pre class="code text-soft !max-h-64">${checkOutput}</pre></div>`);
  if (!cfg) {
    blocks.append(html`<p class="empty !mx-0">Ayarlar yüklenemedi (uygulama dışında çalışıyor).</p>`);
    return page;
  }
  blocks.append(
    block("Linear", "Görevlerin geldiği yer ve döngünün kullandığı durum adları.", [
      html`<div class="flex flex-col gap-1.5 span-2 min-w-0"><label class="label" for="cfg-key">API anahtarı</label>
        <div class="flex items-center gap-2">
          <input id="cfg-key" type="password" autocomplete="off" placeholder="${keySet ? "Kayıtlı. Değiştirmek için yenisini yazın" : "lin_api_…"}" value="${keyDraft}" class="${input}"/>
          <button data-act="key-save" class="btn !h-[34px]">Anahtarı kaydet</button>
          ${keySet ? html`<button data-act="key-clear" class="btn btn-danger !h-[34px]">Sil</button>` : ""}
        </div>
        <span class="hint flex items-center gap-1.5">${keySet ? html`<span class="dot text-positive"></span>` : html`<span class="dot text-warning"></span>`}${keySet ? "Anahtar sistem anahtar zincirinde kayıtlı ve hemen geçerli; ekranda hiçbir zaman gösterilmez." : "Henüz anahtar yok. Linear > Settings > Security & access > API."}</span></div>`,
      text("label", "Filtre etiketi", "Yalnızca bu etiketi taşıyan görevler alınır.", "span-2"),
      text("ready", "Alınacak durum"), text("progress", "Çalışırken durum"), text("review", "Bitince durum"), text("blocked", "Vazgeçilince durum", "Alınan durumdan farklı olmalı."),
    ], `"${cfg.label}" etiketli görev ${cfg.ready} durumundan alınır, ${cfg.progress} ile çalışılır, ${cfg.review} ile biter. Vazgeçilirse ${cfg.blocked} olur.`),
    workspaceBlock(),
    block("GitHub", "İş bitince sonucun nasıl teslim edileceği.", [
      select("deliver", "PR modu", [["github", "gh ile PR aç (doğrulanmamışsa draft)"], ["none", "PR açma"]], "span-2"),
    ]),
    block("Ajanlar ve döngü", "Kimin çalışacağı, kaç kez deneyeceği ve ne sıklıkla kuyruğa bakılacağı.", [
      select("agent", "Varsayılan ajan", [["", "Her rolün kendi CLI'ı"], ["claude", "Claude"], ["gemini", "Gemini"], ["codex", "Codex"]]),
      text("triage", "Triage rolü"), text("reviewers", "Reviewer rolleri", "Virgülle ayırın; 'none' kapatır."),
      text("max_attempts", "Maksimum deneme"), text("timeout", "Adım zaman aşımı (sn)"), text("interval", "Poll aralığı (sn)"),
    ], `Görev başına en fazla ${cfg.max_attempts} deneme, adım başına ${Math.round(cfg.timeout / 60)} dk. Kuyruğa ${Math.round(cfg.interval / 60)} dk'da bir bakılır.`),
  );
  blocks.append(html`<p class="num text-small text-muted pt-6 border-t border-border break-all">Linear Looper v0.1.0 · ${ui.paths.runs} · ${ui.paths.registry}</p>`);
  return page;
}


function workspaceBlock(): HTMLElement {
  const b = html`<section class="settings-row">
    <div class="min-w-0"><h2 class="text-card text-ink">Workspace'ler</h2><p class="text-body text-muted mt-1">Her Linear projesini bir git klasörüne bağlar. Kapalı olanın görevleri alınmaz.</p>
      <div class="flex flex-wrap gap-2 mt-3">
        <button data-act="ws-add" class="btn btn-sm">${icon("add", 12)}Workspace ekle</button>
        <button data-act="projects-reload" class="btn btn-sm">${icon("refresh", 12)}Projeleri yenile</button>
      </div>
    </div>
    <div class="panel" id="ws-rows"></div></section>`;
  const rows = b.querySelector("#ws-rows")!;
  const note = (t: string, cls: string) => html`<p class="px-5 py-3 text-body ${cls} border-b border-rule">${t}</p>`;
  if (!keySet) rows.append(note("Proje listesi için önce Linear anahtarını kaydedin.", "text-warning"));
  if (projectsError) rows.append(note(projectsError, "text-negative"));
  if (!cfg!.workspaces.length) rows.append(html`<p class="empty">Henüz workspace yok. "Workspace ekle" ile bir git klasörü seçin.</p>`);
  const many = cfg!.workspaces.length > 1;
  for (const w of cfg!.workspaces) {
    const known = projects.some((p) => p.id === w.project_id);
    const opts = html`<select class="field" aria-label="Linear projesi"></select>` as HTMLSelectElement;
    opts.append(new Option(many ? "Proje seçin" : "Tüm projeler (tek workspace)", ""));
    for (const p of projects) opts.append(new Option(p.name, p.id));
    if (w.project_id && !known) opts.append(new Option(`${w.project_name || w.project_id} (listede yok)`, w.project_id));
    opts.value = w.project_id;
    opts.onchange = () => {
      w.project_id = opts.value;
      w.project_name = projects.find((p) => p.id === w.project_id)?.name ?? w.project_name;
    };
    const name = html`<input id="ws-name-${w.id}" class="field" placeholder="Ad" value="${w.name}"/>` as HTMLInputElement;
    name.oninput = () => { w.name = name.value; };
    const repo = html`<input id="ws-repo-${w.id}" class="${input}" placeholder="/mutlak/yol/git-klasoru" value="${w.repo}"/>` as HTMLInputElement;
    repo.oninput = () => { w.repo = repo.value; };
    const on = html`<input type="checkbox" class="switch" aria-label="Workspace açık" ${w.enabled ? "checked" : ""}/>` as HTMLInputElement;
    on.onchange = () => { w.enabled = on.checked; };
    const row = html`<div class="ws-row">
      <label class="flex flex-col gap-1.5 min-w-0"><span class="label">Ad</span></label>
      <label class="flex flex-col gap-1.5 min-w-0"><span class="label">Klasör</span></label>
      <label class="flex flex-col gap-1.5 min-w-0"><span class="label">Linear projesi</span></label>
      <div class="flex items-center justify-end gap-2.5 h-[34px]">
        <label class="flex items-center gap-1.5 text-small text-soft cursor-pointer" title="Kapalıyken bu projenin görevleri alınmaz"></label>
        <button data-act="ws-del" data-id="${w.id}" class="btn btn-icon hover:!text-negative" title="Sil" aria-label="Workspace'i sil">${icon("trash", 14)}</button>
      </div></div>`;
    const cols = row.querySelectorAll("label");
    cols[0].append(name);
    const pick = html`<button data-act="ws-pick" data-id="${w.id}" class="btn !h-[34px] !px-2.5" title="Klasör seç" aria-label="Klasör seç">${icon("folder", 14)}</button>`;
    const repoWrap = html`<div class="flex gap-1.5"></div>`;
    repoWrap.append(repo, pick);
    cols[1].append(repoWrap);
    cols[2].append(opts);
    cols[3].append(on, document.createTextNode("Açık"));
    rows.append(row);
  }
  return b;
}
