from __future__ import annotations

import asyncio
import shutil
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class SessionState:
    id: str
    created_at: int
    last_active: int
    history: list[dict[str, Any]] = field(default_factory=list)


class HermesBff:
    def __init__(self) -> None:
        self.sessions: dict[str, SessionState] = {}
        self.hermes_bin = shutil.which("hermes")

    def ensure_session(self, preferred: str | None = None) -> SessionState:
        now = int(time.time())
        sid = (preferred or "").strip().lower()
        if sid and sid in self.sessions:
            s = self.sessions[sid]
            s.last_active = now
            return s
        new_sid = sid if (sid and len(sid) == 12 and all(c in "0123456789abcdef" for c in sid)) else new_session_id()
        s = SessionState(id=new_sid, created_at=now, last_active=now)
        self.sessions[new_sid] = s
        return s

    async def _run_hermes_attempt(self, args: list[str]) -> AsyncGenerator[str, None]:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="ignore").strip()
            if text:
                yield text
        rc = await proc.wait()
        if rc != 0:
            err = b""
            if proc.stderr:
                err = await proc.stderr.read()
            raise RuntimeError(err.decode("utf-8", errors="ignore").strip() or f"hermes exit={rc}")

    async def stream_reply(self, session: SessionState, message: str) -> AsyncGenerator[dict[str, Any], None]:
        msg = message.strip()
        if not msg:
            yield {"type": "error", "text": "message is empty"}
            return
        session.last_active = int(time.time())
        session.history.append({"sender": "user", "text": msg, "timestamp": int(time.time())})
        yield {"type": "thinking", "chunk": "正在连接 Hermes..."}

        collected: list[str] = []
        used_hermes = False
        if self.hermes_bin:
            attempts = [
                [self.hermes_bin, "chat", "--session", session.id, msg],
                [self.hermes_bin, "chat", "--session-id", session.id, msg],
                [self.hermes_bin, "chat", msg],
            ]
            for args in attempts:
                try:
                    async for chunk in self._run_hermes_attempt(args):
                        used_hermes = True
                        collected.append(chunk)
                        yield {"type": "chunk", "text": chunk}
                    break
                except Exception:
                    continue

        if not used_hermes:
            fallback = [
                "Hermes CLI 暂不可用，已切换 BFF 保底回复。",
                f"你刚才说的是：{msg}",
                "请检查本机 `hermes` 命令是否可执行后重试。",
            ]
            for line in fallback:
                await asyncio.sleep(0.05)
                collected.append(line)
                yield {"type": "chunk", "text": line}

        answer = "\n".join(collected).strip() or "（无输出）"
        session.history.append({"sender": "assistant", "text": answer, "timestamp": int(time.time())})
        yield {"type": "done", "text": answer, "session_id": session.id}
