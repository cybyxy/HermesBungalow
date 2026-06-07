"""Task CRUD + DAG + workflow routes."""
from __future__ import annotations

import asyncio
from functools import partial
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from api.task.service import read_json_body


async def get_tasks(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    return JSONResponse({"tasks": [t.to_dict() for t in task_service.world.tasks]})


async def get_rooms(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    return JSONResponse({"rooms": [r.to_dict() for r in task_service.world.rooms]})


async def post_task(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    task = task_service.create_task(body)
    task_service.persist()
    return JSONResponse({"ok": True, "task": task.to_dict()})


async def post_lord_create_task(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, partial(task_service.lord_create_task, body))
    except Exception as e:
        return JSONResponse({"ok": False, "error": "lord_create_task_failed", "detail": str(e)}, status_code=500)
    return JSONResponse(dict(result))


async def post_task_assign(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.assign_task(int(body.get("task_id", 0)), body.get("agent_id"))
    task_service.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_task_complete(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.complete_task(int(body.get("task_id", 0)), int(body.get("quality", 0)))
    task_service.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_task_dependency(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    task_id = int(body.get("task_id", 0))
    depends_on = body.get("depends_on")
    if not isinstance(depends_on, list):
        depends_on = []
    res = task_service.set_task_dependency(task_id, depends_on)
    task_service.persist()
    if not res.get("ok"):
        status = 404 if res.get("error") == "task_not_found" else 400
        return JSONResponse(res, status_code=status)
    return JSONResponse(res)


async def post_task_batch_create(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    tasks_data = body.get("tasks")
    if not isinstance(tasks_data, list):
        return JSONResponse({"ok": False, "error": "tasks_array_required"}, status_code=400)
    res = task_service.batch_create_tasks(tasks_data)
    task_service.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def get_task_board_query(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    filters_status = request.query_params.get("status")
    filters_profession = request.query_params.get("profession")
    with task_service._lock:
        tasks = list(task_service.world.tasks)
    if filters_status:
        tasks = [t for t in tasks if t.status == filters_status]
    if filters_profession:
        tasks = [t for t in tasks if t.required_profession == filters_profession]
    return JSONResponse({
        "tasks": [
            {
                **t.to_dict(),
                "depend_names": [
                    next((x.name for x in task_service.world.tasks if x.id == d), f"#{d}")
                    for d in (getattr(t, "depends_on", []) or [])
                ],
            }
            for t in tasks
        ]
    })


async def post_task_claim(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.claim_task(int(body.get("task_id", 0)), str(body.get("agent_id", "")))
    task_service.persist()
    if not res.get("ok"):
        code = 404 if res.get("error") == "task_not_found" else 400
        return JSONResponse(res, status_code=code)
    return JSONResponse(res)


async def get_task_chain(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    return JSONResponse(task_service.get_task_chain())


async def post_task_delete(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.delete_task(int(body.get("task_id", 0)))
    task_service.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_task_update(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.update_task(body)
    task_service.persist()
    if not res.get("ok"):
        code = 404 if res.get("error") == "task_not_found" else 400
        return JSONResponse(res, status_code=code)
    return JSONResponse(res)


async def post_task_workflow_generate(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    task_id = int(body.get("task_id", 0))
    agent_id = str(body.get("agent_id") or "").strip()
    raw_ex = body.get("user_skill_excerpt")
    excerpt = str(raw_ex).strip() if raw_ex is not None else None
    if not task_id or not agent_id:
        return JSONResponse({"ok": False, "error": "task_id_and_agent_id_required"}, status_code=400)
    loop = asyncio.get_event_loop()
    try:
        res = await loop.run_in_executor(
            None,
            lambda: task_service.generate_task_workflow_with_llm(agent_id, task_id, excerpt),
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": "workflow_generate_failed", "detail": str(e)}, status_code=500)
    if not res.get("ok"):
        err = str(res.get("error") or "bad_request")
        code = 404 if err == "agent_not_found" else 400
        return JSONResponse(res, status_code=code)
    return JSONResponse(res)
