"""
Multi-Agent Gateway — Session-to-Agent routing and process manager.

Architecture:
  Gateway (WS :3000) → routes messages → Agent Process (:8001, :8002, ...)

Each Agent process runs a minimal Starlette server that exposes only the
streaming chat endpoint, isolated under its own HERMES_HOME (profile).

Session affinity:
  - New WS connection: client sends {type:'init', profile:'default'}
  - Gateway assigns a session_id and records session→agent mapping
  - Subsequent messages carry {type:'chat', session_id:'...', message:'...'}
  - Gateway forwards to the agent that owns that session_id

Profile auto-discovery:
  At import time, scans ~/.hermes and ~/.hermes/profiles/* to build the
  PROFILE_CONFIG dict dynamically — no hardcoded agent list needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from starlette.websockets import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

# ── Profile auto-discovery ──────────────────────────────────────────────────────

HERMES_BASE = Path.home() / ".hermes"
HERMES_PROFILES_DIR = HERMES_BASE / "profiles"
AGENT_BASE_PORT = 8100


def _read_profile_description(hermes_home: Path) -> str:
    """Read the agent's display name from the first # heading in SOUL.md."""
    soul = hermes_home / "SOUL.md"
    if soul.exists():
        text = soul.read_text(encoding="utf-8")
        m = re.search(r"^\s*#\s+(.+)$", text, re.MULTILINE)
        if m:
            return m.group(1).strip().strip("*").strip()
    return ""


def _discover_profiles() -> dict[str, dict[str, Any]]:
    """Scan ~/.hermes and ~/.hermes/profiles/* to build PROFILE_CONFIG dynamically."""
    discovered: dict[str, dict[str, Any]] = {}
    port = AGENT_BASE_PORT

    # 1. The primary ~/.hermes is always "default"
    if HERMES_BASE.is_dir():
        desc = _read_profile_description(HERMES_BASE)
        discovered["default"] = {
            "port": port,
            "hermes_home": str(HERMES_BASE),
            "description": desc or "崽崽",
        }
        port += 1
        logger.info(
            "[ProfileScan] Found profile 'default' at %s  description='%s'",
            HERMES_BASE, desc or "崽崽",
        )
    else:
        logger.warning("[ProfileScan] ~/.hermes does not exist — 'default' profile skipped")

    # 2. Scan ~/.hermes/profiles/* subdirectories
    if HERMES_PROFILES_DIR.is_dir():
        subdirs = sorted(d for d in HERMES_PROFILES_DIR.iterdir() if d.is_dir())
        for subdir in subdirs:
            profile_name = subdir.name
            desc = _read_profile_description(subdir)
            discovered[profile_name] = {
                "port": port,
                "hermes_home": str(subdir),
                "description": desc or profile_name,
            }
            logger.info(
                "[ProfileScan] Found profile '%s' at %s  description='%s'",
                profile_name, subdir, desc or profile_name,
            )
            port += 1
    else:
        logger.info("[ProfileScan] No ~/.hermes/profiles/ directory — no additional profiles")

    logger.info(
        "[ProfileScan] Discovery complete — %d profile(s): %s",
        len(discovered), list(discovered.keys()),
    )
    return discovered


# PROFILE_CONFIG is built once at import time
PROFILE_CONFIG: dict[str, dict[str, Any]] = _discover_profiles()


# ── Session state ──────────────────────────────────────────────────────────────

@dataclass
class AgentSession:
    session_id: str
    profile: str
    agent_port: int
    connected_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)


class SessionRegistry:
    """Thread-safe session → agent mapping."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, AgentSession] = {}
        self._profile_counters: dict[str, int] = {}

    def create(self, profile: str) -> AgentSession:
        if profile not in PROFILE_CONFIG:
            raise ValueError(f"Unknown profile: '{profile}' — available: {list(PROFILE_CONFIG.keys())}")
        port = PROFILE_CONFIG[profile]["port"]
        with self._lock:
            session_id = uuid.uuid4().hex
            s = AgentSession(session_id=session_id, profile=profile, agent_port=port)
            self._sessions[session_id] = s
            self._profile_counters[profile] = self._profile_counters.get(profile, 0) + 1
            logger.info("[SessionRegistry] Created session %s → profile='%s' port=%d", session_id, profile, port)
            return s

    def get(self, session_id: str) -> AgentSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def touch(self, session_id: str) -> None:
        with self._lock:
            s = self._sessions.get(session_id)
            if s:
                s.last_activity = time.time()

    def remove(self, session_id: str) -> None:
        with self._lock:
            s = self._sessions.pop(session_id, None)
            if s:
                self._profile_counters[s.profile] = max(0, self._profile_counters.get(s.profile, 1) - 1)
                logger.info("[SessionRegistry] Removed session %s (profile='%s')", session_id, s.profile)

    def list_by_profile(self, profile: str) -> list[AgentSession]:
        with self._lock:
            return [s for s in self._sessions.values() if s.profile == profile]

    @property
    def active_profiles(self) -> list[str]:
        with self._lock:
            return [p for p, c in self._profile_counters.items() if c > 0]


REGISTRY = SessionRegistry()


# ── Agent process management ──────────────────────────────────────────────────

class AgentProcess:
    """Manages a single Agent subprocess running on a dedicated port."""

    def __init__(self, profile: str) -> None:
        if profile not in PROFILE_CONFIG:
            raise ValueError(f"Unknown profile: '{profile}' — available: {list(PROFILE_CONFIG.keys())}")
        self.profile = profile
        cfg = PROFILE_CONFIG[profile]
        self.port: int = cfg["port"]
        self.hermes_home: str = cfg["hermes_home"]
        self.description: str = cfg["description"]
        self._proc: subprocess.Popen[bytes] | None = None
        self._started = False
        self._start_lock = threading.Lock()
        logger.info(
            "[AgentProcess] Created for profile='%s'  port=%d  home='%s'  description='%s'",
            profile, self.port, self.hermes_home, self.description,
        )

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def is_alive(self) -> bool:
        if self._proc is None:
            return False
        return self._proc.poll() is None

    def _is_port_in_use(self, port: int) -> bool:
        """Check if a port is already listening on 127.0.0.1."""
        try:
            with socket.create_server(("127.0.0.1", port), reuse_port=True) as s:
                return False
        except OSError:
            return True

    def start(self) -> None:
        """Start the agent subprocess. Idempotent — safe to call multiple times."""
        with self._start_lock:
            # ── Step 1: Already running? ─────────────────────────────────
            if self._started and self.is_alive():
                logger.info(
                    "[AgentStart] Profile '%s' already running — port=%d pid=%s  (skipping)",
                    self.profile, self.port,
                    self._proc.pid if self._proc else "?",
                )
                return

            # ── Step 2: Port conflict check ─────────────────────────────
            if self._is_port_in_use(self.port):
                logger.warning(
                    "[AgentStart] Port %d already in use — profile='%s' "
                    "another process is listening; will attempt start anyway",
                    self.port, self.profile,
                )

            logger.info(
                "[AgentStart] ══ Starting ══  profile='%s'  port=%d  home='%s'",
                self.profile, self.port, self.hermes_home,
            )

            # ── Step 3: Build environment ────────────────────────────────
            env = dict(os.environ)
            # 确保局域网 Ollama 地址绕过 HTTP 代理，并移除 httpx 不支持的 socks 代理
            for key in ("no_proxy", "NO_PROXY"):
                existing = env.get(key, "")
                if "192.168.1.3" not in existing:
                    env[key] = f"{existing},192.168.1.3" if existing else "192.168.1.3"
            for key in ("all_proxy", "ALL_PROXY"):
                env.pop(key, None)
            env["HERMES_HOME"] = self.hermes_home
            env["HERMES_PROFILE"] = self.profile
            env["HERMES_WEBUI_AGENT_DIR"] = str(Path.home() / ".hermes" / "hermes-agent")
            env["GATEWAY_MODE"] = "agent"
            env["SINGLE_PROFILE"] = self.profile

            python = str(Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin" / "python3")
            if not Path(python).is_file():
                logger.error(
                    "[AgentStart] Python not found: %s  — cannot start profile '%s'",
                    python, self.profile,
                )
                return

            script_path = Path(__file__).parent.parent / "agent_server.py"
            args = [
                python,
                str(script_path),
                "--profile", self.profile,
                "--port", str(self.port),
                "--hermes-home", self.hermes_home,
            ]

            logger.info(
                "[AgentStart] cmd: %s agent_server.py --profile %s --port %s --hermes-home %s",
                python, self.profile, self.port, self.hermes_home,
            )

            # ── Step 4: Spawn ───────────────────────────────────────────
            try:
                self._proc = subprocess.Popen(
                    args,
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except Exception as e:
                logger.error(
                    "[AgentStart] Failed to spawn subprocess for profile '%s': %s",
                    self.profile, e,
                )
                return

            self._started = True
            pid = self._proc.pid
            logger.info(
                "[AgentStart] ✓ Spawned — profile='%s' pid=%d port=%d",
                self.profile, pid, self.port,
            )

    def stop(self) -> None:
        """Stop the agent subprocess. Idempotent — safe to call multiple times."""
        with self._start_lock:
            if not self.is_alive():
                logger.debug(
                    "[AgentStop] Profile '%s' — not running (proc=%s)  nothing to do",
                    self.profile, self._proc,
                )
                self._started = False
                return

            pid = self._proc.pid if self._proc else 0
            logger.info(
                "[AgentStop] Terminating — profile='%s' pid=%d port=%d",
                self.profile, pid, self.port,
            )
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
                logger.info(
                    "[AgentStop] ✓ Terminated gracefully — profile='%s' pid=%d",
                    self.profile, pid,
                )
            except subprocess.TimeoutExpired:
                self._proc.kill()
                logger.warning(
                    "[AgentStop] ⚠ Force-killed — profile='%s' pid=%d",
                    self.profile, pid,
                )
            self._started = False


class AgentManager:
    """Manages all agent processes. Call ensure_running(profile) before use."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._agents: dict[str, AgentProcess] = {}

    def register_profile(self, profile: str, hermes_home: str, description: str = "") -> int:
        """Register a newly created profile so its subprocess can be started without restart."""
        from pathlib import Path
        if profile in PROFILE_CONFIG:
            return PROFILE_CONFIG[profile]["port"]
        # Find the next available port
        used_ports = {cfg["port"] for cfg in PROFILE_CONFIG.values()}
        port = AGENT_BASE_PORT
        while port in used_ports:
            port += 1
        desc = description or _read_profile_description(Path(hermes_home))
        PROFILE_CONFIG[profile] = {
            "port": port,
            "hermes_home": hermes_home,
            "description": desc or profile,
        }
        logger.info("[AgentMgr] Registered new profile '%s' on port %d", profile, port)
        return port

    def get(self, profile: str) -> AgentProcess:
        if profile not in PROFILE_CONFIG:
            raise ValueError(f"Unknown profile: '{profile}' — available: {list(PROFILE_CONFIG.keys())}")
        with self._lock:
            if profile not in self._agents:
                logger.info("[AgentMgr] First access — creating AgentProcess for profile='%s'", profile)
                self._agents[profile] = AgentProcess(profile)
            return self._agents[profile]

    def ensure_running(self, profile: str) -> AgentProcess:
        """Start the agent if not already running, then wait for its /health endpoint."""
        logger.info("[AgentMgr] ensure_running profile='%s'", profile)
        agent = self.get(profile)
        agent.start()
        self._wait_for_agent(agent)
        return agent

    def _wait_for_agent(self, agent: AgentProcess, timeout: float = 10.0) -> None:
        """Poll until the agent HTTP server responds 200 on /health."""
        deadline = time.time() + timeout
        logger.info(
            "[AgentMgr] Waiting for agent '%s' to be ready (timeout=%.1fs) ...",
            agent.profile, timeout,
        )
        while time.time() < deadline:
            if not agent.is_alive():
                logger.error(
                    "[AgentMgr] Agent '%s' died immediately after spawn — cannot recover",
                    agent.profile,
                )
                raise RuntimeError(f"Agent process for profile '{agent.profile}' died immediately")
            try:
                # 本地 health check 必须绕过环境代理（尤其 socks:// 不被 httpx 支持）
                with httpx.Client(trust_env=False) as client:
                    resp = client.get(f"{agent.base_url}/health", timeout=1.0)
                if resp.status_code == 200:
                    pid = agent._proc.pid if agent._proc else None
                    logger.info(
                        "[AgentMgr] ✓ Agent '%s' ready — port=%d  pid=%s  %s/health",
                        agent.profile,
                        agent.port,
                        pid,
                        agent.base_url,
                    )
                    return
            except (httpx.ConnectError, httpx.ProxyError, Exception):
                pass
            time.sleep(0.3)
        raise TimeoutError(
            f"Agent '{agent.profile}' on port {agent.port} did not respond within {timeout}s"
        )

    def stop_all(self) -> None:
        """Stop all tracked agent processes."""
        logger.info("[AgentMgr] stop_all — shutting down %d agent(s)", len(self._agents))
        with self._lock:
            for profile in list(self._agents.keys()):
                logger.info("[AgentMgr] Stopping profile='%s'", profile)
                self._agents[profile].stop()
        logger.info("[AgentMgr] stop_all complete")

    def startup_status_rows(self) -> list[tuple[str, int, int | None, str]]:
        """(profile, port, pid or None, status) for post-startup logging."""
        with self._lock:
            out: list[tuple[str, int, int | None, str]] = []
            for profile in sorted(self._agents):
                ap = self._agents[profile]
                pid = ap._proc.pid if ap._proc else None
                if ap.is_alive():
                    status = "running"
                elif ap._started:
                    status = "exited"
                else:
                    status = "not_started"
                out.append((profile, ap.port, pid, status))
            return out


MANAGER = AgentManager()


# ── Gateway WebSocket handler ──────────────────────────────────────────────────

class MultiAgentGateway:
    """
    WebSocket gateway that routes client messages to the correct Agent process.

    Protocol:
      Client → Gateway:
        {type:'init', profile:'default'}          # new session
        {type:'chat', session_id:'xxx', message:'...', attachments?: []}

      Gateway → Client:
        {type:'session_ready', session_id:'xxx', profile:'default', description:'崽崽'}
        {type:'chat_stream', content:'token', done:false}
        {type:'chat_done', content:'full response', game_events:{...}}
        {type:'error', message:'...'}
    """

    def __init__(self) -> None:
        self._clients: dict[WebSocket, str] = {}  # ws → session_id
        self._lock = threading.Lock()
        self._proxy_tasks: dict[WebSocket, asyncio.Task] = {}
        self._msg_timestamps: dict[WebSocket, list[float]] = {}  # ws → recent msg timestamps

    async def handle(self, ws: WebSocket) -> None:
        """Entry point from server.py."""
        await ws.accept()
        session_id: str | None = None

        try:
            # Wait for init message
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid JSON"}))
                return

            if data.get("type") != "init":
                await ws.send_text(json.dumps({"type": "error", "message": "expected init message first"}))
                return

            # Token 校验（身份伪造防护）
            provided_token = data.get("token", "")
            expected_token = os.environ.get("HERMES_GATEWAY_TOKEN", "")
            if expected_token and provided_token != expected_token:
                await ws.send_text(json.dumps({"type": "error", "message": "unauthorized"}))
                return

            profile = str(data.get("profile", "default")).strip()
            if profile not in PROFILE_CONFIG:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "message": f"unknown profile: '{profile}' — available: {list(PROFILE_CONFIG.keys())}",
                }))
                return

            # Create session and ensure agent is running
            try:
                agent = MANAGER.ensure_running(profile)
            except (RuntimeError, TimeoutError) as e:
                logger.error("[Gateway] Failed to start agent for profile '%s': %s", profile, e)
                await ws.send_text(json.dumps({"type": "error", "message": f"agent unavailable: {e}"}))
                return

            session = REGISTRY.create(profile)
            session_id = session.session_id

            with self._lock:
                self._clients[ws] = session_id

            cfg = PROFILE_CONFIG[profile]
            await ws.send_text(json.dumps({
                "type": "session_ready",
                "session_id": session_id,
                "profile": profile,
                "description": cfg["description"],
                "agent_url": agent.base_url,
            }, ensure_ascii=False))

            logger.info(
                "[Gateway] Session %s → profile='%s' (%s) via agent on :%d",
                session_id, profile, cfg["description"], agent.port,
            )

            # Start proxy task to forward messages to agent
            task = asyncio.create_task(self._proxy_messages(ws, session))
            with self._lock:
                self._proxy_tasks[ws] = task

            await task

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error("[Gateway] Unexpected error: %s", e)
            try:
                await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
            except Exception:
                pass
        finally:
            with self._lock:
                self._clients.pop(ws, None)
                self._proxy_tasks.pop(ws, None)
            if session_id:
                REGISTRY.remove(session_id)
                logger.info("[Gateway] Session %s closed", session_id)

    async def _proxy_messages(self, ws: WebSocket, session: AgentSession) -> None:
        """Forward messages from ws client to the appropriate Agent process."""
        agent = MANAGER.get(session.profile)

        async with httpx.AsyncClient(timeout=60.0) as client:
            stream_id = uuid.uuid4().hex
            chat_start_url = f"{agent.base_url}/api/chat/start"
            headers = {
                "Content-Type": "application/json",
                "X-Session-ID": session.session_id,
                "X-Profile": session.profile,
            }

            while True:
                try:
                    msg = await asyncio.wait_for(ws.receive_text(), timeout=300)
                except asyncio.TimeoutError:
                    continue

                try:
                    data = json.loads(msg)
                except json.JSONDecodeError:
                    await ws.send_text(json.dumps({"type": "error", "message": "invalid JSON"}))
                    continue

                mtype = data.get("type", "")

                if mtype == "chat":
                    pending_message = str(data.get("message", "")).strip()
                    if not pending_message:
                        continue
                    # 长度限制
                    if len(pending_message) > 500:
                        await ws.send_text(json.dumps({"type": "error", "message": "message too long (max 500 chars)"}))
                        continue
                    # HTML/标签过滤
                    pending_message = re.sub(r"<[^>]+>", "", pending_message)
                    # 频率限制：≤10条/秒
                    now = time.time()
                    with self._lock:
                        ts_list = self._msg_timestamps.setdefault(ws, [])
                        ts_list[:] = [t for t in ts_list if now - t < 1.0]
                        if len(ts_list) >= 10:
                            await ws.send_text(json.dumps({"type": "error", "message": "rate limit exceeded (max 10 msg/sec)"}))
                            continue
                        ts_list.append(now)

                    try:
                        response = await client.post(
                            chat_start_url,
                            headers=headers,
                            json={
                                "session_id": session.session_id,
                                "message": pending_message,
                                "model": None,
                                "workspace": str(Path.home() / "ai_projects" / "HermesBungalow" / "agent_workspace"),
                            },
                        )

                        if response.status_code != 200:
                            await ws.send_text(json.dumps({
                                "type": "error",
                                "message": f"agent returned {response.status_code}",
                            }))
                            continue

                        result = response.json()
                        stream_id = result.get("stream_id", stream_id)

                        stream_url = f"{agent.base_url}/api/chat/stream?stream_id={stream_id}"

                        async with client.stream("GET", stream_url, headers=headers, timeout=60.0) as stream:
                            async for line in stream.aiter_lines():
                                if not line.startswith("data:"):
                                    continue
                                raw = line[5:].strip()
                                if not raw or raw == "[DONE]":
                                    continue
                                try:
                                    event_data = json.loads(raw)
                                except json.JSONDecodeError:
                                    continue

                                ev_type = event_data.get("event", "")
                                ev_data = event_data.get("data", {})

                                if ev_type == "delta":
                                    await ws.send_text(json.dumps({
                                        "type": "chat_stream",
                                        "content": ev_data.get("content", ""),
                                        "done": False,
                                    }, ensure_ascii=False))
                                elif ev_type == "done":
                                    session_data = ev_data.get("session", {})
                                    messages = session_data.get("messages", [])
                                    content = ""
                                    for m in reversed(messages):
                                        if isinstance(m, dict) and m.get("role") == "assistant":
                                            c = m.get("content", "")
                                            if isinstance(c, str) and c:
                                                content = c
                                                break
                                            if isinstance(c, list):
                                                for part in c:
                                                    if isinstance(part, dict) and part.get("type") in ("text", "output_text"):
                                                        content = str(part.get("text", ""))
                                                        break
                                                if content:
                                                    break
                                    await ws.send_text(json.dumps({
                                        "type": "chat_done",
                                        "content": content,
                                        "game_events": {},
                                        "session": session_data,
                                    }, ensure_ascii=False))
                                elif ev_type == "error":
                                    await ws.send_text(json.dumps({
                                        "type": "error",
                                        "message": ev_data.get("message", "unknown error"),
                                    }, ensure_ascii=False))
                                elif ev_type == "stream_end":
                                    break

                    except httpx.ConnectError:
                        await ws.send_text(json.dumps({
                            "type": "error",
                            "message": f"agent on port {agent.port} is not responding",
                        }))
                    except Exception as e:
                        logger.error("[Gateway] Proxy error: %s", e)
                        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))

                elif mtype == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}, ensure_ascii=False))

                elif mtype == "history":
                    try:
                        resp = await client.get(
                            f"{agent.base_url}/api/sessions/{session.session_id}",
                            headers=headers,
                            timeout=10.0,
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            await ws.send_text(json.dumps({
                                "type": "history",
                                "messages": data.get("messages", []),
                            }, ensure_ascii=False))
                    except Exception as e:
                        await ws.send_text(json.dumps({
                            "type": "error",
                            "message": f"failed to fetch history: {e}",
                        }))

                REGISTRY.touch(session.session_id)


# ── Convenience exports ────────────────────────────────────────────────────────

gateway = MultiAgentGateway()


def start_all_agents() -> None:
    """
    Synchronously start all discovered agent processes and wait for each to be ready.
    Call from server startup (lifespan startup).
    """
    logger.info(
        "[Gateway] ═══ Hermes agent 子进程启动 ═══  gateway_main_pid=%s  profile 数=%d  %s",
        os.getpid(),
        len(PROFILE_CONFIG),
        list(PROFILE_CONFIG.keys()),
    )
    for profile in PROFILE_CONFIG:
        try:
            agent = MANAGER.ensure_running(profile)
            pid = agent._proc.pid if agent._proc else None
            logger.info(
                "[Gateway] ✓ agent 就绪  profile=%r  port=%d  pid=%s  base_url=%s",
                profile,
                agent.port,
                pid,
                agent.base_url,
            )
        except Exception as e:
            logger.error(
                "[Gateway] ✗ agent 启动失败  profile=%r  err=%s",
                profile,
                e,
            )
    rows = MANAGER.startup_status_rows()
    if rows:
        body = "\n".join(
            f"  {p:<22}  port={port:5d}  pid={pid!s:>6}  {st}"
            for p, port, pid, st in rows
        )
        logger.info(
            "[Gateway] ═══ 当前 agent 子进程一览（%d）═══\n%s",
            len(rows),
            body,
        )
    else:
        logger.info("[Gateway] ═══ 当前 agent 子进程一览 ═══  （无已登记子进程；可能未扫描到 ~/.hermes）")


def stop_all_agents() -> None:
    """
    Stop all agent processes.
    Call from server shutdown (lifespan shutdown).
    """
    logger.info("[Gateway] stop_all_agents called")
    MANAGER.stop_all()
