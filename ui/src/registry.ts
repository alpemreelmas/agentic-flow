// Registry tab: edit roles and skills (the markdown files the Python loop reads at run time).
import { invoke } from "@tauri-apps/api/core";
import { catalog, refreshSkills, type Skill } from "./skills.ts";
import { activeWs, ui } from "./state.ts";
import { act, html } from "./tpl.ts";
import { icon } from "./icons.ts";

type Kind = "role" | "skill";
interface Entry { kind: Kind; name: string }

const TEMPLATES: Record<Kind, (name: string) => string> = {
  role: (n) => `---\nname: ${n}\ndescription: \ncli: claude\npermissions: ask\nskills: []\n---\nDescribe how this role behaves.\n`,
  skill: (n) => `---\nname: ${n}\ndescription: \n---\nWhat the agent should know or do.\n`,
};

let dir = "";
let entries: Entry[] = [];
let current: Entry | null = null;
let preview: {skill: Skill; content: string} | null = null;
let libraryQuery = "";
let libraryWorkspace: string | null = null;
const libraryRepo = () => libraryWorkspace === null ? activeWs()?.repo : libraryWorkspace || undefined;
let draft = ""; // text in the editor
let saved = ""; // text on disk
let message = "";
let rerender: () => void = () => {};

export const dirty = () => draft !== saved;
const statusText = () => message || (dirty() ? "Kaydedilmemiş değişiklik" : "Güncel");

function updateStatus() {
  const s = document.getElementById("editor-status");
  if (s) s.replaceWith(statusBadge());
}

function statusBadge(): HTMLElement {
  const bad = message.startsWith("Kaydedilmedi");
  const tone = bad ? "pill-negative" : dirty() ? "pill-warning" : "pill-neutral";
  return html`<span id="editor-status" class="pill ${tone}" role="status">${statusText()}</span>`;
}

export async function initRegistry(onChange: () => void) {
  rerender = onChange;
  dir = await invoke<string>("default_registry_dir");
  await refresh();
}

async function refresh() {
  entries = await invoke<Entry[]>("list_registry", { dir });
  rerender();
}

async function open(e: Entry) {
  if (dirty()) {
    message = "Kaydedilmedi: başka dosya açmadan önce kaydedin veya geri alın.";
    updateStatus();
    return;
  }
  try {
    saved = draft = await invoke<string>("read_entry", { dir, kind: e.kind, name: e.name });
    current = e;
    preview = null;
    message = "";
  } catch (err) {
    message = `Kaydedilmedi: ${err}`;
  }
  rerender();
}

async function save() {
  if (!current) return;
  try {
    await invoke("write_entry", { dir, kind: current.kind, name: current.name, content: draft });
    saved = draft;
    message = "Kaydedildi";
  } catch (err) {
    message = `Kaydedilmedi: ${err}`;
  }
  updateStatus();
}

async function create(kind: Kind, name: string) {
  if (dirty()) {
    message = "Kaydedilmedi: önce bu dosyayı kaydedin veya geri alın.";
    return rerender();
  }
  if (entries.some((e) => e.kind === kind && e.name === name)) {
    message = `Kaydedilmedi: "${name}" zaten var.`;
    return rerender();
  }
  try {
    await invoke("write_entry", { dir, kind, name, content: TEMPLATES[kind](name) });
  } catch (err) {
    message = `Kaydedilmedi: ${err}`;
    return rerender();
  }
  await refresh();
  await open({ kind, name });
}

act("skill-preview", async (el) => {
  if (dirty()) { message = "Not saved: önce değişiklikleri kaydedin veya geri alın."; updateStatus(); return; }
  try {
    preview = await invoke<{skill: Skill; content: string}>("read_skill", {repo: libraryRepo() ?? null, id: el.dataset.id});
    current = null; draft = saved = ""; message = "";
  } catch (error) { message = String(error); }
  rerender();
});
act("skills-refresh", () => { void refreshSkills(libraryRepo()); void refresh(); });

function library(): HTMLElement {
  const repo = libraryRepo();
  const available = catalog(repo);
  const section = html`<section class="px-space-sm py-space-md border-t border-outline-variant/20 flex flex-col gap-2">
    <div class="flex items-center justify-between"><strong class="text-sm text-on-surface">Ortak skill kütüphanesi</strong><button data-act="skills-refresh" class="text-primary text-xs">Yenile</button></div>
    <select id="skill-workspace" aria-label="Skill workspace" class="bg-surface-container rounded p-2 text-sm"><option value="" ${!repo ? "selected" : ""}>Global skill’ler</option>${ui.workspaces.map(w => html`<option value="${w.repo}" ${repo === w.repo ? "selected" : ""}>${w.name}</option>`)}</select>
    <input id="skill-search" aria-label="Skill ara" placeholder="İsim, kaynak veya açıklama ara…" value="${libraryQuery}" class="bg-surface-container rounded p-2 text-sm"/>
    <p class="text-xs text-outline">${available.loading ? "Yükleniyor…" : `${available.skills.length} skill`} · Proje varsayılanlarını Ayarlar’dan seçin.</p>
    ${available.error ? html`<p role="status" class="text-xs text-error">${available.error}</p>` : ""}
    <div class="max-h-96 overflow-auto" id="skill-library-list"></div>
  </section>`;
  section.querySelector<HTMLSelectElement>("select")!.onchange = e => { libraryWorkspace = (e.target as HTMLSelectElement).value; rerender(); };
  section.querySelector<HTMLInputElement>("input")!.oninput = e => { libraryQuery = (e.target as HTMLInputElement).value; rerender(); };
  const matching = available.skills.filter(s => `${s.name} ${s.id} ${s.description}`.toLowerCase().includes(libraryQuery.toLowerCase()));
  for (const skill of matching) section.querySelector("#skill-library-list")!.append(html`<button data-act="skill-preview" data-id="${skill.id}" class="w-full text-left p-2 rounded hover:bg-surface-container text-on-surface-variant"><span class="block text-sm">${skill.name}</span><span class="block text-xs text-outline">${skill.id}${skill.error ? " · okunamadı" : ""}</span></button>`);
  return section;
}

act("reg-open", (el) => { const e = entries.find((x) => x.kind === el.dataset.kind && x.name === el.dataset.name); if (e) open(e); });
act("reg-save", () => save());
act("reg-revert", () => { draft = saved; message = ""; rerender(); });
act("reg-new", (el) => {
  const input = document.getElementById(`new-${el.dataset.kind}`) as HTMLInputElement;
  if (input?.value.trim()) create(el.dataset.kind as Kind, input.value.trim());
});

function entryRow(e: Entry): HTMLElement {
  const active = current?.kind === e.kind && current.name === e.name;
  return html`<button data-act="reg-open" data-kind="${e.kind}" data-name="${e.name}" class="list-row !py-2 ${active ? "active" : ""}" aria-current="${active ? "true" : "false"}">
    <div class="text-body text-ink truncate">${e.name}</div>
    <div class="num text-small text-muted truncate">${e.kind === "role" ? `roles/${e.name}.md` : `skills/${e.name}/SKILL.md`}</div>
  </button>`;
}

function group(title: string, kind: Kind): HTMLElement {
  const list = entries.filter((x) => x.kind === kind);
  const box = html`<div>
    <div class="px-4 pt-4 pb-2 flex items-baseline justify-between gap-2"><h2 class="text-body font-semibold text-ink">${title}</h2><span class="num text-small text-muted">${list.length}</span></div>
    <div class="reg-list border-t border-rule"></div>
    <div class="px-4 py-2.5 flex items-center gap-2">
      <input id="new-${kind}" autocomplete="off" aria-label="Yeni ${kind === "role" ? "rol" : "skill"} adı" placeholder="yeni-${kind === "role" ? "rol" : "skill"}-adı" class="field field-sm field-mono min-w-0"/>
      <button data-act="reg-new" data-kind="${kind}" class="btn btn-sm">${icon("add", 12)}Ekle</button>
    </div></div>`;
  const rows = box.querySelector(".reg-list")!;
  list.forEach((e) => rows.append(entryRow(e)));
  return box;
}

export function registryPage(): HTMLElement {
  const page = html`<div class="panes">
    <aside class="pane-list" aria-label="Roller ve skill'ler">
      <div class="px-4 pt-4"><h1 class="text-section text-ink">Registry</h1><p class="text-small text-muted mt-0.5"><span class="num">${entries.length}</span> tanım, döngü her run'da bunları okur.</p></div>
      <div id="reg-groups" class="flex-1 overflow-y-auto min-h-0"></div>
      <div class="px-4 py-2.5 border-t border-border num text-small text-muted truncate" title="${dir}">${dir}</div>
    </aside>
    <section class="pane-main" id="reg-editor" aria-label="Düzenleyici"></section>
  </div>`;
  page.querySelector("#reg-groups")!.append(group("Roller (Roles)", "role"), group("Beceriler (Skills)", "skill"), library());
  const ed = page.querySelector("#reg-editor")!;
  if (preview) {
    if (message) ed.append(html`<p role="status" class="p-3 text-sm text-error">${message}</p>`);
    const skill = preview.skill;
    const detail = html`<section class="p-space-lg flex flex-col gap-3"><h2 class="text-lg text-on-surface">${skill.name}</h2><p class="text-sm text-on-surface-variant">${skill.description}</p><p class="text-xs text-secondary">${skill.id} · Salt okunur kaynak</p><p class="text-xs text-outline break-all">${skill.path}</p><p class="text-sm text-on-surface-variant">${skill.scripts ? "scripts/ mevcut. " : ""}${skill.references ? "references/ mevcut. " : ""}Destek dosyaları kaynak klasöründen okunur; araç çalıştırma yetkisi agent’a ve oturum politikasına bağlıdır.</p>${skill.requirements ? html`<p class="text-xs text-tertiary">Bildirilen araç gereksinimleri: ${skill.requirements}</p>` : ""}${skill.error ? html`<p class="text-sm text-error">${skill.error}</p>` : ""}<textarea readonly aria-label="Skill içeriği" class="min-h-[60vh] w-full rounded p-3 bg-surface-container-lowest font-code-sm text-code-sm"></textarea></section>`;
    detail.querySelector("textarea")!.value = preview.content;
    ed.append(detail);
    return page;
  }
  if (!current) {
    ed.append(html`<div class="flex-1 flex items-center justify-center px-6 text-center text-body ${message ? "text-negative" : "text-muted"}">${message || "Düzenlemek için bir rol veya skill seçin."}</div>`);
    return page;
  }
  const bar = html`<div class="min-h-[56px] flex-none px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-border">
    <div class="flex items-center gap-3 min-w-0">
      <h2 class="num text-body font-medium text-ink truncate">${current.kind === "role" ? "roles" : "skills"}/${current.name}${current.kind === "role" ? ".md" : "/SKILL.md"}</h2>
      <span id="editor-status"></span>
    </div>
    <div class="flex items-center gap-2">
      <button data-act="reg-revert" class="btn">Geri al</button>
      <button data-act="reg-save" class="btn btn-primary">Kaydet<kbd class="num text-small font-normal opacity-60">Ctrl S</kbd></button>
    </div>
  </div>`;
  bar.querySelector("#editor-status")!.replaceWith(statusBadge());
  const wrap = html`<div class="flex-1 min-h-0 flex"><textarea id="reg-text" spellcheck="false" aria-label="Dosya içeriği" class="editor"></textarea></div>`;
  const area = wrap.querySelector("textarea")!;
  area.value = draft;
  area.oninput = () => { draft = area.value; message = ""; updateStatus(); };
  area.onkeydown = (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") { ev.preventDefault(); save(); } };
  ed.append(bar, wrap);
  return page;
}
