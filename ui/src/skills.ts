import { invoke } from "@tauri-apps/api/core";
import { schedule } from "./state.ts";

export interface Skill {
  id: string; name: string; description: string; source: string; path: string; directory: string;
  scripts: boolean; references: boolean; requirements: string; error: string;
}
interface Catalog { skills: Skill[]; loading: boolean; error: string; loaded: boolean }
const catalogs = new Map<string, Catalog>();
export function catalog(repo?: string): Catalog {
  const key = repo || "";
  if (!catalogs.has(key)) {
    catalogs.set(key, {skills: [], loading: false, error: "", loaded: false});
    void refreshSkills(repo);
  }
  return catalogs.get(key)!;
}
export async function refreshSkills(repo?: string) {
  const key = repo || "";
  if (!catalogs.has(key)) catalogs.set(key, {skills: [], loading: false, error: "", loaded: false});
  const c = catalogs.get(key)!;
  if (c.loading) return;
  c.loading = true; c.error = "";
  try { c.skills = await invoke<Skill[]>("list_skills", {repo: repo || null}); c.loaded = true; }
  catch (error) { c.error = String(error); }
  finally { c.loading = false; schedule(); }
}
