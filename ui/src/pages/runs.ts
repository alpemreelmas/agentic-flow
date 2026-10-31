// Runs screen: the run list beside one run's timeline.
import { act, html } from "../tpl.ts";
import { invoke } from "@tauri-apps/api/core";
import { markdownEl } from "../markdown.ts";
import type { Item, Run, ToolDiff } from "../runModel.ts";
import { icon, type IconName } from "../icons.ts";
import { mini, stepper } from "../pipeline.ts";
import { SHOWN_STYLE, STAGES, elapsed, plainTitle, prUrl, runs, schedule, shown, shortId, sortedRuns, stageOf, ui } from "../state.ts";

// The detail pane is rebuilt on every event, so remember which <details> the user opened.
const openKeys = new Set<string>();

act("pick-run", (el) => { ui.selected = el.dataset.id!; ui.following = false; schedule(); });
act("status-set", (el) => { ui.statusFilter = el.dataset.s as typeof ui.statusFilter; schedule(); });
act("reset-filters", () => { ui.query = ""; ui.statusFilter = "all"; schedule(); });
act("item-filter", (el) => { ui.itemFilter = el.dataset.f as typeof ui.itemFilter; schedule(); });
act("toggle-thoughts", () => { ui.hideThoughts = !ui.hideThoughts; schedule(); });
act("to-live", () => document.getElementById("timelineScrollArea")?.scrollTo({ top: 1e9, behavior: "smooth" }));

/** One readable hint from a tool's input: agents send JSON, so show its first string value, not its opening brace. */
function toolHint(input: string): string {
  const t = input.trim();
  if (t.startsWith("{")) {
    try { return String(Object.values(JSON.parse(t)).find((v) => typeof v === "string") ?? "").slice(0, 100); } catch { /* not JSON after all */ }
  }
  return t.split("\n")[0].slice(0, 100);
}
const TOOL_STATUS: Record<string, string> = { completed: "Tamamlandı", failed: "Başarısız", pending: "Bekliyor", in_progress: "Çalışıyor" };

const STATUS_NAME = { all: "Tümü", running: "Çalışan", review: "İncelemede", needs_human: "İnsan" } as const;

function runCard(r: Run): HTMLElement {
  const st = SHOWN_STYLE[shown(r)];
  const sel = r.id === ui.selected;
  const pr = prUrl(r);
  const stage = STAGES[Math.max(stageOf(r), 0)];
  return html`<div data-act="pick-run" data-id="${r.id}" class="list-row ${sel ? "active" : ""}" aria-current="${sel ? "true" : "false"}">
    <div class="flex items-center justify-between gap-2">
      <span class="num text-body ${sel ? "text-ink" : "text-soft"} truncate">${shortId(r)}</span>
      <span class="pill ${st.pill}">${r.status === "running" ? html`<span class="dot live"></span>` : ""}${st.label}</span>
    </div>
    <div class="text-body text-ink mt-1 line-clamp-2">${plainTitle(r)}</div>
    <div class="flex items-center justify-between gap-2 mt-1.5 text-small text-muted">
      <span class="flex items-center gap-2 min-w-0">${mini(r)}<span class="truncate">${pr ? "PR hazır" : stage}</span></span>
      <span class="num whitespace-nowrap">${elapsed(r)}</span>
    </div>
  </div>`;
}

function listPane(): HTMLElement {
  const all = sortedRuns();
  const list = all.filter((r) => (ui.statusFilter === "all" || r.status === ui.statusFilter)
    && (!ui.query || `${r.title} ${r.id} ${r.role}`.toLowerCase().includes(ui.query)));
  const running = all.filter((r) => r.status === "running").length;
  const tab = (s: typeof ui.statusFilter) => html`<button data-act="status-set" data-s="${s}" class="tab ${ui.statusFilter === s ? "active" : ""}" aria-pressed="${ui.statusFilter === s ? "true" : "false"}">${STATUS_NAME[s]}</button>`;
  const pane = html`<aside class="pane-list select-none" aria-label="Run listesi">
    <div class="px-4 pt-4 flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-2"><h1 class="text-section text-ink">Runs</h1><span class="text-small text-muted"><span class="num">${running}</span> çalışıyor</span></div>
      <div class="relative flex items-center">
        <span class="absolute left-2.5 text-muted pointer-events-none flex">${icon("search", 14)}</span>
        <input id="run-search" value="${ui.query}" class="field !pl-8" placeholder="Görev no, başlık veya rol ara" type="text" aria-label="Run ara"/>
      </div>
      <div class="tabs -mx-4 px-4">${(["all", "running", "review", "needs_human"] as const).map(tab)}</div>
    </div>
    <div class="flex-1 overflow-y-auto" id="run-list"></div>
    <div class="px-4 py-2.5 border-t border-border flex items-center justify-between text-small text-muted">
      <span><span class="num">${list.length}</span> / <span class="num">${all.length}</span> run</span>
      ${ui.query || ui.statusFilter !== "all" ? html`<button data-act="reset-filters" class="link">Filtreleri sıfırla</button>` : ""}
    </div>
  </aside>`;
  const box = pane.querySelector("#run-list")!;
  if (!list.length) box.append(html`<p class="empty !mx-4">${all.length ? "Filtreye uyan run yok." : "Henüz run yok. Servis çalışınca burada görünür."}</p>`);
  list.forEach((r) => box.append(runCard(r)));
  (pane.querySelector("#run-search") as HTMLInputElement).oninput = (e) => {
    ui.query = (e.target as HTMLInputElement).value.toLowerCase();
    schedule();
  };
  return pane;
}

// ---- timeline items ----
function row(ic: IconName, tone: string, card: Node): HTMLElement {
  return html`<div class="tl"><div class="tl-node ${tone}">${icon(ic, 15)}</div><div class="tl-body">${card}</div></div>`;
}
function collapsible(key: string, head: HTMLElement, body: Node[]): HTMLElement {
  const d = html`<details class="tl-card"><summary></summary></details>` as HTMLDetailsElement;
  d.querySelector("summary")!.append(head);
  d.open = openKeys.has(key);
  d.ontoggle = () => void (d.open ? openKeys.add(key) : openKeys.delete(key));
  d.append(...body);
  return d;
}
const chev = () => icon("chevron", 14, "chev text-muted");
const pre = (text: string, cls = "text-soft") => html`<pre class="code ${cls}">${text}</pre>`;
const said = (who: string, body: Node, cls = "text-ink") => html`<div class="min-w-0"><div class="text-small text-muted mb-1">${who}</div><div class="text-body ${cls}">${body}</div></div>`;

function diffBlock(d: ToolDiff): HTMLElement {
  const lines = (t: string, m: "+" | "-") => (t ? t.split("\n").map((l) => ({ m, l })) : []);
  const rows = [...lines(d.oldText, "-"), ...lines(d.newText, "+")];
  const add = rows.filter((r) => r.m === "+").length, del = rows.length - add;
  return html`<div class="border-t border-rule">
    <div class="px-3.5 py-2 flex items-center gap-2 min-w-0 text-small">
      <span class="num text-ink truncate">${d.path}</span>
      <span class="num text-positive">+${add}</span>
      <span class="num text-negative">-${del}</span>
    </div>
    <div class="num text-small overflow-x-auto select-text">${rows.map((r) => html`<div class="flex py-0.5 px-3.5 ${r.m === "+" ? "diff-add" : "diff-del"}"><span class="w-4 flex-none select-none">${r.m}</span><span class="pl-1 whitespace-pre">${r.l}</span></div>`)}</div>
  </div>`;
}

export function itemRow(item: Item, key: string): HTMLElement | null {
  switch (item.kind) {
    case "user":
      return html`<div class="flex justify-end"><div class="max-w-[80%] rounded-card bg-raised text-ink px-3.5 py-2.5 text-body whitespace-pre-wrap">${item.text}</div></div>`;
    case "attempt":
      return html`<div class="tl-sep pt-1"><span>Deneme <span class="num">${item.n}</span> · ${item.role} · ${item.cli}</span></div>`;
    case "stage":
      return html`<div class="tl-sep"><span>${item.label}</span></div>`;
    case "review":
      return html`<div class="tl-sep pt-1"><span>İnceleme · ${item.reviewer} · ${item.cli}</span></div>`;
    case "note":
      return html`<div class="text-small text-muted pl-[35px]">${item.text}</div>`;
    case "stop":
      return html`<div class="text-small text-muted pl-[35px]">Ajan bitti: ${item.reason}</div>`;
    case "triage": {
      const ok = item.decision === "proceed";
      const verdict = { proceed: "Devam (otonom)", needs_info: "Bilgi gerekli", needs_approval: "Onay gerekli" }[item.decision] ?? item.decision;
      const field = (l: string, v: string) => html`<div class="min-w-0"><div class="text-small text-muted">${l}</div><div class="text-body text-ink truncate">${v}</div></div>`;
      const md = [item.plan.length ? "**Plan**\n" + item.plan.map((p, i) => `${i + 1}. ${p}`).join("\n") : "",
        item.criteria.length ? "**Kabul kriterleri**\n" + item.criteria.map((c) => `- ${c}`).join("\n") : "",
        item.risks.length ? "**Riskler**\n" + item.risks.map((c) => `- ${c}`).join("\n") : "",
        item.questions.length ? "**Sorular**\n" + item.questions.map((q, i) => `${i + 1}. ${q}`).join("\n") : "",
        item.proposedVerify ? "**Önerilen doğrulama**\n```\n" + item.proposedVerify + "\n```" : ""].filter(Boolean).join("\n\n");
      const head = html`<div class="px-3.5 py-2 flex items-center justify-between gap-3"><div class="flex items-center gap-2 min-w-0"><span class="text-body font-medium text-ink flex-none">Triage</span><span class="pill ${ok ? "pill-neutral" : "pill-warning"}">${verdict}</span>${item.summary ? html`<span class="text-small text-muted truncate">${item.summary}</span>` : ""}</div>${chev()}</div>`;
      const body = html`<div class="border-t border-rule px-3.5 py-3"><div class="grid grid-cols-3 gap-4 mb-3">${field("Karar", verdict)}${field("Boyut", item.size)}${field("Plan adımı", String(item.plan.length))}</div><div class="text-body text-ink">${item.summary ? markdownEl(item.summary) : ""}${md ? markdownEl(md) : ""}</div></div>`;
      return row("list", ok ? "text-muted" : "text-warning", collapsible(key, head, [body]));
    }
    case "prompt": {
      const head = html`<div class="px-space-md py-2 bg-surface-container flex items-center justify-between font-code-sm text-code-sm"><span class="text-on-surface-variant">Prompt → ${item.role}${item.skills?.length ? " · Skills: " + item.skills.join(", ") : ""}</span><span class="material-symbols-outlined text-[16px] text-outline">expand_more</span></div>`;
      return row("note", "text-muted", collapsible(key, head, [pre(item.text, "text-soft")]));
    }
    case "message":
      return row("agent", "text-muted", said("Ajan", markdownEl(item.text, "message")));
    case "thought":
      return row("thought", "text-muted", said("Düşünce", markdownEl(item.text, "thought"), "text-soft"));
    case "tool": {
      const first = toolHint(item.input);
      const fail = item.status === "failed";
      const head = html`<div class="px-3.5 py-2 flex items-center justify-between gap-3 min-w-0"><div class="flex-1 flex items-baseline gap-2 min-w-0"><span class="text-body text-ink truncate">${item.title || item.toolKind || "tool"}</span>${first && first !== item.title ? html`<span class="num text-small text-muted truncate flex-1 min-w-0">${first}</span>` : ""}</div><div class="flex items-center gap-2.5 flex-none"><span class="text-small ${fail ? "text-negative" : "text-muted"}">${TOOL_STATUS[item.status] ?? item.status}</span>${chev()}</div></div>`;
      const out = item.output.length ? item.output : item.rawOutput ? [item.rawOutput] : [];
      if (item.id.startsWith("bridge-") && item.status === "completed") {
        const result = html`<div class="flex-1 min-w-0 rounded overflow-hidden bg-surface-container-low"></div>`;
        result.append(head, ...out.map(text => markdownEl(text, "bridge")));
        for (const link of result.querySelectorAll("a")) {
          link.addEventListener("click", () => {
            const url = link.getAttribute("href");
            if (url?.startsWith("https://linear.app/")) void invoke("open_url", { url });
          });
        }
        return row("terminal", "text-positive", result);
      }
      const body: Node[] = [];
      if (item.input) body.push(pre(item.input, "text-ink"));
      out.forEach((t) => body.push(pre(t)));
      item.diffs.forEach((d) => body.push(diffBlock(d)));
      return row("terminal", fail ? "text-negative" : "text-muted", collapsible(key, head, body));
    }
    case "permission":
      return html`<div class="pl-[35px] flex items-center gap-1.5 text-small ${item.granted ? "text-muted" : "text-negative"}">${icon("shield", 13)}${item.granted ? "İzin verildi" : "Reddedildi"}: ${item.title}</div>`;
    case "plan":
      return row("list", "text-muted", said("Plan", html`<ul class="list-disc pl-4">${item.entries.map((e) => html`<li>${e}</li>`)}</ul>`));
    case "verify":
      return row(item.ok ? "check" : "cross", item.ok ? "text-positive" : "text-negative",
        html`<div class="tl-card"><div class="px-3.5 py-2 flex items-baseline gap-2 min-w-0"><span class="text-body font-medium flex-none ${item.ok ? "text-ink" : "text-negative"}">${item.ok ? "Doğrulama geçti" : "Doğrulama başarısız"}</span>${item.command ? html`<span class="num text-small text-muted truncate">$ ${item.command}</span>` : ""}</div>${item.output ? pre(item.output) : ""}</div>`);
    case "findings": {
      const rows = item.findings.map((f) => {
        const where = f.file ? `${f.file}${f.line ? ":" + f.line : ""}` : "";
        const blocking = f.severity === "blocking";
        return html`<div class="flex items-start gap-2.5 px-3.5 py-2 border-t border-rule"><span class="pill ${blocking ? "pill-negative" : "pill-neutral"}">${blocking ? "Engelleyici" : f.severity === "minor" ? "Küçük" : f.severity}</span><div class="min-w-0 text-body text-ink">${where ? html`<span class="num text-small text-soft mr-1.5">${where}</span>` : ""}${f.text}</div></div>`;
      });
      const empty = !item.parsed ? "Yanıtta okunabilir bulgu bloğu yok; zorlanmadı." : !rows.length ? "Bulgu yok." : "";
      return row("review", item.findings.some((f) => f.severity === "blocking") ? "text-negative" : "text-muted", html`<div class="tl-card"><div class="px-3.5 py-2 text-body font-medium text-ink">${item.reviewer}</div>${empty ? html`<div class="px-3.5 py-2 border-t border-rule text-small text-muted">${empty}</div>` : ""}${rows}</div>`);
    }
    case "deliver": {
      const title = !item.ok ? "Teslim başarısız" : item.url ? (item.draft ? "Draft PR açıldı" : "PR açıldı") : "Teslim edilecek bir şey yok";
      return row("deliver", item.ok ? "text-positive" : "text-negative", html`<div class="tl-card"><div class="px-3.5 py-2 flex items-center justify-between gap-3"><span class="text-body font-medium ${item.ok ? "text-ink" : "text-negative"}">${title}</span>${item.url ? html`<button data-act="open-url" data-url="${item.url}" class="link flex items-center gap-1.5">Aç${icon("external", 12)}</button>` : ""}</div>${item.url || item.note ? pre([item.url, item.note].filter(Boolean).join("\n")) : ""}</div>`);
    }
    case "error":
      return row("warn", "text-negative", html`<div class="tl-card px-3.5 py-2.5"><div class="text-body font-medium text-negative">Ajan hatası</div><div class="num text-small text-soft mt-0.5 break-words">${item.error}</div></div>`);
  }
}

function visible(item: Item): boolean {
  if (ui.hideThoughts && item.kind === "thought") return false;
  if (ui.itemFilter === "tools") return item.kind === "tool";
  if (ui.itemFilter === "errors") {
    return item.kind === "error" || (item.kind === "verify" && !item.ok) || (item.kind === "permission" && !item.granted)
      || (item.kind === "deliver" && !item.ok) || (item.kind === "findings" && item.findings.some((f) => f.severity === "blocking"));
  }
  return true;
}

function detailPane(prevScroll: { top: number; atBottom: boolean } | null): HTMLElement {
  const run = ui.selected ? runs.get(ui.selected) : undefined;
  if (!run) return html`<section class="pane-main items-center justify-center text-muted text-body">Bir run seçin.</section>`;
  const st = SHOWN_STYLE[shown(run)];
  const pr = prUrl(run);
  const count = (f: "all" | "errors" | "tools") => run.items.filter((i) => (f === "all" ? true : f === "tools" ? i.kind === "tool" : visibleOnly("errors", i))).length;
  const filt = (f: "all" | "errors" | "tools", name: string) => html`<button data-act="item-filter" data-f="${f}" class="tab ${ui.itemFilter === f ? "active" : ""}" aria-pressed="${ui.itemFilter === f ? "true" : "false"}">${name}<span class="n">${count(f)}</span></button>`;
  const sec = html`<section class="pane-main" aria-label="Run ayrıntısı">
    <div class="px-6 pt-4 flex flex-col gap-3.5 border-b border-border flex-none">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-section text-ink truncate" title="${run.title}">${plainTitle(run)}</h2>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-small text-muted">
            <span class="num text-soft">${shortId(run)}</span>
            <span class="pill ${st.pill}">${run.status === "running" ? html`<span class="dot live"></span>` : ""}${st.label}</span>
            ${run.role ? html`<span>${run.role}</span>` : ""}
            <span class="num">${elapsed(run)}</span>
            <span class="num truncate">${run.id}</span>
          </div>
        </div>
        ${pr ? html`<button data-act="open-url" data-url="${pr}" class="btn btn-primary">${icon("merge", 14)}PR'ı aç</button>` : ""}
      </div>
      ${stepper(run)}
      <div class="flex flex-wrap-reverse items-end justify-between gap-x-4 -mb-px">
        <div class="tabs !border-0 min-w-0">${filt("all", "Tüm olaylar")}${filt("errors", "Hatalar")}${filt("tools", "Araçlar")}</div>
        <div class="flex items-center gap-4 h-[34px] flex-none">
          <button data-act="toggle-thoughts" class="link" aria-pressed="${ui.hideThoughts ? "true" : "false"}">${ui.hideThoughts ? "Düşünceleri göster" : "Düşünceleri gizle"}</button>
          <button data-act="to-live" class="link flex items-center gap-1">${icon("down", 12)}Canlıya git</button>
        </div>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3.5 relative" id="timelineScrollArea"></div>
  </section>`;
  const area = sec.querySelector("#timelineScrollArea") as HTMLElement;
  let shownItems = 0;
  run.items.forEach((item, i) => { if (visible(item)) { const r = itemRow(item, `${run.id}:${i}`); if (r) { area.append(r); shownItems++; } } });
  if (!shownItems) area.append(html`<p class="empty !m-0">${ui.itemFilter === "errors" ? "Bu run'da hata yok." : ui.itemFilter === "tools" ? "Bu run'da araç çağrısı yok." : "Henüz olay yok."}</p>`);
  queueMicrotask(() => { area.scrollTop = prevScroll && !prevScroll.atBottom ? prevScroll.top : area.scrollHeight; });
  return sec;
}
function visibleOnly(_: "errors", item: Item): boolean {
  return item.kind === "error" || (item.kind === "verify" && !item.ok) || (item.kind === "permission" && !item.granted)
    || (item.kind === "deliver" && !item.ok) || (item.kind === "findings" && item.findings.some((f) => f.severity === "blocking"));
}

export function runsPage(): HTMLElement {
  const old = document.getElementById("timelineScrollArea");
  const prev = old ? { top: old.scrollTop, atBottom: old.scrollHeight - old.scrollTop - old.clientHeight < 40 } : null;
  const wrap = html`<div class="panes"></div>`;
  wrap.append(listPane(), detailPane(prev));
  return wrap;
}
