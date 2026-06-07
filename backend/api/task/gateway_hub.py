from __future__ import annotations

import asyncio
import json
import os
import queue
import threading
from typing import Any

from starlette.websockets import WebSocket


class GatewayHub:
    """Broadcast JSON frames to WebSocket clients; subscriptions per channel."""

    def __init__(self) -> None:
        self._clients: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._sync_q: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue()
        self._pump_task: asyncio.Task | None = None

    def enqueue_event(self, channel: str, data: dict[str, Any]) -> None:
        self._sync_q.put((channel, data))

    async def start_pump(self) -> None:
        if self._pump_task and not self._pump_task.done():
            return
        loop = asyncio.get_event_loop()
        self._pump_task = asyncio.create_task(self._pump(loop))

    async def _pump(self, loop: asyncio.AbstractEventLoop) -> None:
        while True:
            channel, data = await loop.run_in_executor(None, self._sync_q.get)
            await self.publish(channel, data)

    async def publish(self, channel: str, data: dict[str, Any]) -> None:
        msg = json.dumps({"type": "game_event", "channel": channel, "data": data}, ensure_ascii=False)
        dead: list[dict[str, Any]] = []
        with self._lock:
            clients = list(self._clients)
        for c in clients:
            ws: WebSocket = c["ws"]
            subs: set[str] = c["channels"]
            if channel not in subs and "*" not in subs:
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(c)
        with self._lock:
            for c in dead:
                if c in self._clients:
                    self._clients.remove(c)

    def register(self, ws: WebSocket, channels: set[str]) -> None:
        with self._lock:
            self._clients.append({"ws": ws, "channels": channels})

    def unregister(self, ws: WebSocket) -> None:
        with self._lock:
            self._clients[:] = [c for c in self._clients if c["ws"] is not ws]

    async def shutdown(self) -> None:
        if self._pump_task and not self._pump_task.done():
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None


def gateway_enabled() -> bool:
    return os.getenv("GATEWAY_ENABLED", "1").strip().lower() not in {"0", "false", "no"}
