# Hermes Gateway桥接层路由 + WebSocket
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import FastAPI
import json
import asyncio
import os
import time
from pathlib import Path
import subprocess
import re

router = APIRouter(prefix="/api", tags=["Gateway"])
ENERGY_STATE_FILE = Path(os.path.expanduser("~/.hermes/hermes-bungalow-energy.json"))

# WebSocket连接管理
active_connections: list[WebSocket] = []


def _read_energy_state() -> dict:
    default = {"energy": 80.0, "updated_at": int(time.time())}
    try:
        if not ENERGY_STATE_FILE.exists():
            return default
        payload = json.loads(ENERGY_STATE_FILE.read_text(encoding="utf-8", errors="ignore") or "{}")
        energy = float(payload.get("energy", default["energy"]))
        energy = max(0.0, min(100.0, energy))
        updated_at = int(payload.get("updated_at", int(time.time())))
        return {"energy": energy, "updated_at": updated_at}
    except Exception:
        return default


def _write_energy_state(energy: float) -> dict:
    normalized = max(0.0, min(100.0, float(energy)))
    state = {"energy": normalized, "updated_at": int(time.time())}
    try:
        ENERGY_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        ENERGY_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    except Exception:
        # 写失败时返回内存态，避免接口报错阻断前端
        pass
    return state


@router.post("/chat")
async def chat(message: dict):
    """对话接口 — 访客发消息 → LLM回复 + 事件标签"""
    from ..services.gateway_bridge import gateway_bridge

    response = await gateway_bridge.send_message(message.get("message", ""))
    return {
        "reply": response.reply,
        "events": [e.model_dump() for e in response.events],
    }


@router.get("/sessions")
async def list_sessions():
    """列出所有会话"""
    from ..services.chat_service import chat_service
    sessions = await chat_service.list_sessions()
    return {"sessions": sessions}


@router.get("/hermes/skills")
async def list_hermes_skills():
    """
    通过 `hermes skills list` 获取已安装技能，并返回结构化分类数据。
    若命令不可用，则回退到本地配置/目录读取。
    """
    parsed_skills: list[dict] = []
    source_hint = "hermes skills list"

    def _discover_skill_catalog() -> list[dict]:
        catalog: list[dict] = []
        root = Path(os.path.expanduser("~/.hermes/skills"))
        if root.exists() and root.is_dir():
            for skill_md in root.rglob("SKILL.md"):
                # 固定结构：~/.hermes/skills/<category>/<name>/SKILL.md
                rel_parts = skill_md.relative_to(root).parts
                if len(rel_parts) < 3:
                    continue
                category = rel_parts[0]
                name = rel_parts[1]
                catalog.append({
                    "name": name,
                    "category": category,
                    "source": "builtin",
                    "path": skill_md,
                })
        # 去重（同名技能优先保留第一条）
        seen = set()
        dedup = []
        for item in catalog:
            if item["name"] in seen:
                continue
            seen.add(item["name"])
            dedup.append(item)
        return dedup

    skill_catalog = _discover_skill_catalog()

    def _resolve_truncated_skill_name(raw_name: str, category: str, source: str) -> str:
        if "…" not in raw_name:
            return raw_name
        prefix = raw_name.replace("…", "")
        matches = [s for s in skill_catalog if s["name"].startswith(prefix)]
        if category:
            cat_matches = [s for s in matches if s["category"] == category]
            if cat_matches:
                matches = cat_matches
        if source:
            src_matches = [s for s in matches if s["source"] == source]
            if src_matches:
                matches = src_matches
        return matches[0]["name"] if matches else raw_name

    def _skill_md_path_candidates(skill_name: str, category: str) -> list[Path]:
        """
        递归查找 SKILL.md：
        1) 优先在 ~/.hermes/skills/<category>/<skill_name>/ 下无限级递归
        2) 兜底在 ~/.hermes/skills 全目录无限级递归
        """
        root = Path(os.path.expanduser("~/.hermes/skills"))
        candidates: list[Path] = []

        # 优先：分类 + 技能目录下递归查找
        if category:
            scoped_root = root / category / skill_name
            if scoped_root.exists() and scoped_root.is_dir():
                candidates.extend(sorted(scoped_root.rglob("SKILL.md")))

        # 兜底：按 catalog 已知路径
        if not candidates:
            candidates.extend([item["path"] for item in skill_catalog if item["name"] == skill_name])

        # 再兜底：全局扫描所有同名目录下的 SKILL.md
        if not candidates and root.exists() and root.is_dir():
            for dir_path in root.rglob(skill_name):
                if dir_path.is_dir():
                    candidates.extend(sorted(dir_path.rglob("SKILL.md")))

        # 去重
        deduped: list[Path] = []
        seen = set()
        for p in candidates:
            s = str(p)
            if s in seen:
                continue
            seen.add(s)
            deduped.append(p)
        return deduped

    def _extract_skill_metadata(skill_name: str, category: str) -> dict:
        metadata = {
            "description": "",
            "version": "",
            "author": "",
            "license": "",
            "skill_md_path": "",
        }
        for path in _skill_md_path_candidates(skill_name, category):
            if not path.exists():
                continue
            metadata["skill_md_path"] = str(path)
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            lines = content.splitlines()

            # 解析 frontmatter (--- ... ---)
            if len(lines) >= 3 and lines[0].strip() == "---":
                fm_lines = []
                for i in range(1, len(lines)):
                    if lines[i].strip() == "---":
                        break
                    fm_lines.append(lines[i])

                i = 0
                while i < len(fm_lines):
                    line = fm_lines[i].strip()
                    if line.startswith("description:"):
                        value = line.split(":", 1)[1].strip()
                        if value in (">", ">-", "|", "|-"):
                            desc_parts = []
                            i += 1
                            while i < len(fm_lines) and (fm_lines[i].startswith("  ") or fm_lines[i].startswith("\t")):
                                desc_parts.append(fm_lines[i].strip())
                                i += 1
                            metadata["description"] = " ".join(desc_parts).strip()
                            continue
                        metadata["description"] = value.strip("\"'")
                    elif line.startswith("version:"):
                        metadata["version"] = line.split(":", 1)[1].strip().strip("\"'")
                    elif line.startswith("author:"):
                        metadata["author"] = line.split(":", 1)[1].strip().strip("\"'")
                    elif line.startswith("license:"):
                        metadata["license"] = line.split(":", 1)[1].strip().strip("\"'")
                    i += 1

            # 若 frontmatter 无 description，回退到正文首行可读内容
            if not metadata["description"]:
                for raw_line in lines:
                    line = raw_line.strip()
                    if (
                        line
                        and not line.startswith("#")
                        and not line.startswith("```")
                        and not line.startswith("-")
                        and not line.startswith("*")
                        and line != "---"
                        and not line.endswith(":")
                    ):
                        metadata["description"] = line[:180]
                        break

            break

        return metadata

    try:
        proc = subprocess.run(
            ["hermes", "skills", "list", "--enabled-only"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        output = proc.stdout or ""
        if proc.returncode == 0 and output:
            for raw_line in output.splitlines():
                line = raw_line.strip()
                if not line.startswith("│"):
                    continue
                # 跳过表头行
                if "Name" in line and "Category" in line and "Source" in line:
                    continue
                # 解析 rich table: │ a │ b │ c │ d │ e │
                parts = [p.strip() for p in line.strip("│").split("│")]
                if len(parts) < 5:
                    continue
                raw_name, category, source, trust, status = parts[:5]
                name = _resolve_truncated_skill_name(raw_name, category or "", source or "")
                if not name:
                    continue
                parsed_skills.append({
                    "name": name,
                    "category": category or "uncategorized",
                    "source": source or "unknown",
                    "trust": trust or "unknown",
                    "status": status or "unknown",
                    **_extract_skill_metadata(name, category or ""),
                })
    except Exception:
        parsed_skills = []

    # 回退：读取本地目录（仅提供基础字段）
    if not parsed_skills:
        source_hint = "fallback local directory scan"
        skills_dir = Path(os.path.expanduser("~/.cursor/skills-cursor"))
        if skills_dir.exists() and skills_dir.is_dir():
            for child in skills_dir.iterdir():
                if child.is_dir() and (child / "SKILL.md").exists():
                    parsed_skills.append({
                        "name": child.name,
                        "category": "local",
                        "source": "local",
                        "trust": "local",
                        "status": "enabled",
                        **_extract_skill_metadata(child.name, "local"),
                    })

    parsed_skills.sort(key=lambda s: (s["category"], s["name"]))

    grouped: dict[str, list[dict]] = {}
    for skill in parsed_skills:
        grouped.setdefault(skill["category"], []).append(skill)

    return {
        "source": source_hint,
        "total": len(parsed_skills),
        "categories": grouped,
        "skills": parsed_skills,
    }


@router.get("/hermes/model-config")
async def get_hermes_model_config():
    """
    读取 Hermes 当前模型配置（用于前端展示）。
    """
    try:
        from ..services.gateway_bridge import _resolve_llm_config
        cfg = _resolve_llm_config() or {}
    except Exception:
        cfg = {}

    api_key = cfg.get("api_key") or ""
    masked_key = ""
    if api_key:
        masked_key = f"{api_key[:4]}***{api_key[-4:]}" if len(api_key) >= 8 else "***"

    config_path = ""
    try:
        cfg_path_proc = subprocess.run(
            ["hermes", "config", "path"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if cfg_path_proc.returncode == 0:
            config_path = (cfg_path_proc.stdout or "").strip()
    except Exception:
        pass

    return {
        "provider": cfg.get("provider") or "",
        "api_mode": cfg.get("api_mode") or "",
        "base_url": cfg.get("base_url") or "",
        "model": cfg.get("model") or "",
        "api_key_masked": masked_key,
        "config_path": config_path,
    }


@router.get("/hermes/current-model")
async def get_hermes_current_model():
    """
    给前端提供当前使用模型信息（轻量接口）。
    """
    try:
        from ..services.gateway_bridge import _resolve_llm_config
        cfg = _resolve_llm_config() or {}
    except Exception:
        cfg = {}

    model = cfg.get("model") or ""
    provider = cfg.get("provider") or ""
    api_mode = cfg.get("api_mode") or ""
    base_url = cfg.get("base_url") or ""

    # 兜底：当 runtime model 为空时，从 Hermes config 文件读取 model.default
    if not model:
        try:
            path_proc = subprocess.run(
                ["hermes", "config", "path"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            if path_proc.returncode == 0:
                cfg_path = (path_proc.stdout or "").strip()
                if cfg_path:
                    p = Path(cfg_path).expanduser()
                    if p.exists():
                        lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
                        in_model_block = False
                        for raw in lines:
                            line = raw.rstrip()
                            stripped = line.strip()
                            if not stripped or stripped.startswith("#"):
                                continue
                            if stripped.endswith(":") and not stripped.startswith("-"):
                                in_model_block = stripped == "model:"
                                continue
                            if not in_model_block:
                                continue
                            if stripped.startswith("default:"):
                                model = stripped.split(":", 1)[1].strip().strip("'\"")
                            elif stripped.startswith("provider:") and not provider:
                                provider = stripped.split(":", 1)[1].strip().strip("'\"")
                            elif stripped.startswith("base_url:") and not base_url:
                                base_url = stripped.split(":", 1)[1].strip().strip("'\"")
                            elif stripped.startswith("api_mode:") and not api_mode:
                                api_mode = stripped.split(":", 1)[1].strip().strip("'\"")
                            if model:
                                break
        except Exception:
            pass

    return {
        "model": model,
        "provider": provider,
        "api_mode": api_mode,
        "base_url": base_url,
    }


@router.get("/hermes/memories")
async def get_hermes_memories():
    """
    读取 Hermes 永久记忆（MEMORY.md / USER.md）。
    """
    memories_root = Path(os.path.expanduser("~/.hermes/memories"))
    files = [("MEMORY.md", "memory"), ("USER.md", "user")]
    items = []

    for filename, kind in files:
        path = memories_root / filename
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        # 使用 "§" 作为段落分隔（兼容当前文件格式），并保留非空文本
        chunks = [c.strip() for c in content.split("§") if c.strip()]
        for i, text in enumerate(chunks):
            items.append({
                "kind": kind,
                "file": str(path),
                "index": i + 1,
                "text": text,
            })

    return {
        "total": len(items),
        "items": items,
    }


@router.get("/chat/memory-mode")
async def get_chat_memory_mode():
    from ..services.chat_service import USE_HERMES_AGENT_MEMORY, LAST_CHAT_BACKEND_MODE
    return {
        "shared_memory_enabled": USE_HERMES_AGENT_MEMORY,
        "last_backend_mode": LAST_CHAT_BACKEND_MODE,
    }


@router.get("/chat/memory-check")
async def get_chat_memory_check():
    """
    一键检查共享记忆链路状态：Hermes CLI、memory provider、config 路径。
    """
    result = {
        "ok": True,
        "hermes_cli": "unknown",
        "memory_provider": "unknown",
        "config_path": "",
        "details": "",
    }
    try:
        cli_proc = subprocess.run(
            ["hermes", "--version"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        result["hermes_cli"] = "ok" if cli_proc.returncode == 0 else "error"
        if cli_proc.returncode != 0:
            result["ok"] = False
            result["details"] = (cli_proc.stderr or cli_proc.stdout or "").strip()

        status_proc = subprocess.run(
            ["hermes", "memory", "status"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if status_proc.returncode == 0:
            out = status_proc.stdout or ""
            for line in out.splitlines():
                if "Provider:" in line:
                    result["memory_provider"] = line.split("Provider:", 1)[1].strip()
                    break
        else:
            result["ok"] = False

        path_proc = subprocess.run(
            ["hermes", "config", "path"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if path_proc.returncode == 0:
            result["config_path"] = (path_proc.stdout or "").strip()
        else:
            result["ok"] = False
    except Exception as e:
        result["ok"] = False
        result["details"] = str(e)
    return result


@router.get("/hermes/overview")
async def get_hermes_overview():
    """
    Hermes GUI 总览信息：CLI、memory provider、config path、skills 数量。
    """
    overview = {
        "cli_ok": False,
        "cli_version": "",
        "memory_provider": "unknown",
        "config_path": "",
        "skills_count": 0,
        "model_name": "",
    }
    try:
        version_proc = subprocess.run(
            ["hermes", "--version"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if version_proc.returncode == 0:
            overview["cli_ok"] = True
            version_text = (version_proc.stdout or "").strip()
            m = re.search(r"v(\d+\.\d+\.\d+).*?(\d{4}\.\d{1,2}\.\d{1,2})", version_text)
            if m:
                overview["cli_version"] = f"v{m.group(1)} ({m.group(2)})"
            else:
                overview["cli_version"] = ""

        mem_proc = subprocess.run(
            ["hermes", "memory", "status"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if mem_proc.returncode == 0:
            for line in (mem_proc.stdout or "").splitlines():
                if "Provider:" in line:
                    overview["memory_provider"] = line.split("Provider:", 1)[1].strip()
                    break

        path_proc = subprocess.run(
            ["hermes", "config", "path"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if path_proc.returncode == 0:
            overview["config_path"] = (path_proc.stdout or "").strip()

        skills_proc = subprocess.run(
            ["hermes", "skills", "list", "--enabled-only"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        if skills_proc.returncode == 0:
            count = 0
            for raw in (skills_proc.stdout or "").splitlines():
                line = raw.strip()
                if line.startswith("│") and "Name" not in line and "Category" not in line:
                    parts = [p.strip() for p in line.strip("│").split("│")]
                    if len(parts) >= 5 and parts[0]:
                        count += 1
            overview["skills_count"] = count

        try:
            from ..services.gateway_bridge import _resolve_llm_config
            cfg = _resolve_llm_config() or {}
            overview["model_name"] = cfg.get("model") or ""
        except Exception:
            pass
    except Exception:
        pass
    return overview


@router.get("/hermes/health-check")
async def run_hermes_health_check():
    """
    一键链路测试：chat / skills / model-config。
    """
    checks = {
        "chat": {"ok": False, "message": ""},
        "skills": {"ok": False, "message": ""},
        "model_config": {"ok": False, "message": ""},
    }
    try:
        chat_proc = subprocess.run(
            [
                "hermes",
                "chat",
                "-Q",
                "-q",
                "请只回复 pong",
                "--source",
                "tool",
                "--accept-hooks",
                "--ignore-rules",
                "--max-turns",
                "1",
            ],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        checks["chat"]["ok"] = chat_proc.returncode == 0
        checks["chat"]["message"] = "ok" if chat_proc.returncode == 0 else (chat_proc.stderr or chat_proc.stdout or "").strip()
    except Exception as e:
        checks["chat"]["message"] = str(e)

    try:
        skills_proc = subprocess.run(
            ["hermes", "skills", "list", "--enabled-only"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        checks["skills"]["ok"] = skills_proc.returncode == 0
        checks["skills"]["message"] = "ok" if skills_proc.returncode == 0 else (skills_proc.stderr or skills_proc.stdout or "").strip()
    except Exception as e:
        checks["skills"]["message"] = str(e)

    try:
        cfg_proc = subprocess.run(
            ["hermes", "config", "show"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        checks["model_config"]["ok"] = cfg_proc.returncode == 0
        checks["model_config"]["message"] = "ok" if cfg_proc.returncode == 0 else (cfg_proc.stderr or cfg_proc.stdout or "").strip()
    except Exception as e:
        checks["model_config"]["message"] = str(e)

    all_ok = all(item["ok"] for item in checks.values())
    return {"ok": all_ok, "checks": checks}


@router.put("/hermes/model-config")
async def update_hermes_model_config(payload: dict):
    """
    更新 Hermes 模型配置并写回 Hermes 配置文件。
    通过 `hermes config set` 进行持久化。
    """
    field_to_key = {
        "model": "model.default",
        "provider": "model.provider",
        "base_url": "model.base_url",
        "api_key": "model.api_key",
        "api_mode": "model.api_mode",
    }

    updated = []
    errors = []

    for field, cfg_key in field_to_key.items():
        if field not in payload:
            continue
        value = payload.get(field)
        if value is None:
            continue
        value = str(value).strip()
        if not value:
            continue
        try:
            proc = subprocess.run(
                ["hermes", "config", "set", cfg_key, value],
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            if proc.returncode == 0:
                updated.append(field)
            else:
                errors.append({
                    "field": field,
                    "message": (proc.stderr or proc.stdout or "update failed").strip(),
                })
        except Exception as e:
            errors.append({"field": field, "message": str(e)})

    success = len(errors) == 0
    return {
        "ok": success,
        "updated_fields": updated,
        "errors": errors,
    }


@router.get("/hermes/channel-config")
async def get_hermes_channel_config():
    """
    读取 Hermes channel 配置（Telegram / Discord）。
    优先解析 ~/.hermes/config.yaml 中对应配置块。
    """
    config_path = ""
    try:
        cfg_path_proc = subprocess.run(
            ["hermes", "config", "path"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if cfg_path_proc.returncode == 0:
            config_path = (cfg_path_proc.stdout or "").strip()
    except Exception:
        pass

    result = {
        "telegram": {"bot_token": "", "chat_id": ""},
        "discord": {"bot_token": "", "channel_id": ""},
        "config_path": config_path,
    }

    if not config_path:
        return result

    path = Path(config_path).expanduser()
    if not path.exists():
        return result

    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return result

    current_section = ""
    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped in ("telegram:", "discord:"):
            current_section = stripped[:-1]
            continue
        if current_section not in ("telegram", "discord"):
            continue
        m = None
        if current_section == "telegram":
            m = (
                __import__("re").match(r"^\s*bot_token:\s*(.+?)\s*$", line)
                or __import__("re").match(r"^\s*chat_id:\s*(.+?)\s*$", line)
            )
            if m:
                key = line.split(":", 1)[0].strip()
                val = m.group(1).strip().strip("'\"")
                result["telegram"][key] = val
        elif current_section == "discord":
            m = (
                __import__("re").match(r"^\s*bot_token:\s*(.+?)\s*$", line)
                or __import__("re").match(r"^\s*channel_id:\s*(.+?)\s*$", line)
            )
            if m:
                key = line.split(":", 1)[0].strip()
                val = m.group(1).strip().strip("'\"")
                result["discord"][key] = val

    return result


@router.put("/hermes/channel-config")
async def update_hermes_channel_config(payload: dict):
    """
    更新 Hermes channel 配置（Telegram / Discord）。
    通过 `hermes config set` 持久化。
    """
    field_to_key = {
        "telegram_bot_token": "telegram.bot_token",
        "telegram_chat_id": "telegram.chat_id",
        "discord_bot_token": "discord.bot_token",
        "discord_channel_id": "discord.channel_id",
    }

    updated = []
    errors = []

    for field, cfg_key in field_to_key.items():
        if field not in payload:
            continue
        value = payload.get(field)
        if value is None:
            continue
        value = str(value).strip()
        if not value:
            continue
        try:
            proc = subprocess.run(
                ["hermes", "config", "set", cfg_key, value],
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            if proc.returncode == 0:
                updated.append(field)
            else:
                errors.append({
                    "field": field,
                    "message": (proc.stderr or proc.stdout or "update failed").strip(),
                })
        except Exception as e:
            errors.append({"field": field, "message": str(e)})

    return {
        "ok": len(errors) == 0,
        "updated_fields": updated,
        "errors": errors,
    }


@router.get("/hermes/energy")
async def get_hermes_energy():
    """
    读取崽崽能量值（后端持久化）。
    """
    return _read_energy_state()


@router.put("/hermes/energy")
async def update_hermes_energy(payload: dict):
    """
    更新崽崽能量值（后端持久化）。
    """
    energy = payload.get("energy", 80)
    try:
        energy = float(energy)
    except Exception:
        energy = 80.0
    state = _write_energy_state(energy)
    return {"ok": True, **state}


async def ws_endpoint(websocket: WebSocket):
    """WebSocket端点 — 推送崽崽状态变化给前端"""
    await websocket.accept()
    active_connections.append(websocket)

    # 发送初始状态
    from ..services.state_machine import state_machine
    try:
        await websocket.send_json({
            "type": "state_update",
            "state": state_machine.current_state.value,
        })
    except Exception:
        pass

    current_chat_task: asyncio.Task | None = None

    async def run_chat_stream(text: str, images: list, session_id: str | None = None):
        from ..services.chat_service import chat_service
        from ..services.state_machine import state_machine, CaicaiState

        req_id = f"ws-{int(time.time() * 1000)}"
        t0 = time.perf_counter()
        print(f"[Perf][{req_id}] chat.start len={len(text)} images={len(images)} session_id={session_id or '-'}")
        state_machine.transition(CaicaiState.THINKING)
        full_reply = ""
        caicai_events = []
        resolved_session_id = session_id
        first_token_at: float | None = None

        try:
            async for chunk in chat_service.send_message(text, images, session_id=session_id):
                chunk_type = chunk.get("type")

                if chunk_type == "token":
                    token = chunk.get("text", "")
                    if token:
                        if first_token_at is None:
                            first_token_at = time.perf_counter()
                            print(f"[Perf][{req_id}] first_token_ms={(first_token_at - t0) * 1000:.1f}")
                        full_reply += token
                        for conn in active_connections[:]:
                            try:
                                await conn.send_json({"type": "token", "text": token})
                            except Exception:
                                active_connections.remove(conn)

                elif chunk_type == "caicai_event":
                    events = chunk.get("events", [])
                    for ev in events:
                        caicai_events.append(ev)
                        for conn in active_connections[:]:
                            try:
                                await conn.send_json({"type": "caicai_event", "event": ev})
                            except Exception:
                                active_connections.remove(conn)

                elif chunk_type == "thinking":
                    thinking_text = chunk.get("text", "")
                    if thinking_text:
                        for conn in active_connections[:]:
                            try:
                                await conn.send_json({"type": "thinking", "text": thinking_text})
                            except Exception:
                                active_connections.remove(conn)

                elif chunk_type == "done":
                    done_session = chunk.get("session") or {}
                    if isinstance(done_session, dict):
                        resolved_session_id = (
                            done_session.get("session_id")
                            or done_session.get("id")
                            or resolved_session_id
                        )
                    if not full_reply.strip() and chunk.get("reply"):
                        full_reply = str(chunk.get("reply"))
                    t_before_reply = time.perf_counter()
                    for conn in active_connections[:]:
                        try:
                            await conn.send_json({
                                "type": "chat_reply",
                                "reply": full_reply.strip(),
                                "events": caicai_events,
                                "session_id": resolved_session_id,
                            })
                        except Exception:
                            active_connections.remove(conn)
                    t_after_reply = time.perf_counter()
                    print(
                        f"[Perf][{req_id}] done_ms={(t_before_reply - t0) * 1000:.1f} "
                        f"broadcast_ms={(t_after_reply - t_before_reply) * 1000:.1f} "
                        f"total_ms={(t_after_reply - t0) * 1000:.1f} "
                        f"reply_len={len(full_reply.strip())} events={len(caicai_events)} "
                        f"resolved_session_id={resolved_session_id or '-'}"
                    )
                    state_machine.transition(CaicaiState.TALKING)

                elif chunk_type == "error":
                    error_msg = chunk.get("message", "Unknown error")
                    t_err = time.perf_counter()
                    print(f"[Perf][{req_id}] error_ms={(t_err - t0) * 1000:.1f} message={error_msg}")
                    for conn in active_connections[:]:
                        try:
                            await conn.send_json({"type": "error", "message": error_msg})
                        except Exception:
                            active_connections.remove(conn)
                    state_machine.transition(CaicaiState.IDLE)
        except asyncio.CancelledError:
            t_cancel = time.perf_counter()
            print(f"[Perf][{req_id}] cancelled_ms={(t_cancel - t0) * 1000:.1f}")
            for conn in active_connections[:]:
                try:
                    await conn.send_json({"type": "chat_stopped"})
                except Exception:
                    active_connections.remove(conn)
            state_machine.transition(CaicaiState.IDLE)
            raise
        except Exception as e:
            t_ex = time.perf_counter()
            print(f"[Perf][{req_id}] exception_ms={(t_ex - t0) * 1000:.1f} ex={e}")
            for conn in active_connections[:]:
                try:
                    await conn.send_json({"type": "error", "message": f"连接失败: {str(e)}"})
                except Exception:
                    active_connections.remove(conn)
            state_machine.transition(CaicaiState.IDLE)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON payload"})
                continue

            msg_type = msg.get("type")

            # 心跳：前端每 30s 发 ping，后端必须回 pong，避免客户端误判断连
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "chat":
                print(f"[Perf] ws.receive chat len={len(msg.get('message', ''))} images={len(msg.get('images', []))}")
                if current_chat_task and not current_chat_task.done():
                    current_chat_task.cancel()
                    try:
                        await current_chat_task
                    except asyncio.CancelledError:
                        pass
                text = msg.get("message", "")
                images = msg.get("images", [])
                session_id = msg.get("session_id")
                current_chat_task = asyncio.create_task(run_chat_stream(text, images, session_id=session_id))
            elif msg_type == "stop":
                if current_chat_task and not current_chat_task.done():
                    current_chat_task.cancel()
                    try:
                        await current_chat_task
                    except asyncio.CancelledError:
                        pass
                else:
                    await websocket.send_json({"type": "chat_stopped"})
            else:
                await websocket.send_json({"type": "error", "message": f"Unsupported message type: {msg_type}"})

    except WebSocketDisconnect:
        pass
    finally:
        if current_chat_task and not current_chat_task.done():
            current_chat_task.cancel()
        if websocket in active_connections:
            active_connections.remove(websocket)


def register_ws(app: FastAPI):
    @app.websocket("/ws/caicai")
    async def ws_route(websocket: WebSocket):
        await ws_endpoint(websocket)
