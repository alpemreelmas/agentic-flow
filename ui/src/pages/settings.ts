// Settings screen: design/ayarlar_entegrasyon_d_ng_denetimleri, bound to config.json + the OS keychain.
import { invoke } from "@tauri-apps/api/core";
import { act, html } from "../tpl.ts";
import { schedule, ui } from "../state.ts";

interface Config {
  repo: string; label: string; ready: string; progress: string; review: string; blocked: string;
  deliver: string; reviewers: string; triage: string; agent: string;
  max_attempts: number; timeout: number; interval: number;
}

let cfg: Config | null = null;
let keySet = false;
let message = "";
let checkOutput = "";
let checking = false;

export async function loadSettings() {
  try {
    cfg = await invoke<Config>("get_config");
    keySet = await invoke<boolean>("key_status");
  } catch { /* browser preview: keep defaults */ }
  schedule();
}

const field = (id: string) => document.getElementById(`cfg-${id}`) as HTMLInputElement | HTMLSelectElement | null;
const val = (id: string) => field(id)?.value ?? "";

function readForm(): Config {
  return {
    repo: val("repo").trim(), label: val("label").trim(), ready: val("ready").trim(), progress: val("progress").trim(),
    review: val("review").trim(), blocked: val("blocked").trim(), deliver: val("deliver"), reviewers: val("reviewers").trim(),
    triage: val("triage").trim(), agent: val("agent"),
    max_attempts: Number(val("max_attempts")), timeout: Number(val("timeout")), interval: Number(val("interval")),
  };
}

act("cfg-save", async () => {
  const next = readForm();
  try {
    await invoke("set_config", { config: next });
    cfg = next;
    message = "Kaydedildi. Değişiklik servisin bir sonraki başlatılışında geçerli olur.";
  } catch (e) {
    message = `Kaydedilmedi: ${e}`;
  }
  schedule();
});

act("key-save", async () => {
  const input = field("key") as HTMLInputElement;
  try {
    await invoke("set_linear_key", { key: input.value });
    input.value = "";
    keySet = true;
    message = "Linear anahtarı Keychain'e kaydedildi.";
  } catch (e) {
    message = `Anahtar kaydedilmedi: ${e}`;
  }
  schedule();
});

act("key-clear", async () => {
  try {
    await invoke("clear_linear_key");
    keySet = false;
    message = "Linear anahtarı Keychain'den silindi.";
  } catch (e) {
    message = `Silinemedi: ${e}`;
  }
  schedule();
});

act("cfg-check", async () => {
  checking = true;
  checkOutput = "";
  schedule();
  try {
    checkOutput = await invoke<string>("check_connection");
  } catch (e) {
    checkOutput = `Hata: ${e}`;
  }
  checking = false;
  schedule();
});

const input = "w-full h-8 px-2 rounded bg-surface-container text-on-surface font-code-sm text-code-sm placeholder:text-outline focus:outline-none focus:bg-surface-container-high";
const label = "font-label-sm text-label-sm uppercase text-outline";

function text(id: keyof Config, title: string, hint = ""): HTMLElement {
  return html`<label class="flex flex-col gap-1"><span class="${label}">${title}</span><input id="cfg-${id}" class="${input}" value="${String(cfg![id])}"/>${hint ? html`<span class="font-body-sm text-body-sm text-outline">${hint}</span>` : ""}</label>`;
}
function select(id: keyof Config, title: string, options: [string, string][]): HTMLElement {
  return html`<label class="flex flex-col gap-1"><span class="${label}">${title}</span><select id="cfg-${id}" class="${input}">${options.map(([v, n]) => html`<option value="${v}" ${cfg![id] === v ? "selected" : ""}>${n}</option>`)}</select></label>`;
}
function block(title: string, icon: string, body: Node[]): HTMLElement {
  const b = html`<section class="rounded bg-surface-container-low shadow-sm overflow-hidden"><div class="px-space-md py-space-sm bg-surface-container flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[18px]">${icon}</span><h2 class="font-headline-sm text-headline-sm text-on-surface">${title}</h2></div><div class="p-space-md grid grid-cols-1 md:grid-cols-2 gap-space-md"></div></section>`;
  b.lastElementChild!.append(...body);
  return b;
}

export function settingsPage(): HTMLElement {
  const s = ui.service;
  const page = html`<div class="flex flex-col w-full">
    <div class="px-space-xl pt-space-lg pb-space-md bg-surface-container-lowest flex items-center justify-between gap-space-md">
      <div class="flex flex-col gap-1"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">tune</span><span class="font-headline-md text-headline-md text-on-surface tracking-tight">Ayarlar</span></div>
      <p class="font-body-sm text-body-sm text-outline">Entegrasyonlar ve döngü parametreleri. Servis ${s.running ? "çalışıyor; değişiklikler yeniden başlatınca geçerli olur" : "kapalı"}.</p></div>
      <div class="flex items-center gap-space-sm">
        <button data-act="cfg-check" class="px-3 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm flex items-center gap-1.5">${checking ? "Kontrol ediliyor…" : "Bağlantıyı Test Et (--check)"}</button>
        <button data-act="cfg-save" class="px-3.5 py-1 rounded bg-primary-container hover:bg-primary-container/90 text-on-primary-container font-body-sm text-body-sm font-semibold flex items-center gap-1.5"><span class="material-symbols-outlined text-[15px]">save</span>Kaydet</button>
      </div>
    </div>
    <div class="px-space-xl py-space-lg flex flex-col gap-space-lg" id="blocks"></div></div>`;
  const blocks = page.querySelector("#blocks")!;
  if (message) blocks.append(html`<div class="px-space-md py-2 rounded font-body-sm text-body-sm ${message.includes("ilmedi") || message.includes("Hata") || message.includes("eksik") || message.includes("Silinemedi") ? "bg-error-container/30 text-error" : "bg-secondary/10 text-secondary"}">${message}</div>`);
  if (!cfg) {
    blocks.append(html`<p class="text-outline font-body-md text-body-md">Ayarlar yüklenemedi (uygulama dışında çalışıyor).</p>`);
    return page;
  }
  blocks.append(
    block("Linear", "all_inclusive", [
      html`<div class="flex flex-col gap-1 md:col-span-2"><span class="${label}">API anahtarı (macOS Keychain)</span>
        <div class="flex items-center gap-space-sm">
          <input id="cfg-key" type="password" autocomplete="off" placeholder="${keySet ? "•••••••• kayıtlı — değiştirmek için yenisini yazın" : "lin_api_…"}" class="${input}"/>
          <button data-act="key-save" class="px-3 h-8 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-body-sm text-body-sm">Kaydet</button>
          ${keySet ? html`<button data-act="key-clear" class="px-3 h-8 rounded bg-surface-container hover:bg-surface-container-high text-error font-body-sm text-body-sm">Sil</button>` : ""}
        </div>
        <span class="font-body-sm text-body-sm ${keySet ? "text-secondary" : "text-tertiary"}">${keySet ? "Anahtar Keychain'de kayıtlı; ekranda hiçbir zaman gösterilmez." : "Henüz anahtar yok. Linear > Settings > Security & access > API."}</span></div>`,
      text("label", "Filtre etiketi", "Yalnızca bu etiketi taşıyan görevler alınır."),
      text("ready", "Alınacak durum"), text("progress", "Çalışırken durum"), text("review", "Bitince durum"), text("blocked", "Vazgeçilince durum", "Alınan durumdan farklı olmalı."),
    ]),
    block("GitHub ve Repo", "terminal", [
      text("repo", "Repo (yerel git klasörü)", "Mutlak yol. Ajan burada git worktree açar."),
      select("deliver", "PR modu", [["github", "gh ile PR aç (doğrulanmamışsa draft)"], ["none", "PR açma"]]),
    ]),
    block("Ajanlar ve Döngü", "shield", [
      select("agent", "Varsayılan ajan", [["", "Her rolün kendi CLI'ı"], ["claude", "Claude"], ["gemini", "Gemini"], ["codex", "Codex"]]),
      text("triage", "Triage rolü"), text("reviewers", "Reviewer rolleri", "Virgülle; 'none' kapatır."),
      text("max_attempts", "Maksimum deneme"), text("timeout", "Adım zaman aşımı (sn)"), text("interval", "Poll aralığı (sn)"),
    ]),
  );
  if (checkOutput) blocks.append(html`<pre class="rounded bg-surface-container-lowest p-space-md font-code-sm text-code-sm text-on-surface-variant whitespace-pre-wrap">${checkOutput}</pre>`);
  blocks.append(html`<p class="font-code-sm text-code-sm text-outline">Veri: ${ui.paths.runs} · ${ui.paths.registry}</p>`);
  return page;
}
