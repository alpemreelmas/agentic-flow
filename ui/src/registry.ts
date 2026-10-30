// Registry tab: edit roles and skills (the markdown files the Python loop reads at run time).
import { invoke } from "@tauri-apps/api/core";
import { catalog, refreshSkills, type Skill } from "./skills.ts";
import { activeWs, ui } from "./state.ts";
import { act, html } from "./tpl.ts";

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
const statusText = () => message || (dirty() ? "Değişiklik kaydedilmedi (●)" : "Güncel");

function updateStatus() {
  const s = document.getElementById("editor-status");
  if (s) s.replaceWith(statusBadge());
}

function statusBadge(): HTMLElement {
  const bad = message.startsWith("Not saved");
  const tone = bad ? "bg-error/15 text-error" : dirty() ? "bg-tertiary/15 text-tertiary" : "bg-secondary/10 text-secondary";
  return html`<span id="editor-status" class="font-label-sm text-label-sm px-2 py-0.5 rounded flex items-center gap-1 font-semibold ${tone}"><span class="w-1.5 h-1.5 rounded-full bg-current"></span>${statusText()}</span>`;
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
    message = "Not saved: save or revert the current file before opening another.";
    updateStatus();
    return;
  }
  try {
    saved = draft = await invoke<string>("read_entry", { dir, kind: e.kind, name: e.name });
    current = e;
    preview = null;
    message = "";
  } catch (err) {
    message = `Not saved: ${err}`;
  }
  rerender();
}

async function save() {
  if (!current) return;
  try {
    await invoke("write_entry", { dir, kind: current.kind, name: current.name, content: draft });
    saved = draft;
    message = "Saved";
  } catch (err) {
    message = `Not saved: ${err}`;
  }
  updateStatus();
}

async function create(kind: Kind, name: string) {
  if (dirty()) {
    message = "Not saved: save or revert the current file first.";
    return rerender();
  }
  if (entries.some((e) => e.kind === kind && e.name === name)) {
    message = `Not saved: ${kind} "${name}" already exists.`;
    return rerender();
  }
  try {
    await invoke("write_entry", { dir, kind, name, content: TEMPLATES[kind](name) });
  } catch (err) {
    message = `Not saved: ${err}`;
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
  const icon = e.kind === "role" ? "smart_toy" : "terminal";
  return html`<button data-act="reg-open" data-kind="${e.kind}" data-name="${e.name}" class="w-full text-left px-space-sm py-2 rounded flex items-center gap-2.5 min-w-0 transition-all ${active ? "bg-surface-container-high text-on-surface shadow-sm relative" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}">
    ${active ? html`<div class="absolute left-0 top-1 bottom-1 w-1 bg-primary rounded-r"></div>` : ""}
    <span class="material-symbols-outlined ${active ? "text-primary" : e.kind === "skill" ? "text-secondary" : "text-on-surface-variant"} text-[16px]">${icon}</span>
    <div class="truncate"><p class="${e.kind === "skill" ? "font-code-sm text-code-sm" : "font-body-sm text-body-sm font-medium leading-none"} text-on-surface">${e.name}</p>${e.kind === "role" ? html`<p class="font-code-sm text-code-sm text-outline mt-0.5">roles/${e.name}.md</p>` : ""}</div>
  </button>`;
}

function group(title: string, kind: Kind): HTMLElement {
  const list = entries.filter((x) => x.kind === kind);
  const box = html`<div class="px-space-sm pt-space-xs pb-space-sm flex flex-col gap-1">
    <div class="px-space-sm py-1 flex items-center justify-between"><span class="font-label-sm text-label-sm uppercase tracking-wider text-outline font-semibold">${title}</span><span class="font-code-sm text-code-sm text-outline-variant">${list.length}</span></div>
    <div class="flex items-center gap-1 mt-1">
      <input id="new-${kind}" autocomplete="off" placeholder="yeni-${kind === "role" ? "rol" : "skill"}-adı" class="flex-1 min-w-0 bg-surface-container rounded px-2 py-1.5 text-on-surface font-code-sm text-code-sm placeholder:text-outline focus:outline-none"/>
      <button data-act="reg-new" data-kind="${kind}" class="px-space-sm py-1.5 rounded bg-surface-container-low hover:bg-surface-container text-primary font-body-sm text-body-sm flex items-center gap-1 transition-colors"><span class="material-symbols-outlined text-[16px]">add_box</span>Ekle</button>
    </div></div>`;
  const anchor = box.children[0];
  list.reverse().forEach((e) => anchor.after(entryRow(e)));
  return box;
}

export function registryPage(): HTMLElement {
  const page = html`<div class="grid grid-cols-12 min-h-[calc(100vh-2.5rem)] bg-surface text-on-surface">
    <div class="col-span-4 xl:col-span-3 bg-surface-container-lowest flex flex-col justify-between">
      <div class="flex flex-col">
        <div class="px-space-md py-space-sm bg-surface-container-low flex items-center justify-between">
          <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[18px]">account_tree</span><span class="font-headline-sm text-headline-sm text-on-surface tracking-tight">Kayıt Defteri</span></div>
          <span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-secondary font-medium">${entries.length} Kaynak</span>
        </div>
        <div id="reg-groups"></div>
      </div>
      <div class="p-space-sm bg-surface-container-low m-space-xs rounded shadow-sm">
        <div class="flex items-center justify-between mb-1"><span class="font-label-sm text-label-sm uppercase tracking-wider text-outline">Registry</span><span class="font-code-sm text-code-sm text-secondary">${entries.length} tanım yüklü</span></div>
        <div class="font-code-sm text-code-sm text-outline truncate" title="${dir}">${dir}</div>
      </div>
    </div>
    <div class="col-span-8 xl:col-span-9 bg-surface flex flex-col" id="reg-editor"></div>
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
    ed.append(html`<div class="p-space-xl text-outline font-body-md text-body-md">${message || "Düzenlemek için bir rol veya skill seçin."}</div>`);
    return page;
  }
  const bar = html`<div class="px-space-md py-space-sm bg-surface-container flex flex-wrap items-center justify-between gap-space-sm shadow-sm z-10">
    <div class="flex items-center gap-space-sm min-w-0">
      <div class="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container-highest text-on-surface font-code-sm text-code-sm"><span class="material-symbols-outlined text-primary text-[15px]">description</span><span class="font-semibold">${current.kind === "role" ? "roles" : "skills"}/${current.name}${current.kind === "role" ? ".md" : "/SKILL.md"}</span></div>
      <span id="editor-status"></span>
      <span class="text-outline-variant hidden sm:inline">•</span><span class="font-code-sm text-code-sm text-outline hidden sm:inline">UTF-8 • UNIX (LF)</span>
    </div>
    <div class="flex items-center gap-space-sm">
      <button data-act="reg-revert" class="px-3 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm transition-colors flex items-center gap-1.5 shadow-sm"><span class="material-symbols-outlined text-[15px]">undo</span>Geri Al</button>
      <button data-act="reg-save" class="px-3.5 py-1 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-body-sm text-body-sm font-semibold transition-all shadow-md flex items-center gap-1.5"><span class="material-symbols-outlined text-[15px]">save</span>Kaydet<kbd class="ml-1 px-1 rounded bg-surface-container-lowest/40 font-code-sm text-code-sm">⌘S</kbd></button>
    </div>
  </div>`;
  bar.querySelector("#editor-status")!.replaceWith(statusBadge());
  const wrap = html`<div class="flex-1 p-space-md flex flex-col"><textarea spellcheck="false" class="flex-1 min-h-[60vh] w-full bg-surface-container-lowest text-on-surface font-code-md text-code-md rounded-xl p-space-md shadow-md resize-none focus:outline-none"></textarea></div>`;
  const area = wrap.querySelector("textarea")!;
  area.value = draft;
  area.oninput = () => { draft = area.value; message = ""; updateStatus(); };
  area.onkeydown = (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") { ev.preventDefault(); save(); } };
  ed.append(bar, wrap);
  return page;
}
