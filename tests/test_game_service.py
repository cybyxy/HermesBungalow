from __future__ import annotations

import json

import pytest

from api.game.persistence import world_from_dict
from api.game.service import GameService


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
