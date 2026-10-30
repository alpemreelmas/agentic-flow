import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,Node:dom.window.Node,Option:dom.window.Option,requestAnimationFrame:()=>1});
let saved: any;
const skill={id:'agents:design',name:'Design',description:'UI guidance',source:'agents',path:'/home/skills/design/SKILL.md',directory:'/home/skills/design',scripts:true,references:true,requirements:'Read',error:''};
(window as any).__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
 if(command==='get_config')return {workspaces:[{id:'w',name:'Web',repo:'/repo',project_id:'',project_name:'',enabled:true,skills:[]}],active_workspace:'',label:'agent',ready:'Todo',progress:'In Progress',review:'In Review',blocked:'Backlog',deliver:'none',reviewers:'none',triage:'none',agent:'',max_attempts:3,timeout:1800,interval:300};
 if(command==='key_status')return false;
 if(command==='set_config'){saved=args.config;return;}
 if(command==='list_skills')return [skill];
 if(command==='read_skill')return {skill,content:'---\nname: Design\n---\nInstructions'};
 if(command==='default_registry_dir')return '/registry';
 if(command==='list_registry')return [];
 return undefined;
}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const {loadSettings,settingsPage}=await import('./pages/settings.ts');
const {initRegistry,registryPage}=await import('./registry.ts');
test('workspace selection persists qualified IDs and external previews are read only',async()=>{
 await loadSettings();document.body.append(settingsPage());await tick();
 document.body.replaceChildren(settingsPage());
 const checkbox=document.querySelector<HTMLInputElement>('details input[type="checkbox"]')!;
 checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change'));
 (document.querySelector('[data-act="cfg-save"]') as HTMLElement).click();await tick();
 assert.deepEqual(saved.workspaces[0].skills,['agents:design']);
 await initRegistry(()=>{});document.body.replaceChildren(registryPage());await tick();
 document.body.replaceChildren(registryPage());
 (document.querySelector('[data-act="skill-preview"]') as HTMLElement).click();await tick();
 document.body.replaceChildren(registryPage());
 const preview=document.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
 assert.equal(preview.readOnly,true);assert.match(preview.value,/Instructions/);
 assert.match(document.body.textContent!,/agents:design/);
 assert.match(document.body.textContent!,/scripts\//);
 assert.equal(document.querySelector('[data-act="reg-save"]'),null);
});
