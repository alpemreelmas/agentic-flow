import json
from pathlib import Path

import pytest

from looper.skills import MAX_SKILL_BYTES, SkillError, compose, discover, resolve
from looper.registry import LocalRegistry, compose_prompt
from looper.workspaces import load


def put(root, relative, name='design', body='Use the reference files.'):
    directory = root / relative
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'SKILL.md').write_text(f'---\nname: {name}\ndescription: Useful guidance\n---\n{body}')
    return directory


def test_sources_qualified_ids_and_project_precedence(tmp_path):
    home, repo, registry = [tmp_path / n for n in ['home', 'repo', 'registry']]
    put(home, '.agents/skills/design'); put(home, '.codex/skills/design')
    put(repo, '.agents/skills/design'); put(registry, 'skills/design')
    catalog = discover(registry, repo, home=home)
    assert [s.id for s in catalog] == ['project-agents:design','registry:design','agents:design','codex:design']
    assert resolve(catalog, 'design').source == 'project-agents'
    assert resolve(catalog, 'codex:design').source == 'codex'
    with pytest.raises(SkillError, match='not found'):
        resolve(catalog, 'codex:../design')
    with pytest.raises(SkillError, match='not found'):
        resolve(catalog, 'missing:design')


def test_folder_symlinks_keep_support_files_and_dedupe_selection(tmp_path):
    home = tmp_path / 'home'; registry = tmp_path / 'registry'
    skill = put(home, '.agents/skills/architecture/diagram')
    (skill / 'scripts').mkdir(); (skill / 'references').mkdir()
    (home / '.codex/skills').mkdir(parents=True)
    (home / '.codex/skills/diagram').symlink_to(skill, target_is_directory=True)
    # A recursive symlink must not make discovery loop forever.
    (skill / 'loop').symlink_to(home / '.agents/skills', target_is_directory=True)
    catalog = discover(registry, home=home)
    text, used = compose(catalog, ['agents:architecture/diagram', 'codex:diagram'])
    assert len(used) == 1 and used[0]['scripts'] and used[0]['references']
    assert str(skill.resolve()) in text and 'do not modify' in text
    assert (skill / 'SKILL.md').read_text().endswith('Use the reference files.')


def test_bad_skill_does_not_hide_valid_skills(tmp_path):
    root = tmp_path / 'registry'
    put(root,'skills/good')
    bad = put(root,'skills/bad'); (bad / 'SKILL.md').write_text('---\nname: [broken\n---\nbody')
    huge = put(root,'skills/huge'); (huge / 'SKILL.md').write_text('x' * (MAX_SKILL_BYTES + 1))
    catalog = discover(root, home=tmp_path / 'home')
    assert len(catalog) == 3
    assert resolve(catalog,'registry:good').error == ''
    for name in ['bad','huge']:
        with pytest.raises(SkillError): resolve(catalog,'registry:'+name).context()


def test_workspace_defaults_and_role_contracts_are_composed(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, 'home', lambda: tmp_path / 'home')
    registry, repo = tmp_path/'registry', tmp_path/'repo'
    (registry/'roles').mkdir(parents=True)
    (registry/'roles/implementer.md').write_text('---\nskills: [contract]\n---\nImplement task.')
    put(registry,'skills/contract',name='contract',body='Real role contract')
    put(repo,'.agents/skills/contract',name='contract',body='Shadow contract')
    put(repo,'.agents/skills/design',body='Project design instruction')
    scoped = LocalRegistry(registry).for_workspace(str(repo), ['project-agents:design','project-agents:design'])
    text = compose_prompt(scoped, scoped.get_role('implementer'), 'Ship it')
    assert 'Real role contract' in text and 'Shadow contract' not in text
    assert text.count('Project design instruction') == 1
    assert [s['id'] for s in scoped.used_skills] == ['registry:contract','project-agents:design']


def test_workspace_skill_settings_roundtrip_and_validation(tmp_path):
    path=tmp_path/'workspaces.json'
    path.write_text(json.dumps([{'name':'web','repo':'/repo','skills':['agents:design','agents:design']}]))
    assert load(path)[0].skills == ('agents:design',)
    path.write_text(json.dumps([{'name':'web','repo':'/repo','skills':'agents:design'}]))
    with pytest.raises(ValueError): load(path)


def test_graph_injects_workspace_defaults_and_records_source(tmp_path, monkeypatch):
    import asyncio
    from langgraph.checkpoint.memory import MemorySaver
    from looper import graph as module
    from looper.acp_executor import RunResult
    monkeypatch.setattr(Path, 'home', lambda: tmp_path / 'home')
    put(tmp_path / 'repo', '.agents/skills/design', body='Use this workspace design')
    captured = []
    async def agent(cli, cwd, prompt, **kwargs):
        captured.append(prompt)
        return RunResult('done', 'end_turn')
    class Source:
        def mark_in_progress(self, task): pass
        def finish(self, *args): pass
    monkeypatch.setattr(module, 'run_prompt', agent)
    graph = module.build_graph(Source(), LocalRegistry('registry'), runs_dir=tmp_path/'runs', agent_override=None,
                               max_attempts=1, timeout=5, ask_permissions=False, quiet=True, checkpointer=MemorySaver())
    asyncio.run(graph.ainvoke({'task_id':'skill-test','title':'T','description':'D','verify_cmd':'true','cwd':str(tmp_path),
                              'skill_repo':str(tmp_path/'repo'),'skills':['project-agents:design']},
                             {'configurable':{'thread_id':'skill-test'}}))
    assert 'Use this workspace design' in captured[0]
    events = [json.loads(line) for line in next((tmp_path/'runs').glob('*.jsonl')).read_text().splitlines()]
    assert next(e for e in events if e['type']=='prompt')['skills'][0]['id'] == 'project-agents:design'


@pytest.mark.parametrize('missing', [False, True])
def test_chat_combines_defaults_mentions_and_reports_unavailable_skills(tmp_path, monkeypatch, missing):
    import asyncio
    from contextlib import asynccontextmanager
    from types import SimpleNamespace
    import acp
    from looper import chat
    monkeypatch.setattr(Path, 'home', lambda: tmp_path/'home')
    put(tmp_path/'home','.agents/skills/design',body='Global design')
    put(tmp_path/'repo','.agents/skills/plan',name='plan',body='Workspace plan')
    prompts, events = [], []
    class Connection:
        async def initialize(self, **kwargs): return SimpleNamespace(protocol_version=acp.PROTOCOL_VERSION, agent_info=None)
        async def new_session(self, **kwargs): return SimpleNamespace(session_id='s',modes=None,config_options=[])
        async def prompt(self, **kwargs):
            prompts.append(kwargs['prompt'][0].text)
            return SimpleNamespace(stop_reason='end_turn')
    @asynccontextmanager
    async def spawn(*args, **kwargs): yield Connection(), None
    async def lines():
        yield json.dumps({'type':'prompt','text':'Design it','skills':['agents:removed' if missing else 'project-agents:plan']})
        await asyncio.sleep(.02)
    monkeypatch.setattr(chat.acp,'spawn_agent_process',spawn)
    monkeypatch.setattr(chat,'_stdin_lines',lines)
    monkeypatch.setattr(chat,'_emit',events.append)
    asyncio.run(chat.run_chat('claude',str(tmp_path/'repo'),registry=str(tmp_path/'registry'),skills=['agents:design']))
    if missing:
        assert not prompts
        assert any(e['type']=='error' and 'not found' in e['error'] for e in events)
    else:
        assert 'Global design' in prompts[0] and 'Workspace plan' in prompts[0]
        assert [s['id'] for s in next(e for e in events if e['type']=='skills_used')['skills']] == ['agents:design','project-agents:plan']
