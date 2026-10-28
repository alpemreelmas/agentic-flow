// Overview screen: design/genel_bak_sabah_ekran, filled from run logs only.
import { act, html } from "../tpl.ts";
import { SHOWN_STYLE, ago, hasError, prUrl, schedule, shortId, shown, sortedRuns, ui } from "../state.ts";
import type { Run } from "../runModel.ts";

act("open-run", (el) => { ui.selected = el.dataset.id!; ui.following = false; ui.page = "runs"; schedule(); });

const today = () => new Date().setHours(0, 0, 0, 0) / 1000;

function card(label: string, n: number, icon: string, tone: string, sub: string): HTMLElement {
  return html`<div class="p-space-md rounded bg-surface-container-low hover:bg-surface-container transition-colors shadow-sm">
    <div class="flex items-start justify-between">
      <div class="flex flex-col gap-1">
        <span class="font-label-sm text-label-sm uppercase ${tone === "text-secondary" || tone === "text-primary" ? "text-outline" : tone}">${label}</span>
        <span class="font-headline-lg text-headline-lg ${tone === "text-secondary" || tone === "text-primary" ? "text-on-surface" : tone} font-semibold tracking-tight">${n}</span>
      </div>
      <div class="w-8 h-8 rounded bg-surface-container-high flex items-center justify-center ${tone}"><span class="material-symbols-outlined text-[18px]">${icon}</span></div>
    </div>
    <div class="mt-3 pt-2 font-code-sm text-code-sm text-on-surface-variant truncate">${sub}</div>
  </div>`;
}

function runRow(r: Run): HTMLElement {
  const st = SHOWN_STYLE[shown(r)];
  const last = r.items.length ? "" : "";
  void last;
  return html`<div data-act="open-run" data-id="${r.id}" class="p-space-md rounded bg-surface-container-low hover:bg-surface-container transition-all shadow-sm flex items-center gap-3 cursor-pointer">
    <span class="h-2 w-2 rounded-full flex-shrink-0 ${st.dot}"></span>
    <span class="font-code-sm text-code-sm text-secondary font-medium flex-shrink-0">${shortId(r)}</span>
    <span class="font-headline-sm text-headline-sm text-on-surface truncate flex-1">${r.title}</span>
    <span class="px-1.5 py-0.5 rounded font-label-sm text-label-sm ${st.chip}">${st.label}</span>
    <span class="font-code-sm text-code-sm text-outline flex-shrink-0">${ago(r.endedAt ?? r.startedAt)} önce</span>
  </div>`;
}

export function overviewPage(): HTMLElement {
  const all = sortedRuns();
  const done = all.filter((r) => r.status === "review" && (r.endedAt ?? 0) >= today());
  const prs = all.filter((r) => prUrl(r));
  const human = all.filter((r) => r.status === "needs_human" && !hasError(r));
  const failed = all.filter((r) => hasError(r));
  const running = all.filter((r) => r.status === "running");
  const attention = all.filter((r) => r.status === "needs_human");
  const page = html`<div class="flex flex-col w-full">
    <div class="relative px-space-xl pt-space-lg pb-space-md bg-surface-container-lowest overflow-hidden">
      <div class="absolute -top-24 right-1/4 w-96 h-36 bg-primary-container/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="flex flex-wrap items-center justify-between gap-space-md relative z-10">
        <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full ${ui.service.running ? "bg-secondary animate-pulse" : "bg-outline"}"></span><span class="font-headline-md text-headline-md text-on-surface tracking-tight">Genel Bakış</span><span class="font-code-sm text-code-sm text-on-surface-variant px-1.5 py-0.5 rounded bg-surface-container-high">Morning Sync</span></div>
        <div class="flex items-center gap-space-sm px-2.5 py-1 rounded bg-surface-container-low text-on-surface-variant font-code-sm text-code-sm shadow-sm"><span class="material-symbols-outlined text-[14px] text-secondary">update</span><span>${ui.service.running ? ui.service.detail || ui.service.phase : "servis kapalı"}</span></div>
      </div>
      <p class="mt-2 text-on-surface-variant font-body-sm text-body-sm flex items-center gap-1.5"><span class="text-secondary font-code-sm text-code-sm">●</span>${running.length} run aktif çalışıyor.</p>
    </div>
    <div class="px-space-xl py-space-lg"><div id="cards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md"></div></div>
    <div class="px-space-xl pb-space-xl flex flex-col gap-space-md">
      <div class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px] text-tertiary">priority_high</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Dikkat Gerekiyor</h2><span class="font-code-sm text-code-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">${attention.length} Beklemede</span></div>
      <div id="attention" class="flex flex-col gap-space-sm"></div>
      <div class="flex items-center gap-2 pt-space-md"><span class="material-symbols-outlined text-[18px] text-outline">history</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Son Aktivite Akışı</h2><span class="font-code-sm text-code-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">Canlı JSONL</span></div>
      <div id="recent" class="flex flex-col gap-space-sm"></div>
    </div>
  </div>`;
  page.querySelector("#cards")!.append(
    card("Bugün Biten", done.length, "task_alt", "text-secondary", `${all.length} run kayıtlı`),
    card("PR Açılan", prs.length, "merge", "text-primary", `${prs.filter((r) => r.items.some((i) => i.kind === "deliver" && i.draft)).length} draft`),
    card("İnsan Bekleyen", human.length, "shield_person", "text-tertiary", human[0]?.title ?? "—"),
    card("Hata Veren", failed.length, "error", "text-error", failed[0]?.title ?? "—"));
  const att = page.querySelector("#attention")!;
  if (!attention.length) att.append(html`<p class="text-outline font-body-sm text-body-sm">İnsan bekleyen run yok.</p>`);
  attention.forEach((r) => att.append(runRow(r)));
  const rec = page.querySelector("#recent")!;
  if (!all.length) rec.append(html`<p class="text-outline font-body-sm text-body-sm">Henüz run yok.</p>`);
  all.slice(0, 10).forEach((r) => rec.append(runRow(r)));
  return page;
}
