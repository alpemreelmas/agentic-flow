import { invoke } from "@tauri-apps/api/core";
import { html } from "./tpl.ts";

interface Snapshot {
  cpu: number; memory: number; total_memory: number; swap: number;
  app_cpu: number; app_memory: number; cores: number;
  processes: {pid: number; name: string; cpu: number; memory: number}[];
}
const bytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`;
const percent = (n: number) => `${n.toFixed(1)}%`;

export function initResources() {
  const footer = html`<footer class="resource-footer"><span class="resource-label">LINEAR LOOPER</span><button type="button" aria-expanded="false" aria-controls="resource-details">CPU / RAM ölçülüyor…</button><span class="resource-cadence">3 sn</span></footer>`;
  const toggle = footer.querySelector("button")!;
  const panel = html`<section id="resource-details" class="resource-panel" aria-label="Kaynak kullanımı" hidden><header><strong>Kaynak kullanımı</strong><button type="button" aria-label="Detayları kapat">✕</button></header><div class="resource-content"></div></section>`;
  const content = panel.querySelector(".resource-content")!;
  const close = () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); };
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); };
  panel.querySelector("button")!.onclick = close;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) close(); });
  document.body.append(footer, panel);
  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const s = await invoke<Snapshot | null>("resource_usage");
      if (!s) return;
      toggle.textContent = `CPU ${percent(s.app_cpu)} · RAM ${bytes(s.app_memory)}`;
      content.replaceChildren(html`<div><p class="resource-summary">Looper ve alt süreçleri · ${s.processes.length} süreç</p>
        <div class="resource-totals"><strong>${percent(s.app_cpu)} CPU</strong><strong>${bytes(s.app_memory)} RAM</strong></div>
        <p class="resource-summary">Tüm bilgisayar · ${s.cores} mantıksal çekirdek</p>
        <div class="resource-host"><span>CPU ${percent(s.cpu)}</span><span>RAM ${bytes(s.memory)} / ${bytes(s.total_memory)}</span><span>Swap ${bytes(s.swap)}</span></div>
        <div class="resource-table-wrap"><table><thead><tr><th>Süreç</th><th>PID</th><th>CPU</th><th>RAM</th></tr></thead><tbody>${s.processes.map(p => html`<tr><td title="${p.name}">${p.name}</td><td>${p.pid}</td><td>${percent(p.cpu)}</td><td>${bytes(p.memory)}</td></tr>`)}</tbody></table></div>
        <p class="resource-note">CPU yüzdeleri toplam bilgisayar kapasitesine göredir. RAM, süreçlerin yerleşik bellek toplamıdır; paylaşılan sayfalar birden fazla sayılabilir. Son ölçüm: ${new Date().toLocaleTimeString()}</p></div>`);
    } catch { toggle.textContent = "CPU / RAM ölçülemedi · tekrar denenecek"; }
    finally { busy = false; }
  }
  void refresh();
  setInterval(() => void refresh(), 3000);
}
