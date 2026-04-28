"""
Chat服务 — 复用 hermes-webui 的 session/streaming 能力
作为代理层：接收 HermesBungalow 前端请求 → 转发给 hermes-webui → 解析 SSE + 注入 Caicai 事件
"""
import asyncio
import json
import httpx
import re
from typing import AsyncGenerator, Optional

HERMES_WEBUI_URL = "http://127.0.0.1:8787"
SESSION_COOKIES = "__caicai_session"


class ChatService:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._session_id: Optional[str] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0, follow_redirects=True)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Session 管理 ────────────────────────────────────────────

    async def ensure_session(self) -> str:
        """确保有一个活跃 session，返回 session_id"""
        if self._session_id:
            return self._session_id

        client = await self._get_client()
        # 尝试获取已有 sessions
        try:
            resp = await client.get(f"{HERMES_WEBUI_URL}/api/sessions")
            if resp.status_code == 200:
                sessions = resp.json()
                if sessions:
                    self._session_id = sessions[0].get("session_id")
                    if self._session_id:
                        return self._session_id
        except Exception:
            pass

        # 创建新 session
        try:
            resp = await client.post(
                f"{HERMES_WEBUI_URL}/api/session/new",
                json={"workspace": "/Users/bobo/ai_projects/HermesBungalow", "model": ""},
            )
            if resp.status_code == 200:
                data = resp.json()
                self._session_id = data.get("session_id")
                if self._session_id:
                    return self._session_id
        except Exception:
            pass

        # 最后兜底：用时间戳做 session_id（降级模式）
        import time
        self._session_id = f"caicai_{int(time.time())}"
        return self._session_id

    async def list_sessions(self) -> list:
        """列出所有 sessions"""
        client = await self._get_client()
        try:
            resp = await client.get(f"{HERMES_WEBUI_URL}/api/sessions")
            if resp.status_code == 200:
                data = resp.json()
                # hermes-webui 返回 {"sessions": {...}} — 提取 sessions 数组
                if isinstance(data, dict) and "sessions" in data:
                    return data["sessions"]
                return data if isinstance(data, list) else []
        except Exception:
            pass
        return []

    # ── Caicai 事件解析 ────────────────────────────────────────

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

    def _parse_caicai_events(self, text: str) -> list[dict]:
        """从文本中解析 Caicai 表情/动作标签"""
        events = []
        for m in re.finditer(r"【表情】\s*(\S+)", text):
            val = self.EXPR_MAP.get(m.group(1).strip(), "happy")
            events.append({"type": "expression", "value": val})
        for m in re.finditer(r"【动作】\s*(\S+)", text):
            val = self.ACTION_MAP.get(m.group(1).strip(), "idle")
            events.append({"type": "action", "value": val})
        return events

    def _strip_caicai_tags(self, text: str) -> str:
        """去掉【表情】【动作】标签"""
        text = re.sub(r"【表情】\s*\S+", "", text)
        text = re.sub(r"【动作】\s*\S+", "", text)
        return text.strip()

    # ── 流式发送 ───────────────────────────────────────────────

    async def send_message(
        self,
        message: str,
        images: Optional[list[dict]] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        发送消息给 hermes-webui，流式返回 chunks。
        每個 chunk: {"type": "token", "text": "..."} 或 {"type": "done", "session": {...}}
        同时检测 Caicai 事件并注入: {"type": "caicai_event", "events": [...]}
        """
        session_id = await self.ensure_session()
        client = await self._get_client()

        # 1. 先上传图片（如果有）
        attachment_names = []
        if images:
            for img in images:
                try:
                    files = {"file": (img.get("filename", "image.png"), img["data_url"].encode(), img.get("mime", "image/png"))}
                    resp = await client.post(
                        f"{HERMES_WEBUI_URL}/api/upload",
                        files=files,
                        data={"session_id": session_id},
                    )
                    if resp.status_code == 200:
                        attachment_names.append(resp.json().get("filename", ""))
                except Exception:
                    pass

        # 2. 启动 chat stream
        upload_json = {}
        if attachment_names:
            upload_json["attachments"] = [{"filename": n} for n in attachment_names]

        try:
            # Start stream
            start_resp = await client.post(
                f"{HERMES_WEBUI_URL}/api/chat/start",
                json={
                    "message": message,
                    "session_id": session_id,
                    "model": "",
                    "workspace": "/Users/bobo/ai_projects/HermesBungalow",
                    **upload_json,
                },
            )
            if start_resp.status_code != 200:
                async for chunk in self._fallback_via_gateway_bridge(message):
                    yield chunk
                return

            start_data = start_resp.json()
            stream_id = start_data.get("stream_id")
            if not stream_id:
                async for chunk in self._fallback_via_gateway_bridge(message):
                    yield chunk
                return

            # 3. 建立 SSE 连接读取流
            accumulated = ""
            pending_expr = ""
            pending_action = ""

            async with client.stream(
                "GET",
                f"{HERMES_WEBUI_URL}/api/chat/stream?stream_id={stream_id}",
                headers={"Accept": "text/event-stream"},
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if not data_str or data_str == ":":
                        continue

                    try:
                        obj = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    event_type = obj.get("type")

                    if event_type == "token":
                        text = obj.get("text", "")
                        if text:
                            accumulated += text

                            # 持续检测并提取 Caicai 标签，直到没有为止
                            while True:
                                em = re.search(r"【表情】\s*(\S+)", accumulated)
                                am = re.search(r"【动作】\s*(\S+)", accumulated)

                                if not em and not am:
                                    break

                                # 找最早出现的标签
                                if em and am:
                                    earliest = em if em.start() < am.start() else am
                                elif em:
                                    earliest = em
                                else:
                                    earliest = am

                                # 发标签前缀的纯文本
                                prefix = accumulated[: earliest.start()]
                                if prefix:
                                    yield {"type": "token", "text": prefix}

                                tag_name = earliest.group(1).strip()
                                if earliest == em:
                                    mapped = self.EXPR_MAP.get(tag_name, "happy")
                                    yield {"type": "caicai_event", "events": [{"type": "expression", "value": mapped}]}
                                else:
                                    mapped = self.ACTION_MAP.get(tag_name, "idle")
                                    yield {"type": "caicai_event", "events": [{"type": "action", "value": mapped}]}

                                # 截断已处理部分
                                accumulated = accumulated[earliest.end() :]

                            # 没有标签了就正常 yield 文本（文本已在上方 yield）
                            # 剩余 accumulated 会被下次 token 继续累积

                    elif event_type == "done":
                        # 最后清理剩余的 accumulated 文本（去掉标签）
                        clean = self._strip_caicai_tags(accumulated)
                        if clean:
                            yield {"type": "token", "text": clean}
                        yield {"type": "done", "session": obj.get("session", {})}

                    elif event_type == "error":
                        yield {"type": "error", "message": obj.get("message", "Unknown error")}

        except Exception as e:
            print(f"[ChatService] hermes-webui stream failed: {e}")
            async for chunk in self._fallback_via_gateway_bridge(message):
                yield chunk

    async def _fallback_via_gateway_bridge(self, message: str) -> AsyncGenerator[dict, None]:
        """
        hermes-webui 不可用时，直接走 gateway_bridge 调模型，仍保持前端可消费的流式协议。
        """
        from .gateway_bridge import gateway_bridge

        try:
            response = await gateway_bridge.send_message(message)
            if response.reply:
                yield {"type": "token", "text": response.reply}
            for event in response.events:
                yield {"type": "caicai_event", "events": [event.model_dump()]}
            yield {
                "type": "done",
                "session": {},
                "reply": response.reply,
                "events": [event.model_dump() for event in response.events],
            }
        except Exception as e:
            yield {"type": "error", "message": f"fallback bridge failed: {e}"}


# 全局单例
chat_service = ChatService()
