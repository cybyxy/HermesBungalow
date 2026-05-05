from __future__ import annotations

import json

import pytest

from api.game.agent import (
    resolve_game_agent_token,
    resolve_world_agent_token,
    run_recursive_peer_invokes,
)
from api.game.persistence import world_from_dict
from api.game.service import GameService, PeerVisitor


@pytest.fixture
def svc(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC", "1")
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "1")
    db = tmp_path / "t.db"
    return GameService(db_path=db)


def test_move_agent_syncs_room_agent_ids(svc: GameService):
    a = svc.world.agents[0]
    assert svc.move_agent(a.id, "休息室") is True
    room_rest = next(r for r in svc.world.rooms if r.name == "休息室")
    assert a.id in room_rest.agent_ids
    assert a.location == "休息室"


def test_greeting_requires_same_allowed_room(svc: GameService):
    agents = svc.world.agents
    a, b = agents[0], agents[1]
    # B 设计师 idle 在休息室；把 A 移到休息室
    svc.move_agent(a.id, "休息室")
    r1 = svc.greeting(a.id, b.id)
    assert r1["ok"] is True
    r2 = svc.greeting(a.id, b.id)
    assert r2["ok"] is False
    assert r2.get("error") == "cooldown"


def test_tick_advances_time(svc: GameService):
    day0 = svc.world.day
    t0 = svc.world.time
    snap = svc.tick_time(minutes=30)
    assert snap["time"] != t0 or svc.world.day > day0


def test_persist_roundtrip_room_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC", "1")
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "1")
    db = tmp_path / "g.db"
    svc = GameService(db_path=db)
    svc.move_agent("A", "资料室")
    svc.persist()
    conn = svc._conn
    row = conn.execute("SELECT payload FROM game_saves WHERE slot = ?", ("default",)).fetchone()
    assert row
    data = json.loads(row["payload"])
    archive = next(r for r in data["rooms"] if r["name"] == "资料室")
    assert "A" in archive["agent_ids"]


def test_sync_hermes_preserves_profession_from_save(monkeypatch, tmp_path):
    """非空职业来自存档时，Hermes 同步不覆盖（用户可在详情中维护）。"""
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "1")
    monkeypatch.delenv("HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC", raising=False)

    def fake_list():
        return [
            {
                "id": "agent_stable_1",
                "name": "同步名",
                "description": "d",
                "profile": "noprofmap",
                "profession": "SOUL推导职业",
                "personality": "",
                "catchphrase": [],
                "memes": [],
                "avatar": "",
                "gender": "male",
            }
        ]

    monkeypatch.setattr("api.hermes_personalities.list_hermes_profile_agents", fake_list)

    from api.game.models import Agent, GameWorld, Room
    from api.game.persistence import _connect, init_db, save_world_to_db

    db = tmp_path / "prof.db"
    conn = _connect(db)
    init_db(conn)
    world = GameWorld(
        agents=[
            Agent(
                id="agent_stable_1",
                name="同步名",
                display_name="",
                profession="存档里写的",
                profile="noprofmap",
                location="休息室",
            )
        ],
        tasks=[],
        rooms=[Room(id="r1", name="休息室", type="fixed")],
    )
    save_world_to_db(conn, world)

    svc = GameService(db_path=db)
    hit = next(a for a in svc.world.agents if a.id == "agent_stable_1")
    assert hit.profession == "存档里写的"


def test_world_from_dict_event_log_default():
    w = world_from_dict({"agents": [], "tasks": [], "rooms": []})
    assert w.event_log == []


def test_agent_hermes_session_id_roundtrip():
    from api.game.models import Agent, GameWorld

    a = Agent(
        id="x",
        name="n",
        profession="p",
        hermes_session_id="sess_abc",
    )
    w = GameWorld(agents=[a])
    w2 = world_from_dict(w.to_dict())
    assert w2.agents[0].hermes_session_id == "sess_abc"


def test_peer_visitor_merged_in_snapshot(svc: GameService):
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_test1",
            relay_base_url="http://127.0.0.1:9000",
            relay_agent_id="pymaster",
            name="Remote",
            display_name="Remote",
            profession="程序员",
            profile="pymaster",
            location="休息室",
        )
    )
    snap = svc.snapshot()
    ids = [a["id"] for a in snap["agents"]]
    assert "pv_test1" in ids
    row = next(a for a in snap["agents"] if a["id"] == "pv_test1")
    assert row.get("peer_relay_base_url") == "http://127.0.0.1:9000"
    assert row.get("bungalow_peer_api") == 1


def test_resolve_game_agent_token_visitor_alias(svc: GameService):
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_alias",
            relay_base_url="http://127.0.0.1:9001",
            relay_agent_id="remote1",
            name="Guest",
            display_name="Guest",
            profession="",
            profile="gprof",
            location="",
        )
    )
    from api.game.agent import resolve_game_agent_token

    g = resolve_game_agent_token("访客", svc)
    assert g is not None and getattr(g, "id", None) == "pv_alias"
    assert resolve_game_agent_token("visitor", svc).id == "pv_alias"
    assert resolve_game_agent_token("gprof", svc).id == "pv_alias"


def test_resolve_visitor_alias_ambiguous_two_visitors(svc: GameService):
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_a",
            relay_base_url="http://127.0.0.1:9001",
            relay_agent_id="r1",
            name="A",
            display_name="A",
            profession="",
            profile="pa",
            location="",
        )
    )
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_b",
            relay_base_url="http://127.0.0.1:9002",
            relay_agent_id="r2",
            name="B",
            display_name="B",
            profession="",
            profile="pb",
            location="",
        )
    )
    from api.game.agent import resolve_game_agent_token

    assert resolve_game_agent_token("访客", svc) is None
    assert resolve_game_agent_token("pa", svc) is not None


def test_resolve_world_unique_profile_default(svc: GameService):
    """多名 Agent 共 profile default 时，不能用 default 当 relay 目标（须用 id）。"""
    n_default = sum(
        1 for a in svc.world.agents if str(getattr(a, "profile", "") or "").strip().lower() == "default"
    )
    if n_default > 1:
        assert resolve_world_agent_token("default", svc) is None
    assert resolve_world_agent_token("A", svc) is not None


def test_resolve_world_excludes_peer_visitor(svc: GameService):
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_only",
            relay_base_url="http://127.0.0.1:1",
            relay_agent_id="z",
            name="V",
            display_name="V",
            profession="",
            profile="p",
            location="休息室",
        )
    )
    assert resolve_game_agent_token("pv_only", svc) is not None
    assert resolve_world_agent_token("pv_only", svc) is None


def test_allowed_peer_bases_merges_env_and_db_presets(monkeypatch, svc: GameService):
    monkeypatch.setenv("HERMES_BUNGALOW_PEERS", "http://127.0.0.1:8000")
    svc.put_peer_presets(
        [
            {
                "id": "p1",
                "label": "友",
                "base_url": "http://peer.example:9999/x",
                "relay_agent_id": "",
                "peer_token": "",
            }
        ]
    )
    bases = svc.allowed_peer_bases()
    assert "http://127.0.0.1:8000" in bases
    assert "http://peer.example:9999/x" in bases


def test_put_peer_presets_preserves_token_when_key_omitted(svc: GameService):
    svc.put_peer_presets(
        [
            {
                "id": "a",
                "label": "A",
                "base_url": "http://127.0.0.1:1",
                "relay_agent_id": "",
                "peer_token": "secret-one",
            }
        ]
    )
    svc.put_peer_presets([{"id": "a", "label": "A2", "base_url": "http://127.0.0.1:1"}])
    raw = svc.get_peer_preset("a")
    assert raw and raw.get("peer_token") == "secret-one"


def test_active_outbound_meta_roundtrip(svc: GameService):
    assert svc.get_active_outbound_visit() is None
    svc.set_active_outbound_visit("p1", "友", "http://127.0.0.1:2", "pv_abc")
    got = svc.get_active_outbound_visit()
    assert got and got["visitor_id"] == "pv_abc" and got["preset_id"] == "p1"
    svc.clear_active_outbound_visit()
    assert svc.get_active_outbound_visit() is None


def test_peers_normalize_and_allowlist(monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_PEERS", "http://127.0.0.1:8000/,http://example.com:9000/foo")
    from api.game.peers import load_peer_allowlist, peer_base_in_allowlist, normalize_peer_base_url

    allow = load_peer_allowlist()
    assert normalize_peer_base_url("http://127.0.0.1:8000") in allow
    assert peer_base_in_allowlist("http://127.0.0.1:8000", allow=allow)
    assert peer_base_in_allowlist("http://example.com:9000/foo", allow=allow)


def test_cross_peer_relay_uses_httpx_mock(monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_PEER_TOKEN", "shared-secret-token")
    monkeypatch.setenv("HERMES_BUNGALOW_PEERS", "http://127.0.0.1:5555")
    import server as srv

    class FakeResp:
        status_code = 200
        text = ""
        reason_phrase = "OK"

        def json(self):
            return {"ok": True, "reply": "from-peer", "error": None}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            assert "agent-relay-from-peer" in url
            assert json.get("target_agent_id") == "pymaster"
            return FakeResp()

    import api.game.peers as peers_mod

    monkeypatch.setattr(peers_mod.httpx, "Client", lambda *a, **k: FakeClient())
    out = srv._cross_peer_relay_sync("http://127.0.0.1:5555", "pymaster", "hello")
    assert out.get("reply") == "from-peer"


def test_run_recursive_peer_invokes_cross_relay_visitor(monkeypatch, svc: GameService):
    monkeypatch.setenv("HERMES_BUNGALOW_PEER_TOKEN", "tok")
    monkeypatch.setenv("HERMES_BUNGALOW_PEERS", "http://127.0.0.1:9000")
    svc.register_peer_visitor(
        PeerVisitor(
            visitor_id="pv_x",
            relay_base_url="http://127.0.0.1:9000",
            relay_agent_id="real_agent",
            name="V",
            display_name="V",
            profession="",
            profile="visp",
            location="",
        )
    )
    inv = svc.world.agents[0]
    calls: list[tuple[str, str, str]] = []

    def fake_cross(base: str, rid: str, msg: str, *, allow=None, peer_token_override=None):
        calls.append((base, rid, msg))
        return {"ok": True, "reply": "hi-remote", "error": None, "trace": [{"type": "reasoning", "text": "think"}]}

    monkeypatch.setattr("api.game.peers.cross_peer_agent_relay_sync", fake_cross)
    with svc._lock:
        agents = list(svc.world.agents)
    out = run_recursive_peer_invokes(svc, inv, [("visp", "ping")], 0, "", "", agents, event_sink=None, run_id="")
    assert calls and calls[0][0] == "http://127.0.0.1:9000" and calls[0][1] == "real_agent"
    assert "【同伴回合" in calls[0][2] or "ping" in calls[0][2]
    assert out[0]["ok"] is True
    assert out[0]["reply"] == "hi-remote"
    assert out[0]["trace"][0]["type"] == "reasoning"


def test_create_task_structured_fields(svc: GameService):
    t = svc.create_task(
        {
            "name": "大需求",
            "catalog": "产品/需求",
            "description": "实现登录",
            "due_at": "2026-12-31",
            "deliverables": "PRD\n原型",
            "acceptance_criteria": "可登录",
            "estimated_hours": 8,
        }
    )
    assert t.name == "大需求"
    assert t.catalog == "产品/需求"
    assert t.due_at == "2026-12-31"
    assert "PRD" in t.deliverables
    assert t.estimated_hours == 8.0
    assert t.progress == 0.0


def test_update_task_patch_metadata(svc: GameService):
    t = svc.create_task({"name": "A"})
    r = svc.update_task(
        {
            "task_id": t.id,
            "description": "更新描述",
            "deliverables": "文档",
            "acceptance_criteria": "已审",
            "catalog": "研发/后端",
        }
    )
    assert r["ok"] is True
    assert r["task"]["catalog"] == "研发/后端"
    assert r["task"]["description"] == "更新描述"
    assert r["task"]["deliverables"] == "文档"


def test_delete_task_clears_assignee(svc: GameService):
    t = svc.create_task({"name": "待删"})
    tid = t.id
    r = svc.assign_task(tid, svc.world.agents[0].id)
    assert r.get("ok") is True
    assert svc.world.agents[0].current_task_id == tid
    d = svc.delete_task(tid)
    assert d.get("ok") is True
    assert not any(x.id == tid for x in svc.world.tasks)
    assert svc.world.agents[0].current_task_id is None


def test_task_progress_from_llm_events(svc: GameService):
    from api.game.llm_events import apply_parsed_events

    t = svc.create_task({"name": "x"})
    tid = t.id
    world = svc.world
    applied = apply_parsed_events(world, [{"type": "task_progress", "task_id": tid, "progress": 42}], emit=None)
    task = next(x for x in world.tasks if x.id == tid)
    assert task.progress == 42.0
    assert len(applied) == 1
