// Brainstorm chat: an ACP agent session per chat, read-only (see looper/chat.py).
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "../tpl.ts";
import { applyEvent, type Run, type RunEvent } from "../runModel.ts";
import { activeWs, schedule, ui } from "../state.ts";
import { itemRow } from "./runs.ts";
import { accept, mentionedFiles, mentionedSkills, rank, triggerAt, type Candidate, type Trigger } from "../autocomplete.ts";

interface Choice { value: string; name: string; description?: string }
interface ConfigOption { id: string; name: string; description?: string; category?: string; type: string; value: string | boolean; choices: Choice[] }
interface Mode { id: string; name: string; description?: string }
interface Command { name: string; description?: string; hint?: string }

interface Chat {
  id: string; title: string; agent: string; workspace: string;
  runs: Map<string, Run>; status: "starting" | "ready" | "busy" | "closed";
  draft: string; error: string; startedAt: number; repo: string;
  modes: { current: string; available: Mode[] } | null; options: ConfigOption[]; commands: Command[];
}

const chats = new Map<string, Chat>();
let current: string | null = null;
let agent = "claude";
let startError = "";
// Per-repo file lists (git ls-files) and registry skills feed the `@` and `#` popups.
const fileCache = new Map<string, string[]>();
let skills: string[] = [];
let pop: { items: Candidate[]; sel: number; trig: Trigger } | null = null;
const openKeys = new Set<string>();

const sessionRun = (c: Chat): Run => c.runs.get(c.id)!;

export function handleChatEvent(id: string, ev: RunEvent) {
  const c = chats.get(id);
  if (!c) return;
  if (ev.type === "ready") {
    c.status = "ready";
    c.modes = (ev.modes as Chat["modes"]) ?? null;
    c.options = (ev.config_options as ConfigOption[]) ?? [];
  } else if (ev.type === "commands") c.commands = (ev.commands as Command[]) ?? [];
  else if (ev.type === "mode") { if (c.modes) c.modes.current = String(ev.id); }
  else if (ev.type === "config_options") c.options = (ev.options as ConfigOption[]) ?? [];
  else if (ev.type === "turn_end") c.status = "ready";
  else if (ev.type === "closed") {
    c.status = "closed";
    c.error = String(ev.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" · ");
  } else applyEvent(c.runs, id, ev);
  schedule();
}

act("chat-new", async () => {
  const w = activeWs() ?? ui.workspaces.find((x) => x.enabled) ?? ui.workspaces[0];
  startError = "";
  if (!w) { startError = "Önce Ayarlar'dan bir workspace ekleyin."; schedule(); return; }
  try {
    const id = await invoke<string>("chat_start", { repo: w.repo, agent });
    const c: Chat = { id, title: `${w.name} · ${agent}`, agent, workspace: w.name, runs: new Map(), status: "starting", draft: "", error: "", startedAt: Date.now(), repo: w.repo, modes: null, options: [], commands: [] };
    void loadFiles(w.repo);
    void loadSkills();
    applyEvent(c.runs, id, { ts: Date.now() / 1000, type: "run_start", title: c.title });
    chats.set(id, c);
    current = id;
  } catch (e) {
    startError = String(e);
  }
  schedule();
});
act("chat-pick", (el) => { current = el.dataset.id!; schedule(); });
act("chat-close", (el) => {
  const id = el.dataset.id!;
  void invoke("chat_stop", { chatId: id });
  chats.delete(id);
  if (current === id) current = [...chats.keys()].pop() ?? null;
  schedule();
});
act("chat-cancel", () => { if (current) void invoke("chat_cancel", { chatId: current }); });
act("chat-send", () => send());

async function loadFiles(repo: string) {
  if (fileCache.has(repo)) return;
  fileCache.set(repo, []);
  try { fileCache.set(repo, await invoke<string[]>("list_files", { repo })); } catch { fileCache.delete(repo); }
}

async function loadSkills() {
  try {
    const dir = ui.paths.registry || await invoke<string>("default_registry_dir");
    const list = await invoke<{ kind: string; name: string }[]>("list_registry", { dir });
    skills = list.filter((e) => e.kind === "skill").map((e) => e.name);
  } catch { /* the popup just stays empty */ }
}

/** `#skill` mentions become the skill's text in front of the message; the shown message stays as typed. */
async function withSkills(text: string): Promise<string> {
  const names = mentionedSkills(text, new Set(skills));
  if (!names.length) return text;
  const dir = ui.paths.registry || await invoke<string>("default_registry_dir");
  const bodies = await Promise.all(names.map((n) => invoke<string>("read_entry", { dir, kind: "skill", name: n }).catch(() => "")));
  const used = names.map((n, i) => bodies[i] && `## Skill: ${n}\n${bodies[i]}`).filter(Boolean);
  return used.length ? `${used.join("\n\n")}\n\n---\n\n${text}` : text;
}

function candidates(c: Chat, t: Trigger): Candidate[] {
  if (t.sigil === "/") {
    return rank(c.commands.map((x) => ({ kind: "command" as const, label: x.name, insert: "/" + x.name, detail: [x.hint, x.description].filter(Boolean).join(" — ") })), t.query);
  }
  if (t.sigil === "#") return rank(skills.map((n) => ({ kind: "skill" as const, label: n, insert: "#" + n, detail: "skill" })), t.query);
  return rank((fileCache.get(c.repo) ?? []).map((f) => ({ kind: "file" as const, label: f, insert: "@" + f })), t.query);
}

function send() {
  const c = current ? chats.get(current) : undefined;
  if (!c || c.status !== "ready" || !c.draft.trim()) return;
  const text = c.draft.trim();
  const files = mentionedFiles(text, new Set(fileCache.get(c.repo) ?? []));
  c.draft = "";
  pop = null;
  c.status = "busy";
  applyEvent(c.runs, c.id, { ts: Date.now() / 1000, type: "user_message", text });
  withSkills(text).then((full) => invoke("chat_send", { chatId: c.id, text: full, files })).catch((e) => {
    c.status = "ready";
    applyEvent(c.runs, c.id, { ts: Date.now() / 1000, type: "agent_error", error: String(e) });
    schedule();
  });
  schedule();
}

const pickOptions = (c: Chat) => {
  const rankCat = (o: ConfigOption) => ({ model: 0, thought_level: 1 } as Record<string, number>)[o.category ?? ""] ?? 2;
  return [...c.options].sort((a, b) => rankCat(a) - rankCat(b));
};

function toolbar(c: Chat): HTMLElement {
  const sel = "h-7 px-1.5 rounded bg-surface-container text-on-surface font-label-sm text-label-sm focus:outline-none max-w-[180px]";
  const bar = html`<div class="px-space-md pt-space-sm bg-surface-container-lowest flex flex-wrap items-center gap-2"></div>`;
  if (c.modes && c.modes.available.length) {
    const m = html`<select title="Mod" class="${sel}">${c.modes.available.map((x) => html`<option value="${x.id}" title="${x.description ?? ""}" ${x.id === c.modes!.current ? "selected" : ""}>${x.name}</option>`)}</select>`;
    (m as HTMLSelectElement).onchange = (e) => {
      const id = (e.target as HTMLSelectElement).value;
      c.modes!.current = id;
      void invoke("chat_set_mode", { chatId: c.id, id }).catch((err) => { c.error = String(err); schedule(); });
    };
    bar.append(m);
  }
  for (const o of pickOptions(c)) {
    const set = (value: string | boolean) => {
      o.value = value;
      void invoke("chat_set_config", { chatId: c.id, id: o.id, value }).catch((err) => { c.error = String(err); schedule(); });
    };
    if (o.type === "boolean") {
      const b = html`<label class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant cursor-pointer" title="${o.description ?? ""}"><input type="checkbox" ${o.value === true ? "checked" : ""}/>${o.name}</label>`;
      (b.querySelector("input") as HTMLInputElement).onchange = (e) => set((e.target as HTMLInputElement).checked);
      bar.append(b);
    } else if (o.choices.length) {
      const el = html`<select title="${o.name}${o.description ? " — " + o.description : ""}" class="${sel}">${o.choices.map((x) => html`<option value="${x.value}" title="${x.description ?? ""}" ${x.value === o.value ? "selected" : ""}>${o.category === "model" || o.category === "thought_level" ? x.name : `${o.name}: ${x.name}`}</option>`)}</select>`;
      (el as HTMLSelectElement).onchange = (e) => set((e.target as HTMLSelectElement).value);
      bar.append(el);
    }
  }
  if (!bar.children.length) bar.append(html`<span class="font-label-sm text-label-sm text-outline">Bu ajan model/mod seçeneği bildirmedi.</span>`);
  return bar;
}

function popup(input: HTMLTextAreaElement, c: Chat): HTMLElement {
  const box = html`<div id="chat-pop" class="absolute bottom-full left-space-md right-space-md mb-1 rounded bg-surface-container-high shadow-lg overflow-hidden hidden"></div>`;
  const paint = () => {
    box.replaceChildren();
    box.classList.toggle("hidden", !pop || !pop.items.length);
    if (!pop) return;
    pop.items.forEach((it, i) => {
      const row = html`<div class="px-2 py-1 flex items-baseline gap-2 cursor-pointer font-code-sm text-code-sm ${i === pop!.sel ? "bg-primary-container/30 text-on-surface" : "text-on-surface-variant hover:bg-surface-container-highest"}"><span class="truncate">${it.label}</span><span class="truncate text-outline font-label-sm text-label-sm">${it.detail ?? ""}</span></div>`;
      row.onmousedown = (e) => { e.preventDefault(); choose(i); };
      box.append(row);
    });
  };
  const choose = (i: number) => {
    if (!pop) return;
    const out = accept(input.value, pop.trig, pop.items[i]);
    input.value = c.draft = out.text;
    input.setSelectionRange(out.caret, out.caret);
    pop = null; paint();
  };
  const refresh = () => {
    c.draft = input.value;
    const t = triggerAt(input.value, input.selectionStart ?? input.value.length);
    const items = t ? candidates(c, t) : [];
    pop = t && items.length ? { items, sel: 0, trig: t } : null;
    paint();
  };
  input.oninput = refresh;
  input.onclick = refresh;
  input.onblur = () => { pop = null; paint(); };
  input.onkeydown = (e) => {
    if (pop && !e.isComposing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        pop.sel = (pop.sel + (e.key === "ArrowDown" ? 1 : pop.items.length - 1)) % pop.items.length;
        paint(); return;
      }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(pop.sel); return; }
      if (e.key === "Escape") { e.preventDefault(); pop = null; paint(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); c.draft = input.value; send(); }
  };
  paint();
  return box;
}

const statusLabel = { starting: "Başlıyor…", ready: "Hazır", busy: "Yanıtlıyor…", closed: "Kapandı" } as const;

function sidebar(): HTMLElement {
  const box = html`<aside class="w-[300px] flex-shrink-0 flex flex-col bg-surface-container-lowest">
    <div class="p-space-md flex flex-col gap-space-sm bg-surface-container-low/60">
      <select id="chat-agent" class="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-body-sm text-body-sm focus:outline-none">
        ${["claude", "gemini", "codex"].map((a) => html`<option value="${a}" ${a === agent ? "selected" : ""}>${a === "claude" ? a : `${a} (deneysel)`}</option>`)}
      </select>
      <button data-act="chat-new" class="h-8 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-label-md text-label-md flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-[15px]">add</span>Yeni Sohbet</button>
      ${startError ? html`<p class="font-body-sm text-body-sm text-error">${startError}</p>` : ""}
    </div>
    <div class="flex-1 overflow-y-auto flex flex-col p-1.5 gap-1" id="chat-list"></div>
    <div class="p-space-sm bg-surface-container-low/80 font-label-sm text-label-sm text-outline">Salt okunur: ajan kodu okuyabilir, değiştiremez.</div>
  </aside>`;
  (box.querySelector("#chat-agent") as HTMLSelectElement).onchange = (e) => { agent = (e.target as HTMLSelectElement).value; };
  const list = box.querySelector("#chat-list")!;
  if (!chats.size) list.append(html`<p class="p-space-md text-outline font-body-sm text-body-sm">Henüz sohbet yok. Seçili workspace'in klasöründe bir ajanla fikir tartışmak için "Yeni Sohbet".</p>`);
  for (const c of [...chats.values()].reverse()) {
    list.append(html`<div data-act="chat-pick" data-id="${c.id}" class="p-space-sm rounded cursor-pointer flex items-center justify-between gap-2 ${c.id === current ? "bg-surface-container-high shadow-md" : "hover:bg-surface-container/70 bg-surface-container-low/40"}">
      <div class="min-w-0"><p class="font-body-md text-body-md text-on-surface truncate">${c.title}</p><p class="font-code-sm text-code-sm text-outline">${statusLabel[c.status]}</p></div>
      <button data-act="chat-close" data-id="${c.id}" class="w-6 h-6 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface flex items-center justify-center" title="Kapat"><span class="material-symbols-outlined text-[14px]">close</span></button></div>`);
  }
  return box;
}

function conversation(prevTop: { top: number; atBottom: boolean } | null): HTMLElement {
  const c = current ? chats.get(current) : undefined;
  if (!c) return html`<section class="flex-1 flex items-center justify-center bg-surface text-outline font-body-md text-body-md">Bir sohbet seçin ya da yenisini başlatın.</section>`;
  const sec = html`<section class="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
    <div class="h-12 px-space-lg flex items-center justify-between bg-surface-container-low/40 shadow-sm">
      <span class="font-headline-md text-headline-md text-on-surface tracking-tight font-semibold truncate">${c.title}</span>
      <span class="px-2 py-0.5 rounded font-label-sm text-label-sm ${c.status === "closed" ? "bg-error-container/30 text-error" : "bg-secondary/10 text-secondary"}">${statusLabel[c.status].toUpperCase()}</span>
    </div>
    <div class="flex-1 overflow-y-auto p-space-lg flex flex-col gap-space-lg" id="chat-scroll"></div>
    <div id="chat-tools"></div>
    <div id="chat-composer" class="relative p-space-md bg-surface-container-lowest flex items-end gap-space-sm">
      <textarea id="chat-input" rows="2" ${c.status === "closed" ? "disabled" : ""} placeholder="${c.status === "closed" ? "Sohbet kapandı" : "Bir fikir yazın…  @ dosya · / komut · # skill  (Enter gönderir, Shift+Enter yeni satır)"}" class="flex-1 resize-none rounded bg-surface-container text-on-surface font-body-md text-body-md p-2 placeholder:text-outline focus:outline-none focus:bg-surface-container-high"></textarea>
      ${c.status === "busy"
        ? html`<button data-act="chat-cancel" class="h-9 px-3 rounded bg-surface-container-high hover:bg-surface-container-highest text-error font-label-md text-label-md">Durdur</button>`
        : html`<button data-act="chat-send" ${c.status !== "ready" ? "disabled" : ""} class="h-9 px-3 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-label-md text-label-md disabled:opacity-50">Gönder</button>`}
    </div></section>`;
  const area = sec.querySelector("#chat-scroll") as HTMLElement;
  if (c.status === "closed" && c.error) area.append(html`<div class="rounded bg-error-container/20 p-space-md font-code-sm text-code-sm text-error">${c.error}</div>`);
  sessionRun(c).items.forEach((item, i) => {
    const key = `${c.id}:${i}`;
    const row = itemRow(item, key);
    if (row) area.append(row);
  });
  const input = sec.querySelector("#chat-input") as HTMLTextAreaElement;
  input.value = c.draft;
  sec.querySelector("#chat-tools")!.replaceWith(toolbar(c));
  sec.querySelector("#chat-composer")!.prepend(popup(input, c));
  queueMicrotask(() => { area.scrollTop = prevTop && !prevTop.atBottom ? prevTop.top : area.scrollHeight; });
  return sec;
}

export function chatPage(): HTMLElement {
  const old = document.getElementById("chat-scroll");
  const prev = old ? { top: old.scrollTop, atBottom: old.scrollHeight - old.scrollTop - old.clientHeight < 40 } : null;
  const wrap = html`<div class="flex h-[calc(100vh-2.5rem)] w-full overflow-hidden bg-surface-container-lowest"></div>`;
  wrap.append(sidebar(), conversation(prev));
  void openKeys;
  return wrap;
}
