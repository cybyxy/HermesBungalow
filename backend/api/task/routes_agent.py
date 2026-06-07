"""Agent CRUD + profile management routes."""
from __future__ import annotations

import re
import random
import time
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from api.task.service import read_json_body


def _slug_profile_name(raw: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", raw.strip().lower()).strip("-_")
    if not s:
        s = f"agent-{int(time.time())}"
    if not re.match(r"^[a-z0-9]", s):
        s = f"a-{s}"
    return s[:64]


async def get_agents(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    rows: list[dict[str, Any]] = []
    for a in task_service.world.agents:
        d = dict(a.to_dict())
        sid = task_service.get_hermes_session_id(a.id)
        if not sid:
            try:
                sid = task_service.ensure_hermes_session_for_agent(a.id)
            except Exception:
                sid = ""
        d["hermes_session_id"] = sid or ""
        rows.append(d)
    return JSONResponse({"agents": rows})


async def post_agent(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent = task_service.add_agent(body)
    task_service.persist()
    return JSONResponse({"ok": True, "agent": agent.to_dict()})


async def post_agent_update(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent = task_service.update_agent(body)
    task_service.persist()
    if not agent:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "agent": agent.to_dict()})


async def post_agent_delete(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    res = task_service.delete_agent(str(body.get("agent_id", "")))
    task_service.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_sync_hermes_agents(request: Request) -> JSONResponse:  # noqa: ARG001
    from server import task_service  # noqa: PLC0415
    synced = task_service.sync_agents_from_hermes()
    return JSONResponse({"ok": True, "synced": synced, "agent_count": len(task_service.world.agents)})


async def post_create_hermes_profile_agent(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    display_name = str(body.get("name") or "").strip()
    profile_name = str(body.get("profile_name") or "").strip().lower()
    if not display_name:
        return JSONResponse({"ok": False, "error": "name_required"}, status_code=400)
    if not profile_name:
        profile_name = _slug_profile_name(display_name)
    soul = str(body.get("soul") or "").strip()
    memory = str(body.get("memory") or "").strip()
    gender_raw = str(body.get("gender") or "random").strip().lower()
    if gender_raw == "random":
        gender_resolved = random.choice(("male", "female"))
    elif gender_raw in ("male", "female"):
        gender_resolved = gender_raw
    else:
        gender_resolved = "male"

    try:
        from api.profiles import create_profile_api, switch_profile, get_hermes_home_for_profile, _validate_profile_name

        _validate_profile_name(profile_name)
        prof = create_profile_api(profile_name, clone_from="default", clone_config=True)
        home = get_hermes_home_for_profile(profile_name)
        home.mkdir(parents=True, exist_ok=True)
        soul_file = home / "SOUL.md"
        soul_text = soul or f"你叫**{display_name}**，是 Hermes 数字工作室的成员。"
        soul_file.write_text(soul_text, encoding="utf-8")
        if memory:
            (home / "memory.md").write_text(memory, encoding="utf-8")

        switch_profile(profile_name, process_wide=True)
        task_service.sync_agents_from_hermes()
        for a in task_service.world.agents:
            if str(getattr(a, "profile", "") or "").strip() == profile_name:
                task_service.update_agent({"id": a.id, "gender": gender_resolved})
                break
        task_service.persist()
        return JSONResponse({
            "ok": True, "profile": prof, "profile_name": profile_name,
            "display_name": display_name, "agent_count": len(task_service.world.agents),
        })
    except FileExistsError:
        return JSONResponse({"ok": False, "error": "profile_exists", "profile_name": profile_name}, status_code=409)
    except Exception as e:
        return JSONResponse({"ok": False, "error": "create_profile_failed", "detail": str(e)}, status_code=500)


async def get_agent_profile_files(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    agent_id = str(request.query_params.get("agent_id") or "").strip()
    if not agent_id:
        return JSONResponse({"ok": False, "error": "agent_id_required"}, status_code=400)
    agent = next((a for a in task_service.world.agents if a.id == agent_id), None)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    profile = str(getattr(agent, "profile", "default") or "default")
    try:
        from api.profiles import get_hermes_home_for_profile

        home = get_hermes_home_for_profile(profile)
        soul_path = home / "SOUL.md"
        memory_path = home / "memory.md"
        soul = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
        memory = memory_path.read_text(encoding="utf-8") if memory_path.exists() else ""
        # 扫描 ~/.hermes/skills/ 目录，列出所有可用技能
        skills: list[dict[str, str]] = []
        from pathlib import Path as _Path
        skills_dir = _Path.home() / ".hermes" / "skills"
        if skills_dir.is_dir():
            for cat_dir in sorted(skills_dir.iterdir()):
                if not cat_dir.is_dir() or cat_dir.name.startswith('.'):
                    continue
                for skill_dir in sorted(cat_dir.iterdir()):
                    if not skill_dir.is_dir():
                        continue
                    skmd = skill_dir / "SKILL.md"
                    if skmd.exists():
                        text = skmd.read_text(encoding="utf-8")
                        name = skill_dir.name
                        desc = ""
                        if text.startswith("---"):
                            parts = text.split("---", 2)
                            if len(parts) >= 3:
                                for line in parts[1].split("\n"):
                                    line = line.strip()
                                    if line.startswith("name:"):
                                        name = line.split(":", 1)[1].strip()
                                    elif line.startswith("description:"):
                                        desc = line.split(":", 1)[1].strip().strip('"')
                        skills.append({"name": name, "description": desc, "category": cat_dir.name})
        return JSONResponse({"ok": True, "profile": profile, "soul": soul, "memory": memory, "skills": skills})
    except Exception as e:
        return JSONResponse({"ok": False, "error": "read_profile_files_failed", "detail": str(e)}, status_code=500)


async def post_agent_profile_files_save(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    if not agent_id:
        return JSONResponse({"ok": False, "error": "agent_id_required"}, status_code=400)
    agent = next((a for a in task_service.world.agents if a.id == agent_id), None)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    profile = str(getattr(agent, "profile", "default") or "default")
    has_soul = "soul" in body
    has_memory = "memory" in body
    soul = str(body.get("soul") or "")
    memory = str(body.get("memory") or "")
    reset_soul = bool(body.get("reset_soul"))
    try:
        from api.profiles import get_hermes_home_for_profile

        home = get_hermes_home_for_profile(profile)
        home.mkdir(parents=True, exist_ok=True)
        soul_path = home / "SOUL.md"
        memory_path = home / "memory.md"
        if reset_soul:
            soul = f"你叫**{agent.name}**，是 Hermes 数字工作室的成员。"
            soul_path.write_text(soul, encoding="utf-8")
        elif has_soul:
            soul_path.write_text(soul, encoding="utf-8")
        if has_memory:
            memory_path.write_text(memory, encoding="utf-8")
        if has_soul or reset_soul:
            task_service.sync_agents_from_hermes()
            task_service.persist()
        return JSONResponse({"ok": True, "profile": profile})
    except Exception as e:
        return JSONResponse({"ok": False, "error": "save_profile_files_failed", "detail": str(e)}, status_code=500)
