"""Monitor / work-order / artifact routes."""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse


async def get_monitor_work_orders(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    return JSONResponse({"ok": True, "work_orders": task_service.monitor_list_work_orders(80)})


async def get_monitor_work_order_detail(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    wo_id = str(request.path_params.get("wo_id") or "").strip()
    if not wo_id:
        return JSONResponse({"ok": False, "error": "missing_id"}, status_code=400)
    d = task_service.monitor_get_work_order_detail(wo_id)
    if not d:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "work_order": d})


async def get_monitor_artifact_body(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    aid = str(request.path_params.get("artifact_id") or "").strip()
    if not aid:
        return JSONResponse({"ok": False, "error": "missing_id"}, status_code=400)
    row = task_service.monitor_get_artifact_body(aid)
    if not row:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "artifact": row})
