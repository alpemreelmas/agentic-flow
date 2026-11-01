// Overview screen: what is waiting on a person, and where the runs stand on the loop. Filled from run logs only.
import { act, html } from "../tpl.ts";
import { mini } from "../pipeline.ts";
import { SHOWN_STYLE, STAGES, ago, hasError, plainTitle, prUrl, schedule, shortId, shown, sortedRuns, stageOf, ui } from "../state.ts";
import type { Run } from "../runModel.ts";
import { setupPanel } from "../health.ts";

act("open-run", (el) => { ui.selected = el.dataset.id!; ui.following = false; ui.page = "runs"; schedule(); });

const today = () => new Date().setHours(0, 0, 0, 0) / 1000;

/** Why a run stopped, in one line, from the event that stopped it. */
function waitingReason(r: Run): string {
  for (const i of [...r.items].reverse()) {
    if (i.kind === "error") return i.error;
    if (i.kind === "deliver" && !i.ok) return i.note || "Teslim başarısız";
    if (i.kind === "verify" && !i.ok) return `Doğrulama başarısız: ${i.command}`;
    if (i.kind === "triage" && i.decision !== "proceed") {
      const what = i.decision === "needs_info" ? "Bilgi gerekli" : "Onay gerekli";
      return i.summary ? `${what}: ${i.summary}` : what;
    }
  }
  return "İnsan kararı bekliyor";
}

const pill = (r: Run) => {
  const st = SHOWN_STYLE[shown(r)];
  return html`<span class="pill ${st.pill}">${st.label}</span>`;
};

function runRow(r: Run): HTMLElement {
  return html`<div data-act="open-run" data-id="${r.id}" class="run-row">
    <span class="id-cell num text-body text-soft truncate">${shortId(r)}</span>
    <span class="title-cell text-body text-ink truncate">${plainTitle(r)}</span>
    ${mini(r)}
    <span class="justify-self-start">${pill(r)}</span>
    <span class="age-cell num text-small text-muted text-right whitespace-nowrap">${ago(r.endedAt ?? r.startedAt)}</span>
  </div>`;
}

function attentionRow(r: Run): HTMLElement {
  return html`<div data-act="open-run" data-id="${r.id}" class="run-row tall">
    <span class="id-cell num text-body text-soft truncate">${shortId(r)}</span>
    <div class="title-cell min-w-0"><div class="text-body text-ink truncate">${plainTitle(r)}</div><div class="text-small text-muted truncate">${waitingReason(r)}</div></div>
    <span class="justify-self-start">${pill(r)}</span>
    <button data-act="open-run" data-id="${r.id}" class="btn btn-sm">İncele</button>
  </div>`;
}

function kpi(label: string, n: number, sub: string): HTMLElement {
  return html`<div class="kpi"><div class="min-w-0"><div class="text-body text-soft truncate">${label}</div><div class="text-small text-muted truncate" title="${sub}">${sub}</div></div><div class="num text-section !font-normal ${n ? "text-ink" : "text-muted"}">${n}</div></div>`;
}

/** The loop line as a board: each run sits at the furthest stage it reached. */
function board(all: Run[]): HTMLElement {
  const box = html`<section class="panel" aria-labelledby="board-title">
    <div class="panel-head"><h2 id="board-title" class="text-card text-ink">Döngü hattı</h2><span class="text-small text-muted">Her run ulaştığı son aşamada, <span class="num">${all.length}</span> run</span></div>
    <div class="board"></div>
  </section>`;
  const cols = box.querySelector(".board")!;
  STAGES.forEach((name, i) => {
    const here = all.filter((r) => Math.max(stageOf(r), 0) === i);
    const col = html`<div class="board-col">
      <div class="text-small text-muted truncate">${name}</div>
      <div class="num text-section !font-normal ${here.length ? "text-ink" : "text-muted"}">${here.length}</div>
      <div class="board-runs mt-1.5"></div>
    </div>`;
    const list = col.querySelector(".board-runs")!;
    here.slice(0, 3).forEach((r) => list.append(html`<button data-act="open-run" data-id="${r.id}" class="board-run" title="${r.title}"><span class="dot ${SHOWN_STYLE[shown(r)].text} ${r.status === "running" ? "live" : ""}"></span><span class="truncate">${shortId(r)}</span></button>`));
    if (here.length > 3) list.append(html`<div class="text-small text-muted mt-0.5"><span class="num">+${here.length - 3}</span> run daha</div>`);
    cols.append(col);
  });
  return box;
}

function finding(attention: Run[], running: number): string {
  if (attention.length) {
    const failed = attention.filter(hasError).length;
    return `${attention.length} run insan bekliyor${failed ? `, ${failed} tanesi hatayla durdu` : ""}.`;
  }
  return running ? `Bekleyen iş yok, ${running} run çalışıyor.` : "Bekleyen iş yok.";
}

export function overviewPage(): HTMLElement {
  const all = sortedRuns();
  const done = all.filter((r) => r.status === "review" && (r.endedAt ?? 0) >= today());
  const prs = all.filter((r) => prUrl(r));
  const drafts = prs.filter((r) => r.items.some((i) => i.kind === "deliver" && i.draft)).length;
  const human = all.filter((r) => r.status === "needs_human" && !hasError(r));
  const failed = all.filter((r) => hasError(r));
  const running = all.filter((r) => r.status === "running");
  const attention = all.filter((r) => r.status === "needs_human");
  const page = html`<div class="canvas">
    <div class="title-row">
      <div class="min-w-0"><h1 class="text-title text-ink">Genel Bakış</h1><p class="text-body text-soft mt-1">${finding(attention, running.length)}</p></div>
    </div>
    <div id="setup"></div>
    <section class="panel" aria-labelledby="att-title">
      <div class="panel-head"><h2 id="att-title" class="text-card text-ink">Dikkat gerekiyor</h2><span class="num text-small text-muted">${attention.length}</span></div>
      <div id="attention"></div>
    </section>
    <div id="board"></div>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-[var(--gap)]">
      <section class="panel flex flex-col" aria-labelledby="recent-title">
        <div class="panel-head"><h2 id="recent-title" class="text-card text-ink">Son aktivite</h2><button data-act="nav" data-page="runs" class="link">Tüm runlar (<span class="num">${all.length}</span>)</button></div>
        <div id="recent" class="flex-1 flex flex-col"></div>
      </section>
      <div id="cards" class="kpis" aria-label="Özet"></div>
    </div>
  </div>`;
  page.querySelector("#cards")!.append(
    kpi("Bugün biten", done.length, `${all.length} run kayıtlı`),
    kpi("PR açılan", prs.length, `${drafts} draft`),
    kpi("İnsan bekleyen", human.length, human[0] ? plainTitle(human[0]) : "—"),
    kpi("Hata veren", failed.length, failed[0] ? plainTitle(failed[0]) : "—"));
  const setup = setupPanel();
  if (setup) page.querySelector("#setup")!.replaceWith(setup); else page.querySelector("#setup")!.remove();
  page.querySelector("#board")!.replaceWith(board(all));
  const att = page.querySelector("#attention")!;
  if (!attention.length) att.append(html`<p class="empty">İnsan bekleyen run yok.</p>`);
  attention.slice(0, 4).forEach((r) => att.append(attentionRow(r)));
  if (attention.length > 4) att.append(html`<div class="px-5 py-2.5 border-t border-rule"><button data-act="nav" data-page="runs" class="link"><span class="num">${attention.length}</span> run'ın tümü</button></div>`);
  const rec = page.querySelector("#recent")!;
  if (!all.length) rec.append(html`<p class="empty">Henüz run yok. Servis çalışınca burada görünür.</p>`);
  all.slice(0, 5).forEach((r) => rec.append(runRow(r)));
  return page;
}
