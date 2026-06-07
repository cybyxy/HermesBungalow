from __future__ import annotations

import pytest

from api.task.models import Task
from api.task.persistence import world_from_dict
from api.task.service import TaskService


@pytest.fixture
def svc(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC", "1")
    monkeypatch.setenv("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "1")
    db = tmp_path / "t.db"
    return TaskService(db_path=db)


def test_delete_task_removes_and_unknown_fails(svc: TaskService):
    svc.world.tasks.append(Task(id=1, name="测试任务", description="测试"))
    assert svc.world.tasks
    tid = int(svc.world.tasks[0].id)
    r = svc.delete_task(tid)
    assert r.get("ok") is True
    assert not any(x.id == tid for x in svc.world.tasks)
    r2 = svc.delete_task(tid)
    assert r2.get("ok") is False
    assert r2.get("error") == "task_not_found"


def test_world_from_dict_event_log_default():
    w = world_from_dict({"agents": [], "tasks": []})
    assert w.event_log == []


def test_agent_hermes_session_id_roundtrip():
    from api.task.models import Agent, TaskWorld

    a = Agent(
        id="x",
        name="n",
        profession="p",
        hermes_session_id="sess_abc",
    )
    w = TaskWorld(agents=[a])
    w2 = world_from_dict(w.to_dict())
    assert w2.agents[0].hermes_session_id == "sess_abc"
