from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Optional

import httpx

from .. import webui_bootstrap as webui_bootstrap


class HermesWebUIService:
    """Prepare migrated Hermes WebUI and optionally run it."""

    def __init__(self) -> None:
        self.enabled = os.getenv("HERMES_WEBUI_ENABLED", "1").lower() not in {"0", "false", "no"}
        self.autostart = os.getenv("HERMES_WEBUI_AUTOSTART", "1").lower() in {"1", "true", "yes"}
        self.host = os.getenv("HERMES_WEBUI_HOST", "127.0.0.1")
        self.port = int(os.getenv("HERMES_WEBUI_PORT", "8787"))
        self.startup_wait_seconds = float(os.getenv("HERMES_WEBUI_STARTUP_WAIT_SECONDS", "10"))
        self._proc: Optional[asyncio.subprocess.Process] = None

    async def start(self) -> None:
        if not self.enabled:
            print("[HermesWebUI] skipped (disabled by HERMES_WEBUI_ENABLED)")
            return

        try:
            webui_bootstrap.ensure_supported_platform()
            agent_dir = webui_bootstrap.discover_agent_dir()
            python_exe = webui_bootstrap.ensure_python_has_webui_deps(
                webui_bootstrap.discover_launcher_python(agent_dir)
            )
            from ..webui_api.config import DEFAULT_WORKSPACE, SESSION_DIR, STATE_DIR

            STATE_DIR.mkdir(parents=True, exist_ok=True)
            SESSION_DIR.mkdir(parents=True, exist_ok=True)
            DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            print(f"[HermesWebUI] prepare skipped: {exc}")
            return

        if not self.autostart:
            print("[HermesWebUI] prepared migrated service modules")
            return

        if self._proc and self._proc.returncode is None:
            return

        env = os.environ.copy()
        env.setdefault("HERMES_WEBUI_HOST", self.host)
        env.setdefault("HERMES_WEBUI_PORT", str(self.port))

        backend_root = str(Path(__file__).resolve().parents[2])
        self._proc = await asyncio.create_subprocess_exec(
            python_exe,
            "-m",
            "backend.webui_server",
            cwd=backend_root,
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        print(f"[HermesWebUI] autostarted pid={self._proc.pid} on {self.host}:{self.port}")
        await self._wait_until_ready()

    async def _wait_until_ready(self) -> None:
        deadline = asyncio.get_event_loop().time() + max(0.5, self.startup_wait_seconds)
        url = f"http://{self.host}:{self.port}/health"
        async with httpx.AsyncClient(timeout=2.0) as client:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    resp = await client.get(url)
                    if resp.status_code < 400:
                        print(f"[HermesWebUI] ready on {self.host}:{self.port}")
                        return
                except Exception:
                    pass
                await asyncio.sleep(0.25)
        print(f"[HermesWebUI] not ready within {self.startup_wait_seconds}s, continue with fallback")

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._proc.kill()
                await self._proc.wait()
            print("[HermesWebUI] stopped")
        self._proc = None


hermes_webui_service = HermesWebUIService()
