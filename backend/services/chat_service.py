"""
Chat 服务（收尾版）
- 聊天链路仅走 Hermes Gateway SSE（不再包含 CLI 聊天兜底/worker/persistent）
- 系统管家类能力（会话列表、会话创建）继续走 Hermes CLI
"""

import json
import asyncio
import os
import re
import time
from typing import AsyncGenerator, Optional

import httpx

from .hermes_cli_api import HermesCliApi

PROJECT_WORKSPACE = "/Users/bobo/ai_projects/HermesBungalow"

# 对外兼容字段（供 gateway.py 状态接口使用）
USE_HERMES_AGENT_MEMORY = True
LAST_CHAT_BACKEND_MODE = "idle"

HERMES_GATEWAY_BASE_URL = os.getenv("HERMES_GATEWAY_BASE_URL", "http://127.0.0.1:7860").strip().rstrip("/")
HERMES_WEBUI_BASE_URL = os.getenv("HERMES_WEBUI_BASE_URL", "http://127.0.0.1:8787").strip().rstrip("/")
HERMES_GUI_CHAT_TIMEOUT = int(os.getenv("HERMES_GUI_CHAT_TIMEOUT", "60"))
HERMES_WEBUI_READY_TIMEOUT = float(os.getenv("HERMES_WEBUI_READY_TIMEOUT", "8"))
HERMES_GUI_PROMPT_FLAG = os.getenv("HERMES_GUI_PROMPT_FLAG", "-q").strip() or "-q"


class ChatService:
    EXPR_MAP = {
        "开心": "happy",
        "思考": "thinking",
        "惊讶": "surprised",
        "紧张": "sweat",
        "疑惑": "confused",
        "微笑": "happy",
    }
    ACTION_MAP = {
        "挥手": "wave_hand",
        "打字": "type_on_keyboard",
        "翻文档": "search_documents",
        "喝咖啡": "drink_coffee",
        "点头": "nod_head",
        "摇头": "shake_head",
        "转圈": "spin",
        "发呆": "idle",
    }

    def __init__(self):
        self._hermes_cli = HermesCliApi(workspace=PROJECT_WORKSPACE)
        self._session_id: Optional[str] = None
        self._latest_session_cache: Optional[str] = None
        self._latest_session_cache_ts: float = 0.0

    async def initialize_persistent_channel(self) -> None:
        # Gateway-only 架构下保留空实现，兼容 main.py 启动调用
        return

    async def close(self) -> None:
        return

    def get_current_session_id(self) -> Optional[str]:
        return self._session_id

    def _strip_hermes_cli_meta(self, text: str) -> str:
        if not text:
            return text
        cleaned_lines: list[str] = []
        for raw in text.splitlines():
            line = raw.strip()
            if line.startswith("↻ Resumed session "):
                continue
            cleaned_lines.append(raw)
        return "\n".join(cleaned_lines).strip()

    def _parse_caicai_events(self, text: str) -> list[dict]:
        events = []
        for m in re.finditer(r"【表情】\s*(\S+)", text):
            events.append({"type": "expression", "value": self.EXPR_MAP.get(m.group(1).strip(), "happy")})
        for m in re.finditer(r"【动作】\s*(\S+)", text):
            events.append({"type": "action", "value": self.ACTION_MAP.get(m.group(1).strip(), "idle")})
        return events

    def _strip_caicai_tags(self, text: str) -> str:
        text = re.sub(r"【表情】\s*\S+", "", text or "")
        text = re.sub(r"【动作】\s*\S+", "", text)
        return text.strip()

    async def _get_latest_hermes_session_id(self) -> Optional[str]:
        now = time.time()
        if self._latest_session_cache and (now - self._latest_session_cache_ts) < 15:
            return self._latest_session_cache
        try:
            res = await self._hermes_cli.run_async(["sessions", "list"], timeout=12)
            if not res.ok:
                return None
            for raw in res.stdout.splitlines():
                line = raw.strip()
                if not line or line.startswith("Preview") or line.startswith("─"):
                    continue
                m = re.search(r"(\d{8}_\d{6}_[0-9a-fA-F]+)\s*$", line)
                if m:
                    sid = m.group(1)
                    self._latest_session_cache = sid
                    self._latest_session_cache_ts = now
                    return sid
        except Exception:
            return None
        return None

    async def create_startup_session(self) -> str:
        """
        通过 Hermes CLI 创建真实会话 ID。
        """
        before_sid = await self._get_latest_hermes_session_id()
        try:
            _ = await self._hermes_cli.run_async(
                ["chat", "-Q", HERMES_GUI_PROMPT_FLAG, "初始化会话", "--max-turns", "1"],
                timeout=max(20, HERMES_GUI_CHAT_TIMEOUT),
            )
        except Exception as e:
            print(f"[ChatService] startup session create timeout/fail, fallback to latest: {e}")
        self._latest_session_cache = None
        self._latest_session_cache_ts = 0.0
        sid = await self._get_latest_hermes_session_id() or before_sid or ""
        self._session_id = sid or None
        return sid or ""

    async def list_sessions(self) -> list:
        try:
            res = await self._hermes_cli.run_async(["sessions", "list"], timeout=12)
            if not res.ok:
                return []
            rows: list[dict] = []
            for raw in res.stdout.splitlines():
                line = raw.rstrip()
                if not line.strip() or line.startswith("Preview") or line.startswith("─"):
                    continue
                m = re.search(
                    r"(?P<preview>.+?)\s{2,}(?P<last_active>.+?)\s{2,}(?P<src>\S+)\s{2,}(?P<id>\d{8}_\d{6}_[0-9a-fA-F]+)\s*$",
                    line,
                )
                if not m:
                    continue
                rows.append(
                    {
                        "session_id": m.group("id"),
                        "preview": m.group("preview").strip(),
                        "last_active": m.group("last_active").strip(),
                        "source": m.group("src").strip(),
                    }
                )
            return rows
        except Exception:
            return []

    async def send_message(
        self,
        message: str,
        images: Optional[list[dict]] = None,
        session_id: Optional[str] = None,
        force_new_session: bool = False,
    ) -> AsyncGenerator[dict, None]:
        global LAST_CHAT_BACKEND_MODE

        preferred_session = session_id or self._session_id
        if force_new_session:
            # 强制新会话：不带旧 session_id
            preferred_session = None
            self._session_id = None

        LAST_CHAT_BACKEND_MODE = "hermes-gateway"
        async for chunk in self._send_via_gateway_sse(message, preferred_session):
            yield chunk

    async def _send_via_gateway_sse(
        self,
        message: str,
        preferred_session_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        # 优先使用迁移后的 Hermes WebUI API 语义；失败后再退回旧 gateway SSE。
        async for chunk in self._send_via_webui_stream(message, preferred_session_id):
            if chunk.get("type") == "error" and chunk.get("_fallback_gateway"):
                break
            yield chunk
            if chunk.get("type") in {"done"}:
                return

        payload = {"message": message, "stream": True}
        if preferred_session_id:
            payload["session_id"] = preferred_session_id

        urls = [
            f"{HERMES_GATEWAY_BASE_URL}/api/v1/chat",
            f"{HERMES_GATEWAY_BASE_URL}/chat",
        ]

        full_reply = ""
        resolved_sid = preferred_session_id
        yielded_any = False

        for url in urls:
            try:
                yield {"type": "thinking", "text": "正在思考..."}
                async with httpx.AsyncClient(timeout=HERMES_GUI_CHAT_TIMEOUT) as client:
                    async with client.stream(
                        "POST",
                        url,
                        json=payload,
                        headers={"accept": "text/event-stream"},
                    ) as resp:
                        if resp.status_code >= 400:
                            continue

                        async for raw_line in resp.aiter_lines():
                            line = (raw_line or "").strip()
                            if not line or line.startswith(":"):
                                continue
                            if line.startswith("data:"):
                                line = line[5:].strip()
                            if not line:
                                continue
                            if line == "[DONE]":
                                break

                            try:
                                evt = json.loads(line)
                            except Exception:
                                evt = {"type": "token", "text": line}

                            tp = str(evt.get("type", "")).lower()
                            if tp in ("thinking", "reasoning"):
                                txt = str(evt.get("text") or evt.get("content") or "").strip()
                                if txt:
                                    yielded_any = True
                                    yield {"type": "thinking", "text": txt}
                            elif tp in ("token", "delta", "chunk"):
                                txt = str(evt.get("text") or evt.get("delta") or evt.get("content") or "")
                                if txt:
                                    yielded_any = True
                                    full_reply += txt
                                    yield {"type": "token", "text": txt}
                            elif tp == "done":
                                sid = evt.get("session_id") or evt.get("session") or resolved_sid
                                if isinstance(sid, str) and sid.strip():
                                    resolved_sid = sid.strip()
                            else:
                                choices = evt.get("choices")
                                if isinstance(choices, list) and choices:
                                    delta = choices[0].get("delta", {})
                                    txt = str(delta.get("content") or "")
                                    if txt:
                                        yielded_any = True
                                        full_reply += txt
                                        yield {"type": "token", "text": txt}
                                    if choices[0].get("finish_reason"):
                                        break

                        if yielded_any:
                            clean = self._strip_caicai_tags(full_reply)
                            events = self._parse_caicai_events(clean)
                            if not events:
                                events = [{"type": "expression", "value": "happy"}, {"type": "action", "value": "wave_hand"}]
                            if events:
                                yield {"type": "caicai_event", "events": events}
                            if resolved_sid:
                                self._session_id = resolved_sid
                            yield {
                                "type": "done",
                                "session": {"session_id": resolved_sid} if resolved_sid else {},
                                "reply": clean,
                                "events": events,
                            }
                            return
            except Exception:
                continue

        yield {"type": "error", "message": "Hermes Gateway 不可用或未返回流式数据"}

    async def _send_via_webui_stream(
        self,
        message: str,
        preferred_session_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        yielded_any = False
        full_reply = ""
        resolved_sid = preferred_session_id
        stream_id: Optional[str] = None
        current_event = "message"
        data_lines: list[str] = []

        def _flush_event() -> Optional[tuple[str, str]]:
            nonlocal current_event, data_lines
            if not data_lines:
                return None
            payload_text = "\n".join(data_lines).strip()
            evt = current_event or "message"
            current_event = "message"
            data_lines = []
            if not payload_text:
                return None
            return evt, payload_text

        try:
            async with httpx.AsyncClient(timeout=HERMES_GUI_CHAT_TIMEOUT) as client:
                await self._wait_webui_ready(client)
                # WebUI first-boot can be slightly slow; retry once before fallback.
                for attempt in range(2):
                    try:
                        if not resolved_sid:
                            new_sess_resp = await client.post(f"{HERMES_WEBUI_BASE_URL}/api/session/new", json={})
                            if new_sess_resp.status_code >= 400:
                                raise RuntimeError(f"webui new session failed: {new_sess_resp.status_code}")
                            new_sess_data = new_sess_resp.json()
                            resolved_sid = (
                                new_sess_data.get("session", {}).get("session_id")
                                or new_sess_data.get("session_id")
                                or ""
                            ) or None
                            if resolved_sid:
                                self._session_id = resolved_sid

                        if not resolved_sid:
                            raise RuntimeError("webui did not return session_id")

                        yield {"type": "thinking", "text": "正在思考..."}

                        start_resp = await client.post(
                            f"{HERMES_WEBUI_BASE_URL}/api/chat/start",
                            json={"session_id": resolved_sid, "message": message},
                        )
                        if start_resp.status_code >= 400:
                            raise RuntimeError(f"webui chat start failed: {start_resp.status_code}")
                        start_data = start_resp.json()
                        stream_id = start_data.get("stream_id")
                        resolved_sid = start_data.get("session_id") or resolved_sid
                        if not stream_id:
                            raise RuntimeError("webui chat start missing stream_id")
                        break
                    except Exception:
                        if attempt >= 1:
                            raise
                        await self._wait_webui_ready(client)

                async with client.stream(
                    "GET",
                    f"{HERMES_WEBUI_BASE_URL}/api/chat/stream",
                    params={"stream_id": stream_id},
                    headers={"accept": "text/event-stream"},
                ) as stream_resp:
                    if stream_resp.status_code >= 400:
                        raise RuntimeError(f"webui stream failed: {stream_resp.status_code}")

                    async for raw_line in stream_resp.aiter_lines():
                        line = raw_line or ""
                        if line.startswith("event:"):
                            current_event = line[6:].strip() or "message"
                            continue
                        if line.startswith("data:"):
                            data_lines.append(line[5:].strip())
                            continue
                        if line.strip() != "":
                            continue

                        parsed = _flush_event()
                        if not parsed:
                            continue
                        evt_name, payload_text = parsed
                        try:
                            evt_data = json.loads(payload_text)
                        except Exception:
                            evt_data = {"text": payload_text}

                        if evt_name == "token":
                            txt = str(evt_data.get("text") or "")
                            if txt:
                                yielded_any = True
                                full_reply += txt
                                yield {"type": "token", "text": txt}
                        elif evt_name in {"reasoning", "thinking"}:
                            txt = str(evt_data.get("text") or "").strip()
                            if txt:
                                yielded_any = True
                                yield {"type": "thinking", "text": txt}
                        elif evt_name == "done":
                            sess = evt_data.get("session") or {}
                            sid = sess.get("session_id") or resolved_sid
                            if isinstance(sid, str) and sid.strip():
                                resolved_sid = sid.strip()
                            clean = self._strip_caicai_tags(full_reply)
                            events = self._parse_caicai_events(clean)
                            if not events:
                                events = [
                                    {"type": "expression", "value": "happy"},
                                    {"type": "action", "value": "wave_hand"},
                                ]
                            if events:
                                yield {"type": "caicai_event", "events": events}
                            if resolved_sid:
                                self._session_id = resolved_sid
                            yield {
                                "type": "done",
                                "session": {"session_id": resolved_sid} if resolved_sid else {},
                                "reply": clean,
                                "events": events,
                            }
                            return
                        elif evt_name in {"error", "apperror", "cancel"}:
                            msg = str(evt_data.get("message") or evt_data.get("error") or "聊天已中断")
                            yield {"type": "error", "message": msg}
                            return
                        elif evt_name == "stream_end":
                            if yielded_any:
                                clean = self._strip_caicai_tags(full_reply)
                                events = self._parse_caicai_events(clean)
                                if not events:
                                    events = [
                                        {"type": "expression", "value": "happy"},
                                        {"type": "action", "value": "wave_hand"},
                                    ]
                                if events:
                                    yield {"type": "caicai_event", "events": events}
                                if resolved_sid:
                                    self._session_id = resolved_sid
                                yield {
                                    "type": "done",
                                    "session": {"session_id": resolved_sid} if resolved_sid else {},
                                    "reply": clean,
                                    "events": events,
                                }
                                return

                    parsed = _flush_event()
                    if parsed:
                        evt_name, payload_text = parsed
                        if evt_name == "token":
                            try:
                                evt_data = json.loads(payload_text)
                                txt = str(evt_data.get("text") or "")
                                if txt:
                                    yielded_any = True
                                    full_reply += txt
                                    yield {"type": "token", "text": txt}
                            except Exception:
                                pass
        except Exception:
            # 交给旧 gateway 方案继续尝试
            yield {"type": "error", "message": "webui_stream_unavailable", "_fallback_gateway": True}

    async def _wait_webui_ready(self, client: httpx.AsyncClient) -> None:
        deadline = time.time() + max(0.5, HERMES_WEBUI_READY_TIMEOUT)
        while time.time() < deadline:
            try:
                resp = await client.get(f"{HERMES_WEBUI_BASE_URL}/health")
                if resp.status_code < 400:
                    return
            except Exception:
                pass
            await asyncio.sleep(0.25)


chat_service = ChatService()

