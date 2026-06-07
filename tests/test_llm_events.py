from __future__ import annotations

from api.task.events import apply_parsed_events, extract_game_event_tags, normalize_workflow_steps
from api.task.models import Agent, TaskWorld, Task
from api.task.context import parse_task_workflow_llm_reply


def test_normalize_workflow_steps_orders_and_kind():
    raw = [
        {"id": "b", "order": 2, "title": "B", "kind": "bogus"},
        {"order": 1, "title": "A", "kind": "analyze"},
    ]
    out = normalize_workflow_steps(raw)
    assert [x["order"] for x in out] == [1, 2]
    assert out[1]["kind"] == "other"


def test_parse_task_workflow_plain_json():
    text = '说明文字\n{"summary":"s","steps":[{"id":"a","order":1,"title":"分析","kind":"analyze"}]}\n'
    ev = parse_task_workflow_llm_reply(text, 99)
    assert ev is not None
    assert ev["task_id"] == 99
    assert ev["steps"][0]["id"] == "a"


def test_parse_task_workflow_fenced_json():
    text = '```json\n{"steps":[{"id":"x","order":1,"title":"T","kind":"design"}]}\n```'
    ev = parse_task_workflow_llm_reply(text, 3)
    assert ev is not None
    assert ev["task_id"] == 3


def test_task_workflow_plan_game_event_roundtrip():
    blob = (
        'prefix\n[[GAME_EVENT:{"type":"task_workflow_plan","task_id":7,'
        '"summary":"s","steps":[{"id":"s1","order":1,"title":"分析","kind":"analyze"}]}]]\n'
    )
    evs = extract_game_event_tags(blob)
    assert len(evs) == 1
    w = TaskWorld(agents=[Agent(id="A", name="a", profession="p")], tasks=[Task(id=7, name="T")])
    applied = apply_parsed_events(w, evs, emit=None)
    assert len(applied) == 1
    assert w.tasks[0].workflow_steps[0]["id"] == "s1"
