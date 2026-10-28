// Runs screen: design/runs_zaman_izgisi_y_r_tme.
import { act, html } from "../tpl.ts";
import { markdownEl } from "../markdown.ts";
import type { Item, Run, ToolDiff } from "../runModel.ts";
import { SHOWN_STYLE, STAGES, elapsed, prUrl, runs, schedule, shown, shortId, sortedRuns, stageIcon, stageOf, ui } from "../state.ts";

// The detail pane is rebuilt on every event, so remember which <details> the user opened.
const openKeys = new Set<string>();

act("pick-run", (el) => { ui.selected = el.dataset.id!; ui.following = false; schedule(); });
act("status-cycle", () => {
  const order = ["all", "running", "review", "needs_human"] as const;
  ui.statusFilter = order[(order.indexOf(ui.statusFilter) + 1) % order.length];
  schedule();
});
act("reset-filters", () => { ui.query = ""; ui.statusFilter = "all"; schedule(); });
act("item-filter", (el) => { ui.itemFilter = el.dataset.f as typeof ui.itemFilter; schedule(); });
act("toggle-thoughts", () => { ui.hideThoughts = !ui.hideThoughts; schedule(); });
act("to-live", () => document.getElementById("timelineScrollArea")?.scrollTo({ top: 1e9, behavior: "smooth" }));

const STATUS_NAME = { all: "Tümü", running: "Çalışan", review: "İncelemede", needs_human: "İnsan" } as const;

function runCard(r: Run): HTMLElement {
  const st = SHOWN_STYLE[shown(r)];
  const sel = r.id === ui.selected;
  const stage = STAGES[Math.max(stageOf(r), 0)];
  const pr = prUrl(r);
  return html`<div data-act="pick-run" data-id="${r.id}" class="p-space-sm rounded cursor-pointer transition-all flex flex-col gap-1.5 ${sel ? "bg-surface-container-high shadow-md" : "hover:bg-surface-container/70 bg-surface-container-low/40"}">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5 min-w-0">
        ${r.status === "running"
          ? html`<span class="relative flex h-2 w-2 flex-shrink-0"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span></span>`
          : html`<span class="h-2 w-2 rounded-full flex-shrink-0 ${st.dot}"></span>`}
        <span class="font-code-lg text-code-lg ${sel ? "text-primary font-semibold" : "text-on-surface font-medium"} tracking-tight truncate">${shortId(r)}</span>
        <span class="px-1.5 py-0.2 rounded font-label-sm text-label-sm flex-shrink-0 ${st.chip}">${st.label}</span>
      </div>
      <span class="font-code-sm text-code-sm text-on-surface-variant flex items-center gap-1 flex-shrink-0"><span class="material-symbols-outlined text-[12px]">timer</span>${elapsed(r)}</span>
    </div>
    <h4 class="font-body-md text-body-md ${sel ? "text-on-surface font-medium" : "text-on-surface-variant font-normal"} leading-snug line-clamp-2">${r.title}</h4>
    <div class="flex items-center justify-between pt-1 font-code-sm text-code-sm ${sel ? "text-on-surface-variant" : "text-outline"}">
      <div class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px] ${sel ? "text-primary" : ""}">smart_toy</span><span class="${sel ? "text-on-surface" : ""}">${r.role || "—"}</span></div>
      <div class="flex items-center gap-2">${pr ? html`<span class="text-secondary font-medium">PR hazır</span>` : html`<span class="${r.status === "running" ? "text-secondary font-medium" : ""}">${stage[0] + stage.slice(1).toLowerCase()}</span>`}<span>•</span><span>${r.items.length} olay</span></div>
    </div>
  </div>`;
}

function listPane(): HTMLElement {
  const list = sortedRuns().filter((r) => (ui.statusFilter === "all" || r.status === ui.statusFilter)
    && (!ui.query || `${r.title} ${r.id} ${r.role}`.toLowerCase().includes(ui.query)));
  const running = sortedRuns().filter((r) => r.status === "running").length;
  const pane = html`<aside class="w-[360px] flex-shrink-0 flex flex-col bg-surface-container-lowest select-none">
    <div class="p-space-md flex flex-col gap-space-sm bg-surface-container-low/60 shadow-sm">
      <div class="relative flex items-center">
        <span class="material-symbols-outlined absolute left-2.5 text-on-surface-variant text-[16px] pointer-events-none">search</span>
        <input id="run-search" value="${ui.query}" class="w-full h-8 pl-8 pr-8 rounded bg-surface text-on-surface placeholder:text-outline font-body-sm text-body-sm focus:outline-none focus:bg-surface-container transition-colors" placeholder="Görev no, başlık veya rol ara..." type="text"/>
      </div>
      <div class="flex items-center gap-1.5">
        <button data-act="status-cycle" class="flex-1 h-7 px-2 rounded bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-between font-label-sm text-label-sm transition-colors">
          <span class="flex items-center gap-1.5 truncate"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span><span>Durum: ${STATUS_NAME[ui.statusFilter]}</span></span>
          <span class="material-symbols-outlined text-[14px] text-outline">expand_more</span>
        </button>
        <button data-act="reset-filters" class="h-7 w-7 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors" title="Filtreleri Sıfırla"><span class="material-symbols-outlined text-[14px]">filter_list_off</span></button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto flex flex-col p-1.5 gap-1" id="run-list"></div>
    <div class="p-space-sm bg-surface-container-low/80 flex items-center justify-between font-label-sm text-label-sm text-outline">
      <span>${list.length} / ${sortedRuns().length} Run</span>
      <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> ${running} Koşuyor</span>
    </div>
  </aside>`;
  const box = pane.querySelector("#run-list")!;
  if (!list.length) box.append(html`<p class="p-space-md text-outline font-body-sm text-body-sm">${sortedRuns().length ? "Filtreye uyan run yok." : "Henüz run yok. Servis çalışınca burada görünür."}</p>`);
  list.forEach((r) => box.append(runCard(r)));
  (pane.querySelector("#run-search") as HTMLInputElement).oninput = (e) => {
    ui.query = (e.target as HTMLInputElement).value.toLowerCase();
    schedule();
  };
  return pane;
}

// ---- timeline items ----
function rail(bg: string, icon: string, line = true): HTMLElement {
  return html`<div class="flex flex-col items-center flex-shrink-0"><div class="w-6 h-6 rounded-full flex items-center justify-center ${bg}"><span class="material-symbols-outlined text-[14px]">${icon}</span></div>${line ? html`<div class="w-0.5 h-full bg-surface-container-high my-1"></div>` : ""}</div>`;
}
function row(bg: string, icon: string, card: Node): HTMLElement {
  return html`<div class="flex gap-3 relative">${rail(bg, icon)}${card}</div>`;
}
function collapsible(key: string, head: HTMLElement, body: Node[], cls: string): HTMLElement {
  const d = html`<details class="flex-1 min-w-0 rounded shadow-sm overflow-hidden ${cls}"><summary class="list-none cursor-pointer"></summary></details>` as HTMLDetailsElement;
  d.querySelector("summary")!.append(head);
  d.open = openKeys.has(key);
  d.ontoggle = () => void (d.open ? openKeys.add(key) : openKeys.delete(key));
  d.append(...body);
  return d;
}
const pre = (text: string, cls = "") => html`<pre class="px-space-md py-space-sm font-code-sm text-code-sm whitespace-pre-wrap break-words max-h-80 overflow-auto ${cls}">${text}</pre>`;
const label = (t: string) => html`<span class="font-label-sm text-label-sm text-outline uppercase">${t}</span>`;

function diffBlock(d: ToolDiff): HTMLElement {
  const lines = (t: string, m: "+" | "-") => (t ? t.split("\n").map((l) => ({ m, l })) : []);
  const rows = [...lines(d.oldText, "-"), ...lines(d.newText, "+")];
  const add = rows.filter((r) => r.m === "+").length, del = rows.length - add;
  return html`<div class="bg-[#090a0d]">
    <div class="px-space-md py-2 bg-surface-container flex items-center gap-2 min-w-0">
      <span class="material-symbols-outlined text-[16px] text-primary">description</span>
      <span class="font-code-md text-code-md text-on-surface font-medium truncate">${d.path}</span>
      <span class="px-1.5 py-0.2 rounded bg-surface-container-highest text-secondary font-code-sm text-code-sm">+${add}</span>
      <span class="px-1.5 py-0.2 rounded bg-surface-container-highest text-error font-code-sm text-code-sm">-${del}</span>
    </div>
    <div class="font-code-sm text-code-sm overflow-x-auto select-text">${rows.map((r) => html`<div class="flex items-center py-0.5 px-2 ${r.m === "+" ? "bg-secondary-container/20 text-secondary" : "bg-error-container/20 text-error"}"><span class="w-4 select-none font-bold">${r.m}</span><span class="pl-2 whitespace-pre">${r.l}</span></div>`)}</div>
  </div>`;
}

export function itemRow(item: Item, key: string): HTMLElement | null {
  switch (item.kind) {
    case "user":
      return html`<div class="flex justify-end"><div class="max-w-[80%] rounded bg-primary-container/30 text-on-surface p-space-md font-body-md text-body-md whitespace-pre-wrap">${item.text}</div></div>`;
    case "attempt":
      return html`<div class="flex items-center gap-2 pt-space-sm"><div class="h-px flex-1 bg-outline-variant/30"></div><span class="font-label-md text-label-md text-outline uppercase">Attempt ${item.n} · ${item.role} · ${item.cli}</span><div class="h-px flex-1 bg-outline-variant/30"></div></div>`;
    case "stage":
      return html`<div class="flex items-center gap-2"><div class="h-px flex-1 bg-outline-variant/30"></div><span class="font-label-md text-label-md text-outline uppercase">${item.label}</span><div class="h-px flex-1 bg-outline-variant/30"></div></div>`;
    case "review":
      return html`<div class="flex items-center gap-2"><div class="h-px flex-1 bg-outline-variant/30"></div><span class="font-label-md text-label-md text-outline uppercase">Review · ${item.reviewer} · ${item.cli}</span><div class="h-px flex-1 bg-outline-variant/30"></div></div>`;
    case "note":
      return html`<div class="font-code-sm text-code-sm text-outline pl-9">${item.text}</div>`;
    case "stop":
      return html`<div class="font-code-sm text-code-sm text-outline pl-9">Ajan bitti: ${item.reason}</div>`;
    case "triage": {
      const ok = item.decision === "proceed";
      const verdict = { proceed: "Devam (otonom)", needs_info: "Bilgi gerekli", needs_approval: "Onay gerekli" }[item.decision] ?? item.decision;
      const field = (l: string, v: string, cls = "text-on-surface") => html`<div class="flex flex-col gap-0.5"><span class="font-label-sm text-label-sm text-outline uppercase">${l}</span><span class="font-body-md text-body-md ${cls}">${v}</span></div>`;
      const md = [item.plan.length ? "**Plan**\n" + item.plan.map((p, i) => `${i + 1}. ${p}`).join("\n") : "",
        item.criteria.length ? "**Kabul kriterleri**\n" + item.criteria.map((c) => `- ${c}`).join("\n") : "",
        item.risks.length ? "**Riskler**\n" + item.risks.map((c) => `- ${c}`).join("\n") : "",
        item.questions.length ? "**Sorular**\n" + item.questions.map((q, i) => `${i + 1}. ${q}`).join("\n") : "",
        item.proposedVerify ? "**Önerilen doğrulama**\n```\n" + item.proposedVerify + "\n```" : ""].filter(Boolean).join("\n\n");
      const head = html`<div class="p-space-sm bg-surface-container/70 flex items-center justify-between"><div class="flex items-center gap-2"><span class="font-label-md text-label-md ${ok ? "text-secondary" : "text-tertiary"}">STAGE_TRIAGE_${item.decision.toUpperCase()}</span></div><span class="material-symbols-outlined text-[16px] text-outline">expand_more</span></div>`;
      const body = html`<div class="bg-surface-container-low"><div class="p-space-md grid grid-cols-3 gap-space-md font-body-sm text-body-sm">${field("Karar", verdict, ok ? "text-secondary" : "text-tertiary")}${field("Boyut", item.size)}${field("Plan adımı", String(item.plan.length))}</div><div class="px-space-md pb-space-md text-on-surface">${item.summary ? markdownEl(item.summary) : ""}${md ? markdownEl(md) : ""}</div></div>`;
      return row(ok ? "bg-secondary-container/20 text-secondary" : "bg-tertiary/20 text-tertiary", "checklist", collapsible(key, head, [body], "bg-surface-container-low"));
    }
    case "prompt": {
      const head = html`<div class="px-space-md py-2 bg-surface-container flex items-center justify-between font-code-sm text-code-sm"><span class="text-on-surface-variant">Prompt → ${item.role}</span><span class="material-symbols-outlined text-[16px] text-outline">expand_more</span></div>`;
      return row("bg-surface-container-highest text-on-surface", "notes", collapsible(key, head, [pre(item.text, "text-on-surface-variant")], "bg-surface-container-lowest"));
    }
    case "message":
      return row("bg-primary-container text-on-primary-container", "smart_toy", html`<div class="flex-1 min-w-0 rounded bg-surface-container-low/70 p-space-md flex flex-col gap-1.5 shadow-sm"><span class="font-label-md text-label-md text-primary font-medium">ACP::AgentMessage</span><div class="font-body-md text-body-md text-on-surface leading-relaxed">${markdownEl(item.text, "message")}</div></div>`);
    case "thought":
      return row("bg-primary-container text-on-primary-container", "psychology", html`<div class="flex-1 min-w-0 rounded bg-surface-container-low/70 p-space-md flex flex-col gap-1.5 shadow-sm"><span class="font-label-md text-label-md text-primary font-medium">ACP::AgentReasoning</span><div class="font-body-md text-body-md text-on-surface-variant italic bg-surface-container-lowest/60 p-2.5 rounded">${markdownEl(item.text, "thought")}</div></div>`);
    case "tool": {
      const first = item.input.split("\n")[0].slice(0, 100);
      const done = item.status === "completed", fail = item.status === "failed";
      const head = html`<div class="px-space-md py-2 bg-surface-container flex items-center justify-between font-code-sm text-code-sm"><div class="flex items-center gap-2 min-w-0"><span class="material-symbols-outlined text-[14px] ${fail ? "text-error" : "text-secondary"}">${fail ? "error" : done ? "check_circle" : "play_arrow"}</span><span class="${fail ? "text-error" : "text-secondary"} font-medium">tool_call:</span><span class="text-on-surface flex-shrink-0">${item.title || item.toolKind || "tool"}</span><span class="text-on-surface-variant truncate">${first}</span></div><div class="flex items-center gap-3 flex-shrink-0"><span class="text-outline">${item.status}</span><span class="material-symbols-outlined text-[16px] text-outline">expand_more</span></div></div>`;
      const out = item.output.length ? item.output : item.rawOutput ? [item.rawOutput] : [];
      const body: Node[] = [];
      if (item.input) body.push(pre(item.input, "text-primary"));
      out.forEach((t) => body.push(pre(t, "text-on-surface-variant")));
      item.diffs.forEach((d) => body.push(diffBlock(d)));
      return row(fail ? "bg-error-container/30 text-error" : "bg-surface-container-highest text-on-surface", "terminal", collapsible(key, head, body, "bg-surface-container-lowest"));
    }
    case "permission":
      return html`<div class="pl-9 flex items-center gap-1.5 font-code-sm text-code-sm ${item.granted ? "text-secondary" : "text-error"}"><span class="material-symbols-outlined text-[13px]">${item.granted ? "lock_open" : "block"}</span>${item.granted ? "izin verildi" : "reddedildi"}: ${item.title}</div>`;
    case "plan":
      return row("bg-surface-container-highest text-on-surface", "list", html`<ul class="flex-1 min-w-0 rounded bg-surface-container-low/70 p-space-md font-body-md text-body-md text-on-surface list-disc pl-8">${item.entries.map((e) => html`<li>${e}</li>`)}</ul>`);
    case "verify":
      return row(item.ok ? "bg-secondary-container/30 text-secondary" : "bg-error-container/30 text-error", item.ok ? "verified" : "gpp_bad",
        html`<div class="flex-1 min-w-0 rounded bg-surface-container-lowest shadow-sm overflow-hidden"><div class="px-space-md py-2 bg-surface-container font-label-md text-label-md ${item.ok ? "text-secondary" : "text-error"}">${item.ok ? "VERIFY PASSED" : "VERIFY FAILED"}${item.command ? html`<span class="font-code-sm text-code-sm text-on-surface-variant ml-2 normal-case">$ ${item.command}</span>` : ""}</div>${item.output ? pre(item.output, "text-on-surface-variant") : ""}</div>`);
    case "findings": {
      const rows = item.findings.map((f) => {
        const where = f.file ? `${f.file}${f.line ? ":" + f.line : ""}` : "";
        const blocking = f.severity === "blocking";
        return html`<div class="flex gap-2 px-space-md py-1.5 border-l-2 ${blocking ? "border-error" : "border-tertiary"}"><span class="font-label-sm text-label-sm uppercase flex-shrink-0 ${blocking ? "text-error" : "text-tertiary"}">${f.severity}</span><span class="font-body-sm text-body-sm text-on-surface">${where ? where + " · " : ""}${f.text}</span></div>`;
      });
      const empty = !item.parsed ? "Yanıtta okunabilir bulgu bloğu yok; zorlanmadı." : !rows.length ? "Bulgu yok." : "";
      return row("bg-tertiary-container/30 text-tertiary", "rate_review", html`<div class="flex-1 min-w-0 rounded bg-surface-container-low shadow-sm overflow-hidden"><div class="px-space-md py-1.5 bg-surface-container font-label-md text-label-md text-tertiary">${item.reviewer.toUpperCase()}</div>${empty ? html`<div class="px-space-md py-2 font-body-sm text-body-sm text-outline">${empty}</div>` : ""}${rows}</div>`);
    }
    case "deliver": {
      const title = !item.ok ? "Teslim başarısız" : item.url ? (item.draft ? "Draft PR" : "PR açıldı") : "Teslim edilecek bir şey yok";
      return row(item.ok ? "bg-secondary text-on-secondary" : "bg-error-container/30 text-error", "rocket_launch", html`<div class="flex-1 min-w-0 rounded bg-surface-container-low shadow-sm p-space-md"><div class="font-label-md text-label-md ${item.ok ? "text-secondary" : "text-error"} uppercase">${title}</div>${pre([item.url, item.note].filter(Boolean).join("\n"), "text-on-surface-variant px-0")}</div>`);
    }
    case "error":
      return row("bg-error-container/30 text-error", "error", html`<div class="flex-1 min-w-0 rounded bg-error-container/20 p-space-md font-code-sm text-code-sm text-error">Ajan hatası: ${item.error}</div>`);
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
  if (!run) return html`<section class="flex-1 flex items-center justify-center bg-surface text-outline font-body-md text-body-md">Bir run seçin.</section>`;
  const st = SHOWN_STYLE[shown(run)];
  const at = stageOf(run);
  const pr = prUrl(run);
  const errors = run.items.filter((i) => !(visibleOnly("errors", i))).length;
  const count = (f: "all" | "errors" | "tools") => run.items.filter((i) => (f === "all" ? true : f === "tools" ? i.kind === "tool" : visibleOnly("errors", i))).length;
  void errors;
  const chipCls = (on: boolean) => on ? "bg-surface-container-high text-on-surface" : "bg-surface-container/60 hover:bg-surface-container text-on-surface-variant transition-colors";
  const filt = (f: "all" | "errors" | "tools", name: string) => html`<button data-act="item-filter" data-f="${f}" class="px-2.5 py-0.5 rounded font-label-sm text-label-sm ${chipCls(ui.itemFilter === f)}">${name} (${count(f)})</button>`;
  const steps = STAGES.map((name, i) => {
    const active = run.status === "running" && i === at, done = i <= at && !active;
    const cls = active ? "bg-secondary text-on-secondary shadow-sm px-2.5" : done ? "bg-secondary-container/15 text-secondary px-2" : "bg-surface-container text-outline px-2";
    return html`<div class="flex items-center gap-2"><div class="flex items-center gap-1.5 py-1 rounded font-label-md text-label-md ${cls}">${active ? html`<span class="w-2 h-2 rounded-full bg-on-secondary animate-ping"></span>` : html`<span class="material-symbols-outlined text-[14px]">${done ? "check_circle" : stageIcon(i)}</span>`}<span>${i + 1}. ${name}${active ? " (AKTİF)" : ""}</span></div>${i < STAGES.length - 1 ? html`<span class="material-symbols-outlined text-outline-variant text-[14px]">chevron_right</span>` : ""}</div>`;
  });
  const sec = html`<section class="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
    <div class="flex flex-col bg-surface-container-low/40 shadow-sm">
      <div class="h-12 px-space-lg flex items-center justify-between gap-space-md">
        <div class="flex items-center gap-3 min-w-0">
          <span class="font-headline-md text-headline-md text-on-surface tracking-tight font-semibold flex items-center gap-2 truncate"><span class="text-primary font-code-lg">${shortId(run)}</span><span class="truncate">${run.title}</span></span>
          <span class="flex-shrink-0 px-2 py-0.5 rounded font-label-sm text-label-sm flex items-center gap-1 ${st.chip}">${run.status === "running" ? html`<span class="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>` : ""}${run.status === "running" ? `AKTİF ADIM: ${STAGES[Math.max(at, 0)]}` : st.label}</span>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">${pr ? html`<span class="h-7 px-2.5 rounded bg-surface-container text-on-surface font-body-sm text-body-sm flex items-center gap-1.5"><span class="material-symbols-outlined text-[14px]">merge</span>PR hazır</span>` : ""}</div>
      </div>
      <div class="px-space-lg py-2 flex items-center gap-2 bg-surface-container-lowest/50 overflow-x-auto">${steps}</div>
      <div class="px-space-lg py-2 flex items-center justify-between bg-surface-container-low/20">
        <div class="flex items-center gap-1.5">${filt("all", "Tüm Olaylar")}${filt("errors", "Yalnızca Hatalar")}${filt("tools", "Araç Çağrıları")}<button data-act="toggle-thoughts" class="px-2.5 py-0.5 rounded font-label-sm text-label-sm ${chipCls(ui.hideThoughts)}">Düşünceleri Gizle</button></div>
        <div class="flex items-center gap-2"><span class="font-code-sm text-code-sm text-outline">${run.id}</span><button data-act="to-live" class="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-secondary font-label-sm text-label-sm flex items-center gap-1 transition-colors"><span class="material-symbols-outlined text-[12px]">vertical_align_bottom</span><span>Canlıya Git</span></button></div>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-space-lg flex flex-col gap-space-lg relative" id="timelineScrollArea"></div>
  </section>`;
  const area = sec.querySelector("#timelineScrollArea") as HTMLElement;
  run.items.forEach((item, i) => { if (visible(item)) { const r = itemRow(item, `${run.id}:${i}`); if (r) area.append(r); } });
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
  const wrap = html`<div class="flex h-[calc(100vh-2.5rem)] w-full overflow-hidden bg-surface-container-lowest"></div>`;
  wrap.append(listPane(), detailPane(prev));
  return wrap;
}
