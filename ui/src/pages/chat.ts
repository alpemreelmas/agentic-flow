// Brainstorm chat: an ACP agent session per chat, read-only (see looper/chat.py).
import { invoke } from "@tauri-apps/api/core";
import { act, html, selectEl } from "../tpl.ts";
import { icon } from "../icons.ts";
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
  const sel = "field field-sm !w-auto max-w-[180px]";
  const bar = html`<div class="flex flex-wrap items-center gap-2 min-w-0"></div>`;
  if (c.modes && c.modes.available.length) {
    const m = selectEl(sel, c.modes.available.map((x) => ({ value: x.id, label: x.name, title: x.description })), c.modes.current, { title: "Mod", "aria-label": "Mod" });
    m.onchange = () => {
      const id = m.value;
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
      const b = html`<label class="flex items-center gap-1.5 text-small text-soft cursor-pointer" title="${o.description ?? ""}"><input type="checkbox" class="switch" ${o.value === true ? "checked" : ""}/>${o.name}</label>`;
      (b.querySelector("input") as HTMLInputElement).onchange = (e) => set((e.target as HTMLInputElement).checked);
      bar.append(b);
    } else if (o.choices.length) {
      const named = o.category === "model" || o.category === "thought_level";
      const el = selectEl(sel, o.choices.map((x) => ({ value: x.value, label: named ? x.name : `${o.name}: ${x.name}`, title: x.description })), String(o.value), { title: `${o.name}${o.description ? " — " + o.description : ""}`, "aria-label": o.name });
      el.onchange = () => set(el.value);
      bar.append(el);
    }
  }
  if (!bar.children.length) bar.append(html`<span class="text-small text-muted">Bu ajan model veya mod seçeneği bildirmedi.</span>`);
  return bar;
}

function popup(input: HTMLTextAreaElement, c: Chat): HTMLElement {
  const box = html`<div id="chat-pop" class="pop absolute bottom-full left-0 right-0 mb-1.5 rounded-card bg-raised max-h-64 overflow-y-auto hidden"></div>`;
  const paint = () => {
    box.replaceChildren();
    box.classList.toggle("hidden", !pop || !pop.items.length);
    if (!pop) return;
    pop.items.forEach((it, i) => {
      const row = html`<div class="px-3 py-1.5 flex items-baseline gap-2 cursor-pointer text-small ${i === pop!.sel ? "bg-control text-ink" : "text-soft hover:bg-control"}"><span class="num truncate">${it.label}</span><span class="truncate text-muted">${it.detail ?? ""}</span></div>`;
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
  const agents = selectEl("field", ["claude", "gemini", "codex"].map((a) => ({ value: a, label: a === "claude" ? a : `${a} (deneysel)` })), agent, { id: "chat-agent", "aria-label": "Ajan" });
  agents.onchange = () => { agent = agents.value; };
  const box = html`<aside class="pane-list" aria-label="Sohbet listesi">
    <div class="px-4 pt-4 pb-3 flex flex-col gap-3 border-b border-border">
      <h1 class="text-section text-ink">Sohbet</h1>
      <div class="flex items-center gap-2">${agents}<button data-act="chat-new" class="btn btn-primary !h-[34px]">${icon("add", 14)}Yeni</button></div>
      ${startError ? html`<p class="text-small text-negative">${startError}</p>` : ""}
    </div>
    <div class="flex-1 overflow-y-auto" id="chat-list"></div>
    <div class="px-4 py-2.5 border-t border-border text-small text-muted">Salt okunur: ajan kodu okuyabilir, değiştiremez.</div>
  </aside>`;
  const list = box.querySelector("#chat-list")!;
  if (!chats.size) list.append(html`<p class="empty !mx-4">Henüz sohbet yok. "Yeni" ile seçili workspace'in klasöründe bir ajanla fikir tartışın.</p>`);
  for (const c of [...chats.values()].reverse()) {
    list.append(html`<div data-act="chat-pick" data-id="${c.id}" class="list-row flex items-center justify-between gap-2 ${c.id === current ? "active" : ""}" aria-current="${c.id === current ? "true" : "false"}">
      <div class="min-w-0"><p class="text-body text-ink truncate">${c.title}</p><p class="text-small text-muted">${statusLabel[c.status]}</p></div>
      <button data-act="chat-close" data-id="${c.id}" class="btn btn-icon" title="Kapat" aria-label="Sohbeti kapat">${icon("close", 14)}</button></div>`);
  }
  return box;
}

function conversation(prevTop: { top: number; atBottom: boolean } | null): HTMLElement {
  const c = current ? chats.get(current) : undefined;
  if (!c) return html`<section class="pane-main items-center justify-center text-muted text-body px-6 text-center">Bir sohbet seçin ya da yenisini başlatın.</section>`;
  const statusPill = c.status === "closed" ? "pill-negative" : c.status === "busy" ? "pill-accent" : "pill-neutral";
  const sec = html`<section class="pane-main" aria-label="Sohbet">
    <div class="h-[56px] flex-none px-6 flex items-center justify-between gap-4 border-b border-border">
      <h2 class="text-card text-ink truncate">${c.title}</h2>
      <span class="pill ${statusPill}">${c.status === "busy" ? html`<span class="dot live"></span>` : ""}${statusLabel[c.status]}</span>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3.5" id="chat-scroll"></div>
    <div class="flex-none px-6 pb-5">
      <div id="chat-composer" class="relative panel focus-within:border-control">
        <textarea id="chat-input" rows="2" aria-label="Mesaj" ${c.status === "closed" ? "disabled" : ""} placeholder="${c.status === "closed" ? "Sohbet kapandı" : "Bir fikir yazın.  @ dosya, / komut, # skill"}" class="block w-full resize-none bg-transparent text-ink text-body px-3.5 pt-3 pb-1 focus:outline-none"></textarea>
        <div class="flex items-end justify-between gap-3 px-2.5 pb-2.5">
          <div id="chat-tools"></div>
          <div class="flex items-center gap-3 flex-none">
            <span class="text-small text-muted topbar-hide">Enter gönderir, Shift+Enter yeni satır</span>
            ${c.status === "busy"
              ? html`<button data-act="chat-cancel" class="btn btn-danger">Durdur</button>`
              : html`<button data-act="chat-send" ${c.status !== "ready" ? "disabled" : ""} class="btn btn-primary">Gönder</button>`}
          </div>
        </div>
      </div>
    </div></section>`;
  const area = sec.querySelector("#chat-scroll") as HTMLElement;
  if (c.status === "closed" && c.error) area.append(html`<div class="panel px-3.5 py-2.5"><div class="text-body font-medium text-negative">Sohbet kapandı</div><div class="num text-small text-soft mt-0.5 break-words">${c.error}</div></div>`);
  sessionRun(c).items.forEach((item, i) => {
    const key = `${c.id}:${i}`;
    const row = itemRow(item, key);
    if (row) area.append(row);
  });
  if (!sessionRun(c).items.length && c.status !== "closed") area.append(html`<p class="text-body text-muted">${c.status === "starting" ? "Ajan başlatılıyor…" : `${c.workspace} klasöründe hazır. Bir soruyla başlayın.`}</p>`);
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
  const wrap = html`<div class="panes"></div>`;
  wrap.append(sidebar(), conversation(prev));
  void openKeys;
  return wrap;
}
