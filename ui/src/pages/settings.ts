// Settings screen: design/ayarlar_entegrasyon_d_ng_denetimleri, bound to config.json + the OS keychain.
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "../tpl.ts";
import { catalog, refreshSkills } from "../skills.ts";
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
const skillSections = new Set<string>();
const skillQueries = new Map<string, string>();

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
    message = "Linear anahtarı Keychain'e kaydedildi.";
  } catch (e) {
    message = `Anahtar kaydedilmedi: ${e}`;
  }
  schedule();
});

act("key-clear", async () => {
  try {
    await invoke("clear_linear_key");
    keySet = false;
    message = "Linear anahtarı Keychain'den silindi.";
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

const input = "w-full h-8 px-2 rounded bg-surface-container text-on-surface font-code-sm text-code-sm placeholder:text-outline focus:outline-none focus:bg-surface-container-high";
const label = "font-label-sm text-label-sm uppercase text-outline";

function text(id: keyof Config, title: string, hint = ""): HTMLElement {
  return html`<label class="flex flex-col gap-1"><span class="${label}">${title}</span><input id="cfg-${id}" class="${input}" value="${String(cfg![id])}"/>${hint ? html`<span class="font-body-sm text-body-sm text-outline">${hint}</span>` : ""}</label>`;
}
function select(id: keyof Config, title: string, options: [string, string][]): HTMLElement {
  return html`<label class="flex flex-col gap-1"><span class="${label}">${title}</span><select id="cfg-${id}" class="${input}">${options.map(([v, n]) => html`<option value="${v}" ${cfg![id] === v ? "selected" : ""}>${n}</option>`)}</select></label>`;
}
function block(title: string, icon: string, body: Node[]): HTMLElement {
  const b = html`<section class="rounded bg-surface-container-low shadow-sm overflow-hidden"><div class="px-space-md py-space-sm bg-surface-container flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[18px]">${icon}</span><h2 class="font-headline-sm text-headline-sm text-on-surface">${title}</h2></div><div class="p-space-md grid grid-cols-1 md:grid-cols-2 gap-space-md"></div></section>`;
  b.lastElementChild!.append(...body);
  return b;
}

export function settingsPage(): HTMLElement {
  const s = ui.service;
  const page = html`<div class="flex flex-col w-full">
    <div class="px-space-xl pt-space-lg pb-space-md bg-surface-container-lowest flex items-center justify-between gap-space-md">
      <div class="flex flex-col gap-1"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">tune</span><span class="font-headline-md text-headline-md text-on-surface tracking-tight">Ayarlar</span></div>
      <p class="font-body-sm text-body-sm text-outline">Entegrasyonlar ve döngü parametreleri. Servis ${s.running ? "çalışıyor; değişiklikler yeniden başlatınca geçerli olur" : "kapalı"}.</p></div>
      <div class="flex items-center gap-space-sm">
        <button data-act="cfg-check" class="px-3 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm flex items-center gap-1.5">${checking ? "Kontrol ediliyor…" : "Bağlantıyı Test Et (--check)"}</button>
        <button data-act="cfg-save" class="px-3.5 py-1 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-body-sm text-body-sm font-semibold flex items-center gap-1.5"><span class="material-symbols-outlined text-[15px]">save</span>Kaydet</button>
      </div>
    </div>
    <div class="px-space-xl py-space-lg flex flex-col gap-space-lg" id="blocks"></div></div>`;
  const blocks = page.querySelector("#blocks")!;
  if (message) blocks.append(html`<div class="px-space-md py-2 rounded font-body-sm text-body-sm ${message.includes("ilmedi") || message.includes("Hata") || message.includes("eksik") || message.includes("Silinemedi") ? "bg-error-container/30 text-error" : "bg-secondary/10 text-secondary"}">${message}</div>`);
  if (!cfg) {
    blocks.append(html`<p class="text-outline font-body-md text-body-md">Ayarlar yüklenemedi (uygulama dışında çalışıyor).</p>`);
    return page;
  }
  blocks.append(
    block("Linear", "all_inclusive", [
      html`<div class="flex flex-col gap-1 md:col-span-2"><span class="${label}">API anahtarı (macOS Keychain)</span>
        <div class="flex items-center gap-space-sm">
          <input id="cfg-key" type="password" autocomplete="off" placeholder="${keySet ? "•••••••• kayıtlı — değiştirmek için yenisini yazın" : "lin_api_…"}" value="${keyDraft}" class="${input}"/>
          <button data-act="key-save" class="px-3 h-8 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-body-sm text-body-sm">Kaydet</button>
          ${keySet ? html`<button data-act="key-clear" class="px-3 h-8 rounded bg-surface-container hover:bg-surface-container-high text-error font-body-sm text-body-sm">Sil</button>` : ""}
        </div>
        <span class="font-body-sm text-body-sm ${keySet ? "text-secondary" : "text-tertiary"}">${keySet ? "Anahtar Keychain'de kayıtlı; ekranda hiçbir zaman gösterilmez." : "Henüz anahtar yok. Linear > Settings > Security & access > API."}</span></div>`,
      text("label", "Filtre etiketi", "Yalnızca bu etiketi taşıyan görevler alınır."),
      text("ready", "Alınacak durum"), text("progress", "Çalışırken durum"), text("review", "Bitince durum"), text("blocked", "Vazgeçilince durum", "Alınan durumdan farklı olmalı."),
    ]),
    workspaceBlock(),
    block("GitHub", "terminal", [
      select("deliver", "PR modu", [["github", "gh ile PR aç (doğrulanmamışsa draft)"], ["none", "PR açma"]]),
    ]),
    block("Ajanlar ve Döngü", "shield", [
      select("agent", "Varsayılan ajan", [["", "Her rolün kendi CLI'ı"], ["claude", "Claude"], ["gemini", "Gemini"], ["codex", "Codex"]]),
      text("triage", "Triage rolü"), text("reviewers", "Reviewer rolleri", "Virgülle; 'none' kapatır."),
      text("max_attempts", "Maksimum deneme"), text("timeout", "Adım zaman aşımı (sn)"), text("interval", "Poll aralığı (sn)"),
    ]),
  );
  if (checkOutput) blocks.append(html`<pre class="rounded bg-surface-container-lowest p-space-md font-code-sm text-code-sm text-on-surface-variant whitespace-pre-wrap">${checkOutput}</pre>`);
  blocks.append(html`<p class="font-code-sm text-code-sm text-outline">Veri: ${ui.paths.runs} · ${ui.paths.registry}</p>`);
  return page;
}


function workspaceBlock(): HTMLElement {
  const b = html`<section class="rounded bg-surface-container-low shadow-sm overflow-hidden">
    <div class="px-space-md py-space-sm bg-surface-container flex items-center justify-between gap-2">
      <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[18px]">folder_special</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Workspace'ler</h2><span class="font-code-sm text-code-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">${cfg!.workspaces.length}</span></div>
      <div class="flex items-center gap-space-sm"><button data-act="projects-reload" class="px-2 py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">refresh</span>Projeleri yenile</button>
      <button data-act="ws-add" class="px-2 py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-label-sm text-label-sm flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">add</span>Workspace ekle</button></div>
    </div>
    <div class="p-space-md flex flex-col gap-space-md" id="ws-rows"></div></section>`;
  const rows = b.querySelector("#ws-rows")!;
  if (!keySet) rows.append(html`<p class="font-body-sm text-body-sm text-tertiary">Proje listesi için önce Linear anahtarını kaydedin.</p>`);
  if (projectsError) rows.append(html`<p class="font-body-sm text-body-sm text-error">${projectsError}</p>`);
  if (!cfg!.workspaces.length) rows.append(html`<p class="font-body-sm text-body-sm text-outline">Henüz workspace yok. "Workspace ekle" ile bir git klasörü seçin.</p>`);
  const many = cfg!.workspaces.length > 1;
  for (const w of cfg!.workspaces) {
    const known = projects.some((p) => p.id === w.project_id);
    const opts = html`<select class="${input}"></select>`;
    opts.append(new Option(many ? "— Proje seçin —" : "— Tüm projeler (tek workspace) —", ""));
    for (const p of projects) opts.append(new Option(p.name, p.id));
    if (w.project_id && !known) opts.append(new Option(`${w.project_name || w.project_id} (listede yok)`, w.project_id));
    (opts as HTMLSelectElement).value = w.project_id;
    (opts as HTMLSelectElement).onchange = () => {
      w.project_id = (opts as HTMLSelectElement).value;
      w.project_name = projects.find((p) => p.id === w.project_id)?.name ?? w.project_name;
    };
    const name = html`<input id="ws-name-${w.id}" class="${input}" placeholder="Ad" value="${w.name}"/>` as HTMLInputElement;
    name.oninput = () => { w.name = name.value; };
    const repo = html`<input id="ws-repo-${w.id}" class="${input}" placeholder="/mutlak/yol/git-klasoru" value="${w.repo}"/>` as HTMLInputElement;
    repo.oninput = () => { w.repo = repo.value; };
    const on = html`<input type="checkbox" ${w.enabled ? "checked" : ""} class="accent-[#5e6ad2]"/>` as HTMLInputElement;
    on.onchange = () => { w.enabled = on.checked; };
    const row = html`<div class="grid grid-cols-12 gap-space-sm items-end p-space-sm rounded bg-surface-container-lowest">
      <label class="col-span-3 flex flex-col gap-1"><span class="${label}">Ad</span></label>
      <label class="col-span-4 flex flex-col gap-1"><span class="${label}">Klasör</span></label>
      <label class="col-span-3 flex flex-col gap-1"><span class="${label}">Linear projesi</span></label>
      <div class="col-span-2 flex items-center justify-end gap-space-sm h-8">
        <label class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant" title="Kapalıyken bu projenin görevleri alınmaz"></label>
        <button data-act="ws-del" data-id="${w.id}" class="w-7 h-7 rounded bg-surface-container hover:bg-surface-container-high text-error flex items-center justify-center" title="Sil"><span class="material-symbols-outlined text-[15px]">delete</span></button>
      </div></div>`;
    const cols = row.querySelectorAll("label");
    cols[0].append(name);
    const pick = html`<button data-act="ws-pick" data-id="${w.id}" class="h-8 px-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-label-sm text-label-sm flex-shrink-0">Seç…</button>`;
    const repoWrap = html`<div class="flex gap-1"></div>`;
    repoWrap.append(repo, pick);
    cols[1].append(repoWrap);
    cols[2].append(opts);
    cols[3].append(on, document.createTextNode("Açık"));
    const skillBox = html`<details class="col-span-12 mt-2 border-t border-outline-variant/20 pt-2"><summary class="cursor-pointer text-sm text-on-surface-variant">Varsayılan skill’ler · ${(w.skills ?? []).length} seçili</summary><div class="mt-2 flex flex-col gap-2"></div></details>`;
    (skillBox as HTMLDetailsElement).open = skillSections.has(w.id);
    skillBox.ontoggle = () => { if ((skillBox as HTMLDetailsElement).open) skillSections.add(w.id); else skillSections.delete(w.id); };
    const list = skillBox.lastElementChild!;
    const available = catalog(w.repo || undefined);
    const reload = html`<button type="button" class="text-xs text-primary text-left">Skill kütüphanesini yenile</button>`;
    reload.onclick = () => { void refreshSkills(w.repo || undefined); };
    list.append(reload);
    if (available.loading) list.append(html`<p class="text-xs text-outline">Skill’ler yükleniyor…</p>`);
    if (available.error) list.append(html`<p class="text-xs text-error">${available.error} · Proje klasörünü önce kaydedin.</p>`);
    const choices = html`<div class="max-h-64 overflow-auto flex flex-col gap-1"></div>`;
    const search = html`<input id="ws-skills-${w.id}" aria-label="${w.name} skill ara" placeholder="Skill ara…" value="${skillQueries.get(w.id) ?? ""}" class="${input}"/>` as HTMLInputElement;
    search.oninput = () => { skillQueries.set(w.id, search.value); schedule(); };
    list.append(search);
    const query = (skillQueries.get(w.id) ?? "").toLowerCase();
    for (const skill of available.skills.filter(s => `${s.name} ${s.id} ${s.description}`.toLowerCase().includes(query))) {
      const selected = (w.skills ?? []).includes(skill.id);
      const choice = html`<label class="flex items-start gap-2 text-sm text-on-surface-variant p-1"><input type="checkbox" ${selected ? "checked" : ""} ${skill.error && !selected ? "disabled" : ""}/><span>${skill.name}<small class="block text-outline text-xs">${skill.id}${skill.scripts ? " · script içerir" : ""}${skill.error ? " · " + skill.error : ""}</small></span></label>`;
      choice.querySelector("input")!.onchange = (event) => {
        if (skill.error && (event.target as HTMLInputElement).checked) { (event.target as HTMLInputElement).checked = false; return; }
        w.skills = (event.target as HTMLInputElement).checked ? [...new Set([...(w.skills ?? []), skill.id])] : (w.skills ?? []).filter(id => id !== skill.id);
        skillBox.querySelector("summary")!.textContent = `Varsayılan skill’ler · ${w.skills.length} seçili`;
      };
      choices.append(choice);
    }
    for (const id of (w.skills ?? []).filter(id => !available.skills.some(s => s.id === id))) {
      const missing = html`<button type="button" class="text-xs text-tertiary text-left">${id} · bulunamadı / kaldır</button>`;
      missing.onclick = () => { w.skills = w.skills?.filter(s => s !== id); schedule(); };
      choices.append(missing);
    }
    list.append(choices, html`<p class="text-xs text-outline">Seçimler yeni sohbetlerde ve sonraki otomatik görevlerde uygulanır. Kaydet’e basın. Skill araç gereksinimleri agent’a bağlıdır; sohbet salt okunur kalır.</p>`);
    row.append(skillBox);
    rows.append(row);
  }
  return b;
}
