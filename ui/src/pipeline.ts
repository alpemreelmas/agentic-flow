// The loop line: the five stages a run passes through, drawn from its own events.
import { html } from "./tpl.ts";
import { STAGES, shown, stageOf } from "./state.ts";
import type { Run } from "./runModel.ts";

/** Stage state: past ones are done, the furthest reached carries the run's status. A finished run has nothing "now". */
function stateAt(r: Run, i: number): string {
  const at = Math.max(stageOf(r), 0);
  if (i > at) return "";
  return i === at ? `now-${shown(r)}` : "done";
}

export function mini(r: Run): HTMLElement {
  const at = Math.max(stageOf(r), 0);
  return html`<span class="mini" role="img" aria-label="Aşama: ${STAGES[at]}" title="${STAGES[at]}">${STAGES.map((_, i) => html`<i class="${stateAt(r, i)}"></i>`)}</span>`;
}

const WORD: Record<string, string> = { "now-running": "şimdi", "now-needs_human": "durdu", "now-failed": "hata", "now-review": "son aşama", done: "tamam", "": "—" };

export function stepper(r: Run): HTMLElement {
  return html`<div class="stepper" role="list" aria-label="Döngü aşamaları">${STAGES.map((name, i) => {
    const st = stateAt(r, i);
    return html`<div role="listitem" class="step ${st}"><div class="text-small font-medium truncate ${st ? "text-ink" : "text-muted"}">${name}</div><div class="step-state text-small text-muted truncate">${WORD[st]}</div></div>`;
  })}</div>`;
}
