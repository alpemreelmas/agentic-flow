// First-run wizard: tools + GitHub, Linear key, default workspace. Shown until setup is complete.
import { invoke } from "@tauri-apps/api/core";
import { act, html, selectEl } from "./tpl.ts";
import { health, loadHealth, row, setupComplete } from "./health.ts";
import { schedule } from "./state.ts";
import { loadSettings } from "./pages/settings.ts";
import { tryStartOnce } from "./shell.ts";

interface Project { id: string; name: string; state: string }

const SKIP_KEY = "onboarding-skipped";
let skipped = false;
try { skipped = localStorage.getItem(SKIP_KEY) === "1"; } catch { /* storage unavailable */ }

let keyDraft = "";
let folder = "";
let wsName = "";
let projectId = "";
let projects: Project[] | null = null;
let loadingProjects = false;
let busy = false;
let msg = "";

const inTauri = () => "__TAURI_INTERNALS__" in window;
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** True while the wizard should replace the app: checks have run and something is still missing. */
export function onboardingActive(): boolean {
  return inTauri() && !skipped && (!!health.doctor || !!health.error) && !setupComplete();
}

const currentStep = () => (!health.doctor?.ok ? 1 : !health.keySet ? 2 : 3);

async function loadProjects() {
  if (loadingProjects) return;
  loadingProjects = true;
  try {
    projects = JSON.parse(await invoke<string>("list_projects"));
  } catch (e) {
    projects = [];
    msg = `Linear projeleri alınamadı: ${e}`;
  }
  loadingProjects = false;
  schedule();
}

act("ob-copy", async (el) => {
  try { await navigator.clipboard.writeText(el.dataset.text ?? ""); el.textContent = "Kopyalandı"; } catch { el.textContent = el.dataset.text ?? ""; }
});

act("ob-skip", () => {
  skipped = true;
  try { localStorage.setItem(SKIP_KEY, "1"); } catch { /* ignore */ }
  schedule();
});

act("ob-key", async () => {
  const key = keyDraft.trim();
  if (!key || busy) return;
  busy = true;
  msg = "";
  schedule();
  try {
    await invoke("set_linear_key", { key });
    try {
      // Asking Linear for the projects doubles as validating the key.
      projects = JSON.parse(await invoke<string>("list_projects"));
      health.keySet = true;
      keyDraft = "";
    } catch (e) {
      await invoke("clear_linear_key").catch(() => {});
      health.keySet = false;
      projects = null;
      msg = `Linear anahtarı doğrulanamadı: ${e}`;
    }
  } catch (e) {
    msg = String(e);
  }
  busy = false;
  void loadHealth();
  schedule();
});

act("ob-pick", async () => {
  const dir = await invoke<string | null>("pick_folder");
  if (dir) {
    folder = dir;
    if (!wsName.trim()) wsName = basename(dir);
    msg = "";
    schedule();
  }
});

act("ob-finish", async () => {
  if (!folder || busy) return;
  busy = true;
  msg = "";
  schedule();
  try {
    const cfg = await invoke<Record<string, unknown>>("get_config");
    const project = projects?.find((p) => p.id === projectId);
    cfg.workspaces = [{ id: "ws-default", name: wsName.trim() || basename(folder), repo: folder, project_id: projectId, project_name: project?.name ?? "", enabled: true, skills: [] }];
    cfg.active_workspace = "ws-default";
    await invoke("set_config", { config: cfg });
    await loadSettings();
    await loadHealth();
    await tryStartOnce();
  } catch (e) {
    msg = String(e);
  }
  busy = false;
  schedule();
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "ob-key-input") keyDraft = t.value;
  else if (t.id === "ob-name") wsName = t.value;
});

const INPUT = "field w-full";

function steps(n: number): HTMLElement {
  const names = ["Araçlar ve GitHub", "Linear", "Workspace"];
  return html`<ol class="flex flex-wrap gap-2 mb-6" aria-label="Kurulum adımları">${names.map((name, i) => html`<li class="pill ${i + 1 < n ? "pill-neutral" : i + 1 === n ? "pill-accent" : "pill-neutral"}" ${i + 1 === n ? 'aria-current="step"' : ""}><span class="num">${i + 1}</span>&nbsp;${name}${i + 1 < n ? " ✓" : ""}</li>`)}</ol>`;
}

function toolsStep(): HTMLElement {
  const box = html`<section class="panel" aria-labelledby="ob-title"><div class="panel-head"><h2 id="ob-title" class="text-card text-ink">Araçlar ve GitHub</h2>
    <button data-act="doctor-run" class="btn btn-sm" ${health.loading ? "disabled" : ""}>${health.loading ? "Kontrol ediliyor…" : "Yeniden kontrol et"}</button></div></section>`;
  box.append(html`<p class="text-body text-soft px-5 py-3">Ajanlar kodu yazıp GitHub'da PR açar; bunun için bu araçlar ve GitHub girişi gerekir.</p>`);
  if (health.error) box.append(row(false, "Kontrol çalışmadı", health.error));
  const items = health.doctor?.items ?? [];
  for (const i of items) {
    const ok = i.ok || !!i.optional;
    const login = i.name === "gh auth" && !i.ok && items.some((x) => x.name === "gh" && x.ok);
    box.append(row(ok, i.name, i.ok ? i.detail : [i.detail, i.hint].filter(Boolean).join(" · "),
      login ? html`<button data-act="ob-copy" data-text="gh auth login" class="btn btn-sm">gh auth login'i kopyala</button>` : ""));
  }
  if (items.some((i) => i.name === "gh auth" && !i.ok)) {
    box.append(html`<p class="text-small text-muted px-5 py-3 border-t border-rule">Terminalde <code>gh auth login</code> çalıştırıp girişi tamamlayın, sonra "Yeniden kontrol et"e basın.</p>`);
  }
  return box;
}

function linearStep(): HTMLElement {
  return html`<section class="panel" aria-labelledby="ob-title"><div class="panel-head"><h2 id="ob-title" class="text-card text-ink">Linear</h2></div>
    <div class="px-5 py-4 flex flex-col gap-3">
      <p class="text-body text-soft">Görevleri Linear'dan alırız. Linear → Settings → Security &amp; access → API'den kişisel bir anahtar oluşturun. Anahtar sistem anahtarlığında saklanır.</p>
      <label class="label" for="ob-key-input">API anahtarı</label>
      <div class="flex items-center gap-2">
        <input id="ob-key-input" type="password" autocomplete="off" placeholder="lin_api_…" value="${keyDraft}" class="${INPUT}"/>
        <button data-act="ob-key" class="btn btn-primary" ${busy ? "disabled" : ""}>${busy ? "Doğrulanıyor…" : "Kaydet ve doğrula"}</button>
      </div>
    </div></section>`;
}

function workspaceStep(): HTMLElement {
  if (projects === null) void loadProjects();
  const picker = selectEl(INPUT, [{ value: "", label: projects === null ? "Projeler yükleniyor…" : "Proje seçmeyin (tüm görevler)" },
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))], projectId, { id: "ob-project", "aria-label": "Linear projesi" });
  picker.onchange = () => { projectId = picker.value; };
  const box = html`<section class="panel" aria-labelledby="ob-title"><div class="panel-head"><h2 id="ob-title" class="text-card text-ink">Varsayılan workspace</h2></div>
    <div class="px-5 py-4 flex flex-col gap-3">
      <p class="text-body text-soft">Ajanların çalışacağı git deposu. İlk denemede küçük bir deneme reposu seçmenizi öneririm.</p>
      <label class="label">Git klasörü</label>
      <div class="flex items-center gap-2"><span class="num text-small text-soft truncate flex-1" title="${folder}">${folder || "Seçilmedi"}</span><button data-act="ob-pick" class="btn btn-sm">Klasör seç…</button></div>
      <label class="label" for="ob-name">Ad</label>
      <input id="ob-name" value="${wsName}" class="${INPUT}" placeholder="${folder ? basename(folder) : "workspace adı"}"/>
      <label class="label">Linear projesi <span class="text-muted">(isteğe bağlı)</span></label>
    </div></section>`;
  const body = box.querySelector(".flex.flex-col")!;
  body.append(picker, html`<div><button data-act="ob-finish" class="btn btn-primary" ${!folder || busy ? "disabled" : ""}>${busy ? "Kaydediliyor…" : "Kaydet ve başla"}</button></div>`);
  return box;
}

export function onboardingPage(): HTMLElement {
  const step = currentStep();
  const page = html`<main class="canvas" style="max-width:680px;margin:0 auto;padding-top:48px">
    <h1 class="text-title text-ink">Linear Looper'a hoş geldiniz</h1>
    <p class="text-body text-soft mt-1 mb-6">Birkaç adımda hazırız.</p>
  </main>`;
  page.append(steps(step), step === 1 ? toolsStep() : step === 2 ? linearStep() : workspaceStep());
  if (msg) page.append(html`<p class="text-small text-negative mt-3" role="alert">${msg}</p>`);
  page.append(html`<p class="mt-6"><button data-act="ob-skip" class="link">Şimdilik atla</button></p>`);
  return page;
}
