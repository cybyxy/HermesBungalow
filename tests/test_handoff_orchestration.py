from __future__ import annotations

import contextlib
import threading
from typing import Any

import pytest

from api.game import agent as agent_mod
from api.game.handoff_parser import parse_user_handoff_prefix, parse_hermes_bungalow_invokes


def test_parse_user_handoff_at_pipe():
    h = parse_user_handoff_prefix("@bob| do the thing")
    assert h is not None
    assert h["token"] == "bob"
    assert h["message"] == "do the thing"


def test_parse_user_handoff_at_space():
    h = parse_user_handoff_prefix("@bob please do")
    assert h is not None
    assert h["token"] == "bob"
    assert h["message"] == "please do"


def test_parse_hermes_bungalow_invokes_dedup():
    rows = parse_hermes_bungalow_invokes("@a | one\n@a | one\n@b two")
    assert rows == [("a", "one"), ("b", "two")]


class _FakeWorld:
    def __init__(self, agents: list[Any]) -> None:
        self.agents = agents


class _FakeGame:
    def __init__(self, agents: list[Any]) -> None:
        self.world = _FakeWorld(agents)
        self._lock = threading.Lock()

    def iter_agents_for_token_resolve(self):
        yield from self.world.agents

    def ensure_hermes_session_for_agent(self, agent_id: str) -> str:
        return f"sid-{agent_id}"


class _Ag:
    __slots__ = ("id", "profile", "name", "display_name")

    def __init__(self, id: str, profile: str, name: str = "") -> None:
        self.id = id
        self.profile = profile
        self.name = name or profile
        self.display_name = ""


@pytest.fixture
def three_agents() -> list[_Ag]:
    return [_Ag("a1", "p1", "Alice"), _Ag("a2", "p2", "Bob"), _Ag("a3", "p3", "Carol")]


def test_run_recursive_peer_invokes_nested(monkeypatch: pytest.MonkeyPatch, three_agents: list[_Ag]):
    calls: list[tuple[str | None, str]] = []

    def fake_sync(
        session_id: str,
        message: str,
        game_service: Any,
        *,
        bungalow_agent_id: str | None = None,
        attachments: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        calls.append((bungalow_agent_id, message))
        if bungalow_agent_id == "a1":
            return {"ok": True, "reply": "primary out\n@p2 | nested task", "error": None}
        if bungalow_agent_id == "a2":
            return {"ok": True, "reply": "peer2\n@p3 | deeper", "error": None}
        if bungalow_agent_id == "a3":
            return {"ok": True, "reply": "leaf", "error": None}
        return {"ok": False, "reply": "", "error": "unknown_agent"}

    monkeypatch.setattr(agent_mod, "sync_session_turn", fake_sync)
    game = _FakeGame(three_agents)
    agents = three_agents
    primary = agents[0]
    invokes = parse_hermes_bungalow_invokes("primary out\n@p2 | nested task")
    deleg = agent_mod.run_recursive_peer_invokes(
        game, primary, invokes, 0, "primary out\n@p2 | nested task", "", agents
    )
    assert len(deleg) == 1
    assert deleg[0]["target"] == "p2"
    assert len(deleg[0]["nested"]) == 1
    assert deleg[0]["nested"][0]["target"] == "p3"
    assert bungalow_agent_id_sequence(calls) == ["a2", "a3"]


def bungalow_agent_id_sequence(calls: list[tuple[str | None, str]]) -> list[str]:
    return [c[0] or "?" for c in calls]


def test_maybe_append_peer_reply_queue_writes_sequential_user_rows(
    monkeypatch: pytest.MonkeyPatch, three_agents: list[_Ag],
) -> None:
    """≥2 顶层同伴回复时，按序写入源会话 messages（单 save 前多条 user）。"""

    class _Sess:
        def __init__(self) -> None:
            self.session_id = "sid-x"
            self.messages: list[Any] = []
            self.save_calls = 0

        def save(self, **_k: Any) -> None:
            self.save_calls += 1

    sess = _Sess()

    def fake_get_session(_sid: str) -> Any:
        return sess

    monkeypatch.setattr("api.models.get_session", fake_get_session)
    monkeypatch.setattr("api.config._get_session_agent_lock", lambda _sid: contextlib.nullcontext())
    monkeypatch.setattr(
        "api.game.service.bungalow_session_tls_for_agent_id",
        lambda *_a, **_k: contextlib.nullcontext(),
    )

    game = _FakeGame(three_agents)
    invoker = three_agents[0]
    deleg = [
        {"ok": True, "reply": "first", "target": "p2"},
        {"ok": True, "reply": "second", "target": "p3"},
    ]
    agent_mod.maybe_append_peer_reply_queue_to_invoker_session(game, invoker, deleg)
    assert len(sess.messages) == 2
    assert sess.messages[0]["role"] == "user"
    assert "1/2" in sess.messages[0]["content"] and "Bob" in sess.messages[0]["content"] and "first" in sess.messages[0]["content"]
    assert sess.messages[1]["role"] == "user"
    assert "2/2" in sess.messages[1]["content"] and "Carol" in sess.messages[1]["content"] and "second" in sess.messages[1]["content"]
    assert sess.save_calls == 1


def test_maybe_append_peer_reply_queue_skips_single_reply(
    monkeypatch: pytest.MonkeyPatch, three_agents: list[_Ag],
) -> None:
    class _Sess:
        def __init__(self) -> None:
            self.session_id = "sid-x"
            self.messages: list[Any] = []

        def save(self, **_k: Any) -> None:
            pass

    sess = _Sess()
    monkeypatch.setattr("api.models.get_session", lambda _sid: sess)
    monkeypatch.setattr("api.config._get_session_agent_lock", lambda _sid: contextlib.nullcontext())
    monkeypatch.setattr(
        "api.game.service.bungalow_session_tls_for_agent_id",
        lambda *_a, **_k: contextlib.nullcontext(),
    )
    game = _FakeGame(three_agents)
    invoker = three_agents[0]
    agent_mod.maybe_append_peer_reply_queue_to_invoker_session(
        game, invoker, [{"ok": True, "reply": "only", "target": "p2"}],
    )
    assert sess.messages == []


def test_orchestrated_peer_turns_sync_happy_path(monkeypatch: pytest.MonkeyPatch, three_agents: list[_Ag]):
    calls: list[tuple[str | None, str]] = []

    def fake_sync(
        session_id: str,
        message: str,
        game_service: Any,
        *,
        bungalow_agent_id: str | None = None,
        attachments: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        calls.append((bungalow_agent_id, message))
        if bungalow_agent_id == "a1":
            assert "peer" in message or "同伴" in message  # server-injected peer hint (zh)
            return {"ok": True, "reply": "ok\n@p2 | go", "error": None}
        if bungalow_agent_id == "a2":
            return {"ok": True, "reply": "relay ok", "error": None}
        return {"ok": False, "reply": "", "error": "x"}

    monkeypatch.setattr(agent_mod, "sync_session_turn", fake_sync)
    game = _FakeGame(three_agents)
    primary = three_agents[0]
    out = agent_mod.orchestrated_peer_turns_sync(primary, "user hi", True, game, primary_attachments=None)
    assert out["ok"] is True
    assert "primary" in out
    assert len(out["delegations"]) == 1
    assert out["delegations"][0]["ok"] is True
    assert bungalow_agent_id_sequence(calls) == ["a1", "a2"]
