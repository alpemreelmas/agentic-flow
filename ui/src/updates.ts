import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dirty } from "./registry.ts";

let busy = false;
let version: string | null = null;
let box: HTMLElement;
let text: HTMLSpanElement;
let button: HTMLButtonElement;

async function check(manual = false) {
  if (busy || version) return;
  busy = true;
  button.disabled = true;
  text.textContent = "Güncellemeler kontrol ediliyor…";
  try {
    version = await invoke<string | null>("check_update");
    text.textContent = version ? `${version} indirildi. Kurmadan önce döngüyü durdurun, sohbetleri kapatın ve değişiklikleri kaydedin.` : "Uygulama güncel.";
    button.textContent = version ? "Kur ve yeniden başlat" : "Güncelleme kontrol et";
  } catch (error) {
    // Startup/periodic checks fail routinely (no release yet, offline, .deb): stay quiet, keep the reason in the tooltip.
    text.textContent = manual ? `Güncelleme kontrol edilemedi: ${String(error)}` : "Güncelleme denetlenemedi.";
    text.title = String(error);
  } finally { busy = false; button.disabled = false; }
}

export async function initUpdates() {
  box = document.createElement("aside");
  box.className = "fixed bottom-12 right-4 z-50 rounded border border-outline-variant bg-surface-container p-3 text-sm max-w-md shadow-lg";
  box.setAttribute("aria-label", "Uygulama güncellemeleri");
  text = document.createElement("span");
  text.setAttribute("role", "status");
  button = document.createElement("button");
  button.className = "ml-3 link underline";
  button.textContent = "Güncelleme kontrol et";
  button.onclick = async () => {
    if (!version) return void check(true);
    if (dirty()) { text.textContent = "Registry değişikliklerini kaydedin veya geri alın."; return; }
    if (!window.confirm("Kaydedilmemiş ayarları ve sohbet taslaklarını kaydedin. Güncelleme kurulsun ve uygulama yeniden başlatılsın mı?")) return;
    button.disabled = true;
    try { await invoke("install_update"); }
    catch (error) { text.textContent = String(error); button.disabled = false; }
  };
  box.append(text, button);
  document.body.append(box);
  await listen<{received: number; total: number | null}>("update-progress", ({payload}) => {
    text.textContent = payload.total ? `Güncelleme indiriliyor: %${Math.round(payload.received / payload.total * 100)}` : `Güncelleme indiriliyor: ${Math.round(payload.received / 1024)} KB`;
  });
  void check();
  setInterval(() => void check(), 6 * 60 * 60 * 1000);
}
