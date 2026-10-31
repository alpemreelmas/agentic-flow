// Brainstorm chat: an ACP agent session per chat, read-only (see looper/chat.py).
import { invoke } from "@tauri-apps/api/core";
import { act, html, selectEl } from "../tpl.ts";
import { icon } from "../icons.ts";
import { applyEvent, type Run, type RunEvent } from "../runModel.ts";
import { activeWs, schedule, ui } from "../state.ts";
import { itemRow } from "./runs.ts";
import { catalog, refreshSkills } from "../skills.ts";
import { loadQueue } from "./queue.ts";
import { accept, mentionedFiles, mentionedSkills, rank, triggerAt, type Candidate, type Trigger } from "../autocomplete.ts";

interface Choice { value: string; name: string; description?: string }
interface ConfigOption { id: string; name: string; description?: string; category?: string; type: string; value: string | boolean; choices: Choice[] }
interface Mode { id: string; name: string; description?: string }
interface Command { name: string; description?: string; hint?: string }

interface Chat {
  id: string; title: string; agent: string; workspace: string;
  runs: Map<string, Run>; status: "starting" | "ready" | "busy" | "closed";
  defaultSkills: string[]; pending: boolean; dirtyItems: Set<number>; draft: string; error: string; startedAt: number; repo: string;
  modes: { current: string; available: Mode[] } | null; options: ConfigOption[]; commands: Command[]; bridge: string;
}

const chats = new Map<string, Chat>();
let current: string | null = null;
let agent = "claude";
let startError = "";
// Per-repo file lists (git ls-files) and registry skills feed the `@` and `#` popups.
const fileCache = new Map<string, string[]>();

let pop: { items: Candidate[]; sel: number; trig: Trigger } | null = null;
let mounted: HTMLElement | null = null;
let mountedId: string | null = null;
let controlsStamp = "";
let listStamp = "";
let chatFrame = false;
const rows = new Map<number, HTMLElement>();
const earlyEvents = new Map<string, RunEvent[]>();
function refreshChat() {
  if (ui.page !== "chat") return;
  if (!mounted?.isConnected) { schedule(); return; }
  if (chatFrame) return;
  chatFrame = true;
  requestAnimationFrame(() => { chatFrame = false; chatPage(); });
}

const sessionRun = (c: Chat): Run => c.runs.get(c.id)!;

export function handleChatEvent(id: string, ev: RunEvent) {
  const c = chats.get(id);
  if (!c) {
    if (!earlyEvents.has(id) && earlyEvents.size >= 8) earlyEvents.delete(earlyEvents.keys().next().value!);
    const events = earlyEvents.get(id) ?? [];
    if (events.length < 200) events.push(ev);
    earlyEvents.set(id, events);
    return;
  }
  if (ev.type === "ready") {
    c.status = "ready";
    c.defaultSkills = (ev.default_skills as string[]) ?? c.defaultSkills;
    c.modes = (ev.modes as Chat["modes"]) ?? null;
    c.options = (ev.config_options as ConfigOption[]) ?? [];
    if (ev.bridge_available === true) c.bridge = "Linear araçları bağlı · task hazırlayabilir ve isteğinle kuyruğa gönderebilirsin.";
  } else if (ev.type === "bridge_status") {
    c.bridge = String(ev.message ?? "Linear araçları kullanılamıyor.");
  } else if (ev.type === "linear_changed") {
    void loadQueue();
  } else if (ev.type === "commands") c.commands = (ev.commands as Command[]) ?? [];
  else if (ev.type === "mode") { if (c.modes) c.modes.current = String(ev.id); }
  else if (ev.type === "config_options") c.options = (ev.options as ConfigOption[]) ?? [];
  else if (ev.type === "turn_end") c.status = "ready";
  else if (ev.type === "closed") {
    c.status = "closed";
    c.error = String(ev.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" · ");
  } else {
    applyEvent(c.runs, id, ev);
    c.dirtyItems.add(sessionRun(c).items.length - 1);
    if (ev.type === "tool_update" || ev.type === "tool_call") {
      const index = sessionRun(c).items.findIndex(i => i.kind === "tool" && i.id === ev.id);
      if (index >= 0) c.dirtyItems.add(index);
    }
  }
  if (["mode", "config_options", "error"].includes(ev.type)) c.pending = false;
  if (ev.type === "error") c.error = String(ev.error ?? "Agent hatası");
  refreshChat();
}

act("chat-new", async () => {
  const w = activeWs() ?? ui.workspaces.find((x) => x.enabled) ?? ui.workspaces[0];
  startError = "";
  if (!w) { startError = "Önce Ayarlar'dan bir workspace ekleyin."; schedule(); return; }
  try {
    const id = await invoke<string>("chat_start", { repo: w.repo, agent });
    const c: Chat = { id, title: `${w.name} · ${agent}`, agent, workspace: w.name, runs: new Map(), status: "starting", defaultSkills: [...(w.skills ?? [])], pending: false, dirtyItems: new Set(), draft: "", error: "", startedAt: Date.now(), repo: w.repo, modes: null, options: [], commands: [], bridge: "Linear bağlantısı kontrol ediliyor…" };
    void loadFiles(w.repo);
    void refreshSkills(w.repo);
    applyEvent(c.runs, id, { ts: Date.now() / 1000, type: "run_start", title: c.title });
    chats.set(id, c);
    for (const ev of earlyEvents.get(id) ?? []) handleChatEvent(id, ev);
    earlyEvents.delete(id);
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
act("chat-cancel", () => {
  const c = current ? chats.get(current) : undefined;
  if (c) void invoke("chat_cancel", { chatId: c.id }).catch(e => { c.error = String(e); refreshChat(); });
});
document.addEventListener("keydown", e => {
  if (ui.page !== "chat" || e.isComposing) return;
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "Slash") {
    e.preventDefault();
    const select = document.querySelector<HTMLSelectElement>('[data-category="model"]');
    select?.focus();
    try { select?.showPicker?.(); } catch { /* Focus remains available on older webviews. */ }
  }
});
act("chat-send", () => send());

async function loadFiles(repo: string) {
  if (fileCache.has(repo)) return;
  fileCache.set(repo, []);
  try { fileCache.set(repo, await invoke<string[]>("list_files", { repo })); } catch { fileCache.delete(repo); }
}

function candidates(c: Chat, t: Trigger): Candidate[] {
  if (t.sigil === "/") {
    return rank(c.commands.map((x) => ({ kind: "command" as const, label: x.name, insert: "/" + x.name, detail: [x.hint, x.description].filter(Boolean).join(" — ") })), t.query);
  }
  if (t.sigil === "#") return rank(catalog(c.repo).skills.filter(s => !s.error).map(s => ({kind: "skill" as const, label: s.name + " · " + s.id, insert: "#" + s.id, detail: s.description})), t.query);
  return rank((fileCache.get(c.repo) ?? []).map((f) => ({ kind: "file" as const, label: f, insert: "@" + f })), t.query);
}

function send() {
  const c = current ? chats.get(current) : undefined;
  if (!c || c.pending || c.status !== "ready" || !c.draft.trim()) return;
  const text = c.draft.trim();
  const available = catalog(c.repo).skills;
  const names = new Set(available.flatMap(s => [s.id, s.name]));
  const selected = mentionedSkills(text, names);
  const files = mentionedFiles(text, new Set(fileCache.get(c.repo) ?? []));
  c.draft = "";
  pop = null;
  c.status = "busy";
  c.error = "";
  applyEvent(c.runs, c.id, { ts: Date.now() / 1000, type: "user_message", text });
  c.dirtyItems.add(sessionRun(c).items.length - 1);
  invoke("chat_send", { chatId: c.id, text, files, skills: selected }).catch((e) => {
    c.status = "ready";
    applyEvent(c.runs, c.id, { ts: Date.now() / 1000, type: "agent_error", error: String(e) });
    c.dirtyItems.add(sessionRun(c).items.length - 1);
    refreshChat();
  });
  refreshChat();
}

const pickOptions = (c: Chat) => {
  const rankCat = (o: ConfigOption) => ({ model: 0, thought_level: 1 } as Record<string, number>)[o.category ?? ""] ?? 2;
  return [...c.options].sort((a, b) => rankCat(a) - rankCat(b));
};

function toolbar(c: Chat): HTMLElement {
  const locked = c.status !== "ready" || c.pending;
  const sel = "field !h-7 !w-auto max-w-[180px] text-small";
  const bar = html`<div id="chat-tools" class="flex flex-wrap items-center gap-2"></div>`;
  bar.append(html`<p class="w-full text-muted text-small" role="status">${c.bridge}</p>`);
  if (c.modes && c.modes.available.length) {
    const m = html`<select aria-label="Agent modu" ${locked ? "disabled" : ""} title="Mod" class="${sel}">${c.modes.available.map((x) => html`<option value="${x.id}" title="${x.description ?? ""}" ${x.id === c.modes!.current ? "selected" : ""}>${x.name}</option>`)}</select>`;
    (m as HTMLSelectElement).onchange = (e) => {
      const id = (e.target as HTMLSelectElement).value;
      c.pending = true; refreshChat();
      void invoke("chat_set_mode", { chatId: c.id, id })
        .catch(err => { c.pending = false; c.error = String(err); refreshChat(); });
    };
    bar.append(m);
  }
  for (const o of pickOptions(c)) {
    const set = (value: string | boolean) => {
      c.pending = true; refreshChat();
      void invoke("chat_set_config", { chatId: c.id, id: o.id, value })
        .catch(err => { c.pending = false; c.error = String(err); refreshChat(); });
    };
    if (o.type === "boolean") {
      const b = html`<label class="flex items-center gap-1.5 text-small text-soft cursor-pointer" title="${o.description ?? ""}"><input ${locked ? "disabled" : ""} type="checkbox" class="switch" ${o.value === true ? "checked" : ""}/>${o.name}</label>`;
      (b.querySelector("input") as HTMLInputElement).onchange = (e) => set((e.target as HTMLInputElement).checked);
      bar.append(b);
    } else if (o.choices.length) {
      const named = o.category === "model" || o.category === "thought_level";
      const el = selectEl(sel, o.choices.map((x) => ({ value: x.value, label: named ? x.name : `${o.name}: ${x.name}`, title: x.description })), String(o.value), { title: `${o.name}${o.description ? " — " + o.description : ""}`, "aria-label": o.name });
      el.disabled = locked;
      el.dataset.category = o.category ?? "";
      el.onchange = () => set(el.value);
      bar.append(el);
    }
  }
  if (c.defaultSkills.length) bar.append(html`<span class="text-small text-soft" title="${c.defaultSkills.join(", ")}">Skills · ${c.defaultSkills.length} proje varsayılanı</span>`);
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
    if (e.key === "Escape" && c.status === "busy") { e.preventDefault(); void invoke("chat_cancel", { chatId: c.id }).catch(err => { c.error = String(err); refreshChat(); }); return; }
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
      <span id="chat-status" class="pill ${statusPill}">${c.status === "busy" ? html`<span class="dot live"></span>` : ""}${statusLabel[c.status]}</span>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3.5" id="chat-scroll"></div>
    <div id="chat-error" role="status" class="px-6 text-negative text-small">${c.error}</div>
    <div class="flex-none px-6 pb-5">
      <div id="chat-composer" class="relative panel focus-within:border-control">
        <textarea id="chat-input" rows="2" aria-label="Mesaj" ${c.status === "closed" ? "disabled" : ""} placeholder="${c.status === "closed" ? "Sohbet kapandı" : "Bir fikir yazın.  @ dosya, / komut, # skill"}" class="block w-full resize-none bg-transparent text-ink text-body px-3.5 pt-3 pb-1 focus:outline-none"></textarea>
        <div class="flex items-end justify-between gap-3 px-2.5 pb-2.5">
          <div id="chat-tools"></div>
          <div class="flex items-center gap-3 flex-none">
            <span class="text-small text-muted topbar-hide">Enter gönderir, Shift+Enter yeni satır</span>
            <span id="chat-submit">${c.status === "busy"
              ? html`<button data-act="chat-cancel" class="btn btn-danger">Durdur</button>`
              : html`<button data-act="chat-send" ${c.status !== "ready" || c.pending ? "disabled" : ""} class="btn btn-primary">Gönder</button>`}</span>
          </div>
        </div>
      </div>
    </div></section>`;
  const area = sec.querySelector("#chat-scroll") as HTMLElement;
  if (c.status === "closed" && c.error) area.append(html`<div class="panel px-3.5 py-2.5"><div class="text-body font-medium text-negative">Sohbet kapandı</div><div class="num text-small text-soft mt-0.5 break-words">${c.error}</div></div>`);
  sessionRun(c).items.forEach((item, i) => {
    const key = `${c.id}:${i}`;
    const row = itemRow(item, key);
    if (row) { area.append(row); rows.set(i, row); }
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
  if (mounted && mountedId === current) {
    const c = current ? chats.get(current) : undefined;
    if (c) {
      const area = mounted.querySelector<HTMLElement>("#chat-scroll")!;
      const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
      for (const i of [...c.dirtyItems].sort((a,b) => a-b)) {
        const item = sessionRun(c).items[i];
        if (!item) continue;
        const row = itemRow(item, `${c.id}:${i}`);
        if (!row) continue;
        const old = rows.get(i);
        if (old) old.replaceWith(row); else area.append(row);
        rows.set(i, row);
      }
      c.dirtyItems.clear();
      if (atBottom) area.scrollTop = area.scrollHeight;
      const stamp = JSON.stringify([c.status,c.pending,c.modes,c.options,c.error,c.bridge]);
      if (stamp !== controlsStamp) {
        controlsStamp = stamp;
        mounted.querySelector("#chat-tools")!.replaceWith(toolbar(c));
        const status = mounted.querySelector("#chat-status")!;
        status.textContent = statusLabel[c.status];
        status.className = `pill ${c.status === "closed" ? "pill-negative" : c.status === "busy" ? "pill-accent" : "pill-neutral"}`;
        mounted.querySelector("#chat-error")!.textContent = c.error;
        const input = mounted.querySelector<HTMLTextAreaElement>("#chat-input")!;
        input.disabled = c.status === "closed";
        if (c.status === "busy" && !c.draft) input.value = "";
        mounted.querySelector("#chat-submit")!.replaceChildren(c.status === "busy"
          ? html`<button data-act="chat-cancel" class="btn btn-danger">Durdur <kbd>Esc</kbd></button>`
          : html`<button data-act="chat-send" ${c.status !== "ready" || c.pending ? "disabled" : ""} class="btn btn-primary">Gönder <kbd>↵</kbd></button>`);
      }
    }
    const stamp = [...chats.values()].map(c => `${c.id}:${c.status}`).join();
    if (stamp !== listStamp) { listStamp = stamp; mounted.firstElementChild!.replaceWith(sidebar()); }
    return mounted;
  }
  rows.clear(); controlsStamp = ""; listStamp = "";
  const old = document.getElementById("chat-scroll");
  const prev = old ? { top: old.scrollTop, atBottom: old.scrollHeight - old.scrollTop - old.clientHeight < 40 } : null;
  const wrap = html`<div class="panes"></div>`;
  wrap.append(sidebar(), conversation(prev));
  mounted = wrap; mountedId = current;
  if (current) chats.get(current)?.dirtyItems.clear();
  return wrap;
}
