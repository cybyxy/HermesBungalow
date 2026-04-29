"""
Chat服务（单后端实现）
接收 HermesBungalow 前端请求 -> 直接调用 Hermes CLI -> 注入 Caicai 事件
"""
import asyncio
import json
import re
import os
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator, Optional

PROJECT_WORKSPACE = "/Users/bobo/ai_projects/HermesBungalow"
# 传输层策略：当前 Phase 1.5 固定为 CLI（整项目统一 Hermes CLI）
HERMES_GUI_CHAT_TRANSPORT = os.getenv("HERMES_GUI_CHAT_TRANSPORT", "cli").strip().lower()
# 默认开启：优先通过已安装的 Hermes Agent 发送消息，以共享同一记忆系统
USE_HERMES_AGENT_MEMORY = os.getenv("USE_HERMES_AGENT_MEMORY", "1") == "1"
# GUI 严格模式：默认只走 Hermes Agent，失败时直接报错而不是切其他链路
HERMES_GUI_STRICT_MODE = os.getenv("HERMES_GUI_STRICT_MODE", "1") == "1"
# GUI 默认允许 Hermes 在对话中执行工具/钩子链路
HERMES_GUI_ENABLE_TOOLS = os.getenv("HERMES_GUI_ENABLE_TOOLS", "1") == "1"
# 是否忽略规则注入（默认关闭，保持和 Hermes UI 更一致）
HERMES_GUI_IGNORE_RULES = os.getenv("HERMES_GUI_IGNORE_RULES", "0") == "1"
# 指定默认复用会话（可选）
HERMES_GUI_SESSION_ID = os.getenv("HERMES_GUI_SESSION_ID", "").strip()
# GUI 对单次 hermes chat 的超时（秒）
HERMES_GUI_CHAT_TIMEOUT = int(os.getenv("HERMES_GUI_CHAT_TIMEOUT", "60"))
HERMES_GUI_PERSISTENT_CHANNEL = os.getenv("HERMES_GUI_PERSISTENT_CHANNEL", "0") == "1"
# 是否在每条消息前通过 `hermes sessions list` 查最近会话（默认关闭，优先速度）
HERMES_GUI_LOOKUP_SESSION_EACH_MSG = os.getenv("HERMES_GUI_LOOKUP_SESSION_EACH_MSG", "0") == "1"
# 是否复用历史会话（默认关闭，优先首响应速度）
HERMES_GUI_REUSE_SESSION = os.getenv("HERMES_GUI_REUSE_SESSION", "0") == "1"
# prompt 参数开关：默认 -q，可按需改为 -z（兼容不同 Hermes 发行版）
HERMES_GUI_PROMPT_FLAG = os.getenv("HERMES_GUI_PROMPT_FLAG", "-q").strip() or "-q"
# 是否在本轮消息上强制启用 source=tool（默认关闭，避免简单问答变慢）
HERMES_GUI_FORCE_SOURCE_TOOL = os.getenv("HERMES_GUI_FORCE_SOURCE_TOOL", "0") == "1"
# 单后端常驻 Agent Worker（不为每条消息重启 hermes chat）
HERMES_GUI_USE_AGENT_WORKER = os.getenv("HERMES_GUI_USE_AGENT_WORKER", "1") == "1"
HERMES_AGENT_VENV_PYTHON = os.getenv(
    "HERMES_AGENT_VENV_PYTHON",
    os.path.expanduser("~/.hermes/hermes-agent/venv/bin/python"),
).strip()
HERMES_GUI_WORKER_MAX_TURNS = int(os.getenv("HERMES_GUI_WORKER_MAX_TURNS", "4"))
LAST_CHAT_BACKEND_MODE = "idle"


class ChatService:
    def __init__(self):
        self._session_id: Optional[str] = None
        self._latest_session_cache: Optional[str] = None
        self._latest_session_cache_ts: float = 0.0
        self._channel_proc: Optional[asyncio.subprocess.Process] = None
        self._channel_lock = asyncio.Lock()
        self._channel_events: list[tuple[str, str, float]] = []
        self._channel_reader_tasks: list[asyncio.Task] = []
        self._channel_bootstrapped = False
        self._agent_worker_proc: Optional[asyncio.subprocess.Process] = None
        self._agent_worker_lock = asyncio.Lock()
        self._agent_worker_stderr_task: Optional[asyncio.Task] = None
        self._model_defaults_cache: tuple[str, str] | None = None
        self._model_defaults_cache_ts: float = 0.0

    async def _read_hermes_model_defaults(self) -> tuple[str, str]:
        now = time.time()
        if self._model_defaults_cache and (now - self._model_defaults_cache_ts) < 30:
            return self._model_defaults_cache
        model = ""
        provider = ""
        try:
            # First choice: parse ~/.hermes/config.yaml directly (stable format).
            path_proc = await asyncio.create_subprocess_exec(
                "hermes",
                "config",
                "path",
                cwd=PROJECT_WORKSPACE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            path_stdout, _ = await asyncio.wait_for(path_proc.communicate(), timeout=5)
            cfg_path = path_stdout.decode("utf-8", errors="ignore").strip() if path_proc.returncode == 0 else ""
            if cfg_path and os.path.exists(cfg_path):
                try:
                    content = Path(cfg_path).read_text(encoding="utf-8", errors="ignore")
                    in_model_block = False
                    for raw in content.splitlines():
                        line = raw.rstrip()
                        stripped = line.strip()
                        if not stripped or stripped.startswith("#"):
                            continue
                        # e.g. model:
                        if re.match(r"^[A-Za-z0-9_-]+:\s*$", stripped):
                            in_model_block = stripped.startswith("model:")
                            continue
                        if not in_model_block:
                            continue
                        m1 = re.match(r"^\s*default:\s*(.+?)\s*$", line)
                        if m1 and not model:
                            model = m1.group(1).strip().strip("'\"")
                        m2 = re.match(r"^\s*provider:\s*(.+?)\s*$", line)
                        if m2 and not provider:
                            provider = m2.group(1).strip().strip("'\"")
                        if model and provider:
                            break
                except Exception:
                    pass

            # Fallback: parse `hermes config show` (UI text output).
            proc = await asyncio.create_subprocess_exec(
                "hermes",
                "config",
                "show",
                cwd=PROJECT_WORKSPACE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8)
            if proc.returncode == 0 and (not model or not provider):
                text = stdout.decode("utf-8", errors="ignore")
                # Example:
                # Model: {'default': 'MiniMax-M2.7-highspeed', 'provider': 'minimax-cn', ...}
                m_model = re.search(r"'default':\s*'([^']+)'", text)
                m_provider = re.search(r"'provider':\s*'([^']+)'", text)
                if m_model and not model:
                    model = m_model.group(1).strip()
                if m_provider and not provider:
                    provider = m_provider.group(1).strip()
        except Exception:
            pass
        self._model_defaults_cache = (model, provider)
        self._model_defaults_cache_ts = now
        return model, provider

    async def _get_latest_hermes_session_id(self) -> Optional[str]:
        """
        通过 `hermes sessions list` 获取最近一次会话 ID。
        输出表格最后一列为 ID。
        """
        import time
        now = time.time()
        if self._latest_session_cache and (now - self._latest_session_cache_ts) < 15:
            return self._latest_session_cache
        try:
            proc = await asyncio.create_subprocess_exec(
                "hermes",
                "sessions",
                "list",
                cwd=PROJECT_WORKSPACE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=12)
            if proc.returncode != 0:
                return None
            output = stdout.decode("utf-8", errors="ignore")
            # 例: ... cli    20260429_111710_459168
            for raw in output.splitlines():
                line = raw.strip()
                if not line or line.startswith("Preview") or line.startswith("─"):
                    continue
                # 跳过健康检查会话，避免把「请只回复 pong」上下文带入 GUI 正常聊天
                if "请只回复 pong" in line or line.endswith(" pong"):
                    continue
                m = re.search(r"(\d{8}_\d{6}_[0-9a-fA-F]+)\s*$", line)
                if m:
                    sid = m.group(1)
                    self._latest_session_cache = sid
                    self._latest_session_cache_ts = now
                    return sid
            return None
        except Exception:
            return None

    def _strip_hermes_cli_meta(self, text: str) -> str:
        """清理 hermes chat 可能混入 stdout 的元信息行。"""
        if not text:
            return text
        cleaned_lines: list[str] = []
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                cleaned_lines.append(raw)
                continue
            if line.startswith("↻ Resumed session "):
                continue
            cleaned_lines.append(raw)
        return "\n".join(cleaned_lines).strip()

    def _should_enable_tools_for_message(self, message: str) -> bool:
        """
        仅在用户明确需要工具时启用 hooks/多轮，避免普通问答被工具链拖慢。
        """
        if not HERMES_GUI_ENABLE_TOOLS:
            return False
        text = (message or "").lower()
        tool_keywords = [
            "调用工具",
            "使用工具",
            "tool",
            "skills",
            "skill",
            "读取文件",
            "执行命令",
            "run command",
        ]
        return any(k in text for k in tool_keywords)

    async def _resolve_preferred_session_id(
        self,
        incoming_session_id: Optional[str],
        *,
        need_cli_lookup: bool = True,
    ) -> Optional[str]:
        if incoming_session_id and incoming_session_id.strip():
            return incoming_session_id.strip()
        if HERMES_GUI_SESSION_ID:
            return HERMES_GUI_SESSION_ID
        if need_cli_lookup:
            latest = await self._get_latest_hermes_session_id()
            if latest:
                return latest
        return self._session_id

    async def close(self):
        await self.shutdown_persistent_channel()
        await self.shutdown_agent_worker()

    async def initialize_agent_worker(self) -> None:
        if not HERMES_GUI_USE_AGENT_WORKER:
            return
        if self._agent_worker_proc and self._agent_worker_proc.returncode is None:
            return
        worker_script = str(Path(__file__).with_name("hermes_agent_worker.py"))
        self._agent_worker_proc = await asyncio.create_subprocess_exec(
            HERMES_AGENT_VENV_PYTHON,
            worker_script,
            cwd=PROJECT_WORKSPACE,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if (
            self._agent_worker_proc.stdin is None
            or self._agent_worker_proc.stdout is None
            or self._agent_worker_proc.stderr is None
        ):
            raise RuntimeError("failed to start hermes agent worker")
        # 持续排空 stderr，避免子进程因 stderr 缓冲区写满而阻塞
        async def _drain_stderr() -> None:
            assert self._agent_worker_proc and self._agent_worker_proc.stderr
            while True:
                line = await self._agent_worker_proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="ignore").strip()
                if text:
                    print(f"[ChatService][worker stderr] {text}")
        self._agent_worker_stderr_task = asyncio.create_task(_drain_stderr())

    async def shutdown_agent_worker(self) -> None:
        if self._agent_worker_stderr_task:
            self._agent_worker_stderr_task.cancel()
            self._agent_worker_stderr_task = None
        if self._agent_worker_proc and self._agent_worker_proc.returncode is None:
            self._agent_worker_proc.terminate()
            try:
                await asyncio.wait_for(self._agent_worker_proc.wait(), timeout=2)
            except Exception:
                self._agent_worker_proc.kill()
                await self._agent_worker_proc.wait()
        self._agent_worker_proc = None

    async def initialize_persistent_channel(self) -> None:
        if not HERMES_GUI_PERSISTENT_CHANNEL:
            return
        if self._channel_proc and self._channel_proc.returncode is None:
            return
        await self._start_persistent_channel()

    async def shutdown_persistent_channel(self) -> None:
        for t in self._channel_reader_tasks:
            t.cancel()
        self._channel_reader_tasks = []
        if self._channel_proc and self._channel_proc.returncode is None:
            self._channel_proc.terminate()
            try:
                await asyncio.wait_for(self._channel_proc.wait(), timeout=2)
            except Exception:
                self._channel_proc.kill()
                await self._channel_proc.wait()
        self._channel_proc = None
        self._channel_bootstrapped = False

    async def _start_persistent_channel(self) -> None:
        self._channel_events = []
        self._channel_proc = await asyncio.create_subprocess_exec(
            "hermes",
            "chat",
            "-Q",
            "--source",
            "tool",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=PROJECT_WORKSPACE,
        )
        if self._channel_proc.stdout is None or self._channel_proc.stderr is None:
            raise RuntimeError("failed to start persistent hermes channel")

        async def _reader(stream_name: str, stream: asyncio.StreamReader) -> None:
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="ignore")
                self._channel_events.append((stream_name, text, time.time()))

        self._channel_reader_tasks = [
            asyncio.create_task(_reader("stdout", self._channel_proc.stdout)),
            asyncio.create_task(_reader("stderr", self._channel_proc.stderr)),
        ]
        # 预热时给一点时间吞掉启动横幅
        await asyncio.sleep(0.8)
        self._channel_bootstrapped = True

    # ── Session 管理 ────────────────────────────────────────────

    async def ensure_session(self, preferred_session_id: Optional[str] = None) -> str:
        """确保有一个活跃 session，返回 session_id"""
        if preferred_session_id:
            self._session_id = preferred_session_id.strip()
            return self._session_id
        if HERMES_GUI_SESSION_ID:
            self._session_id = HERMES_GUI_SESSION_ID
            return self._session_id
        if self._session_id:
            return self._session_id
        latest = await self._get_latest_hermes_session_id()
        if latest:
            self._session_id = latest
            return self._session_id

        # 最后兜底：用时间戳做 session_id（仅本服务内标识）
        import time
        self._session_id = f"caicai_{int(time.time())}"
        return self._session_id

    async def list_sessions(self) -> list:
        """列出所有 sessions（CLI only）"""
        try:
            proc = await asyncio.create_subprocess_exec(
                "hermes",
                "sessions",
                "list",
                cwd=PROJECT_WORKSPACE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=12)
            if proc.returncode != 0:
                return []

            rows: list[dict] = []
            output = stdout.decode("utf-8", errors="ignore")
            for raw in output.splitlines():
                line = raw.rstrip()
                if not line.strip() or line.startswith("Preview") or line.startswith("─"):
                    continue
                m = re.search(r"(?P<preview>.+?)\s{2,}(?P<last_active>.+?)\s{2,}(?P<src>\S+)\s{2,}(?P<id>\d{8}_\d{6}_[0-9a-fA-F]+)\s*$", line)
                if not m:
                    continue
                rows.append({
                    "session_id": m.group("id"),
                    "preview": m.group("preview").strip(),
                    "last_active": m.group("last_active").strip(),
                    "source": m.group("src").strip(),
                })
            return rows
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

    def _is_memory_query(self, message: str) -> bool:
        text = (message or "").lower()
        keywords = [
            "永久记忆",
            "读取记忆",
            "memory.md",
            "user.md",
            "memory",
            "memories",
        ]
        return any(k in text for k in keywords)

    def _read_hermes_memories_text(self) -> str:
        memories_root = Path(os.path.expanduser("~/.hermes/memories"))
        targets = [("MEMORY.md", "MEMORY"), ("USER.md", "USER")]
        sections: list[str] = []
        for filename, title in targets:
            path = memories_root / filename
            if not path.exists():
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="ignore").strip()
            except Exception:
                continue
            if content:
                sections.append(f"## {title}\n{content}")

        if not sections:
            return "未找到 Hermes 永久记忆文件（~/.hermes/memories/MEMORY.md 或 USER.md）。"
        return "\n\n".join(sections)

    # ── 流式发送 ───────────────────────────────────────────────

    async def send_message(
        self,
        message: str,
        images: Optional[list[dict]] = None,
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        发送消息给 Hermes CLI，流式返回 chunks。
        每個 chunk: {"type": "token", "text": "..."} 或 {"type": "done", "session": {...}}
        同时检测 Caicai 事件并注入: {"type": "caicai_event", "events": [...]}
        """
        global LAST_CHAT_BACKEND_MODE
        t0 = time.perf_counter()
        # 永久记忆查询兜底：直接读取本机 Hermes memory 文件，避免模型链路卡住
        if self._is_memory_query(message):
            memory_text = self._read_hermes_memories_text()
            events = [{"type": "expression", "value": "thinking"}, {"type": "action", "value": "search_documents"}]
            print(f"[Perf][chat_service] memory_shortcut_ms={(time.perf_counter() - t0) * 1000:.1f}")
            yield {"type": "token", "text": memory_text}
            yield {"type": "caicai_event", "events": events}
            yield {"type": "done", "session": {}, "reply": memory_text, "events": events}
            return

        # CLI-only 模式：整项目聊天统一走 Hermes CLI
        transport = "cli"
        LAST_CHAT_BACKEND_MODE = "hermes-agent-cli"
        preferred_session_id = await self._resolve_preferred_session_id(
            session_id,
            # 速度优先：默认不做每消息 sessions list 探测
            need_cli_lookup=(
                HERMES_GUI_REUSE_SESSION
                and HERMES_GUI_LOOKUP_SESSION_EACH_MSG
                and not bool(session_id or self._session_id or HERMES_GUI_SESSION_ID)
            ),
        )
        print(
            f"[Perf][chat_service] pre_cli_ms={(time.perf_counter() - t0) * 1000:.1f} "
            f"preferred_session_id={preferred_session_id or '-'}"
        )

        async for chunk in self._send_via_hermes_agent(message, preferred_session_id=preferred_session_id):
            yield chunk
        return

    async def _send_via_hermes_agent(
        self,
        message: str,
        preferred_session_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        通过已安装的 Hermes Agent CLI 发送单轮消息。
        优点：直接复用 Hermes memory provider（与用户本机 Hermes 共享记忆）。
        """
        if HERMES_GUI_USE_AGENT_WORKER:
            try:
                async for chunk in self._send_via_agent_worker(
                    message,
                    preferred_session_id=preferred_session_id,
                ):
                    yield chunk
                return
            except Exception as e:
                print(f"[ChatService] agent worker fallback to cli: {e}")

        if HERMES_GUI_PERSISTENT_CHANNEL:
            try:
                async for chunk in self._send_via_persistent_channel(message):
                    yield chunk
                return
            except Exception as e:
                print(f"[ChatService] persistent channel fallback to one-shot cli: {e}")

        global LAST_CHAT_BACKEND_MODE
        try:
            t0 = time.perf_counter()
            effective_session = (preferred_session_id or HERMES_GUI_SESSION_ID or self._session_id or "").strip()
            base_cmd = [
                "hermes",
                "chat",
                "-Q",
                HERMES_GUI_PROMPT_FLAG,
                message,
            ]
            cmd = list(base_cmd)
            if HERMES_GUI_REUSE_SESSION and effective_session:
                cmd.extend(["--resume", effective_session])
            elif HERMES_GUI_REUSE_SESSION:
                # 无显式 session 时，交给 Hermes 自身继续最近上下文，避免额外 list 开销
                cmd.append("--continue")
            # 默认走极速单轮；仅在用户明确要工具时才开启 hooks + 多轮
            need_tools = self._should_enable_tools_for_message(message)
            if need_tools or HERMES_GUI_FORCE_SOURCE_TOOL:
                cmd.extend(["--source", "tool"])
            if need_tools:
                cmd.extend(["--accept-hooks", "--max-turns", "4"])
            else:
                cmd.extend(["--max-turns", "1"])
            if HERMES_GUI_IGNORE_RULES:
                cmd.append("--ignore-rules")
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=PROJECT_WORKSPACE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=HERMES_GUI_CHAT_TIMEOUT)
            code = proc.returncode
            t1 = time.perf_counter()
            raw_reply = stdout.decode("utf-8", errors="ignore")
            raw_stdout = raw_reply
            err_text = stderr.decode("utf-8", errors="ignore")
            print(
                f"[Perf][chat_service] cli_call_ms={(t1 - t0) * 1000:.1f} code={code} "
                f"stdout_len={len(raw_reply)} stderr_len={len(err_text)} cmd={' '.join(cmd[:6])}..."
            )

            # 将 stderr 思考日志以 thinking 事件透传到前端
            for line in err_text.splitlines():
                thought = line.strip()
                if thought:
                    yield {"type": "thinking", "text": thought}

            if code != 0 and effective_session:
                fallback_cmd = list(base_cmd)
                if need_tools or HERMES_GUI_FORCE_SOURCE_TOOL:
                    fallback_cmd.extend(["--source", "tool"])
                if need_tools:
                    fallback_cmd.extend(["--accept-hooks", "--max-turns", "4"])
                else:
                    fallback_cmd.extend(["--max-turns", "1"])
                if HERMES_GUI_IGNORE_RULES:
                    fallback_cmd.append("--ignore-rules")
                fallback_cmd.append("--continue")
                proc2 = await asyncio.create_subprocess_exec(
                    *fallback_cmd,
                    cwd=PROJECT_WORKSPACE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout2, stderr2 = await asyncio.wait_for(proc2.communicate(), timeout=HERMES_GUI_CHAT_TIMEOUT)
                code = proc2.returncode
                raw_reply = stdout2.decode("utf-8", errors="ignore")
                raw_stdout = raw_reply
                err_text = stderr2.decode("utf-8", errors="ignore")
                t2 = time.perf_counter()
                print(
                    f"[Perf][chat_service] cli_fallback_ms={(t2 - t1) * 1000:.1f} code={code} "
                    f"stdout_len={len(raw_reply)} stderr_len={len(err_text)}"
                )
                for line in err_text.splitlines():
                    thought = line.strip()
                    if thought:
                        yield {"type": "thinking", "text": thought}

            if code != 0:
                raise RuntimeError((err_text or raw_reply).strip() or f"hermes chat failed ({code})")

            raw_reply = self._strip_hermes_cli_meta(raw_reply).strip()
            if not raw_reply:
                raise RuntimeError("empty reply from hermes chat")
            LAST_CHAT_BACKEND_MODE = "hermes-agent-shared-memory"
            # 兼容从 CLI 输出提取恢复后的 session_id
            resumed = re.search(r"Resumed session\\s+(\\d{8}_\\d{6}_[0-9a-fA-F]+)", (raw_stdout or "") + "\n" + (err_text or ""))
            if resumed:
                self._session_id = resumed.group(1)

            events = self._parse_caicai_events(raw_reply)
            clean = self._strip_caicai_tags(raw_reply)
            if not events:
                events = [{"type": "expression", "value": "happy"}, {"type": "action", "value": "wave_hand"}]

            if clean:
                step = 24
                for i in range(0, len(clean), step):
                    yield {"type": "token", "text": clean[i:i + step]}
                    await asyncio.sleep(0)
            if events:
                yield {"type": "caicai_event", "events": events}
            done_session = {"session_id": effective_session} if (HERMES_GUI_REUSE_SESSION and effective_session) else {}
            yield {"type": "done", "session": done_session, "reply": clean, "events": events}
        except Exception as e:
            print(f"[ChatService] hermes-agent mode failed: {e}")
            if HERMES_GUI_STRICT_MODE:
                LAST_CHAT_BACKEND_MODE = "hermes-agent-error"
                yield {
                    "type": "error",
                    "message": f"Hermes Agent 不可用：{e}",
                }
                return

            # Phase 1: 聊天链路仅走 Hermes CLI，不再回退到 gateway_bridge 推理链路
            LAST_CHAT_BACKEND_MODE = "hermes-agent-error"
            yield {
                "type": "error",
                "message": f"Hermes Agent 不可用：{e}",
            }
            return

    async def _send_via_agent_worker(
        self,
        message: str,
        preferred_session_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        global LAST_CHAT_BACKEND_MODE
        async with self._agent_worker_lock:
            await self.initialize_agent_worker()
            proc = self._agent_worker_proc
            if not proc or proc.returncode is not None:
                raise RuntimeError("agent worker unavailable")
            if proc.stdin is None or proc.stdout is None:
                raise RuntimeError("agent worker stdio unavailable")

            effective_session = (preferred_session_id or HERMES_GUI_SESSION_ID or self._session_id or "").strip()
            if not effective_session:
                effective_session = await self.ensure_session()
            model, provider = await self._read_hermes_model_defaults()
            # Worker 路径默认允许工具链，避免链式会话因单轮/禁工具而卡住。
            need_tools = HERMES_GUI_ENABLE_TOOLS
            request_id = uuid.uuid4().hex
            print(
                f"[Perf][chat_service] worker.start session_id={effective_session} "
                f"model={model or '-'} provider={provider or '-'} need_tools={need_tools}"
            )
            payload = {
                "op": "chat",
                "request_id": request_id,
                "session_id": effective_session,
                "message": message,
                "need_tools": bool(need_tools or HERMES_GUI_FORCE_SOURCE_TOOL),
                "max_turns": max(1, HERMES_GUI_WORKER_MAX_TURNS if need_tools else 1),
                "ignore_rules": HERMES_GUI_IGNORE_RULES,
                "model": model,
                "provider": provider,
            }
            proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
            await proc.stdin.drain()

            t0 = time.perf_counter()
            raw_reply = ""
            streamed_any_token = False
            stream_tokens_count = 0
            first_token_at: float | None = None
            while True:
                if proc.returncode is not None:
                    raise RuntimeError("agent worker exited unexpectedly")
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=HERMES_GUI_CHAT_TIMEOUT)
                if not line:
                    raise RuntimeError("agent worker closed stdout")
                text = line.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue
                try:
                    evt = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if evt.get("request_id") != request_id:
                    continue

                tp = evt.get("type")
                if tp == "token":
                    token = str(evt.get("text", ""))
                    if token:
                        raw_reply += token
                        streamed_any_token = True
                        stream_tokens_count += 1
                        if first_token_at is None:
                            first_token_at = time.perf_counter()
                            print(
                                f"[Perf][chat_service] worker.first_token_ms="
                                f"{(first_token_at - t0) * 1000:.1f}"
                            )
                        yield {"type": "token", "text": token}
                elif tp == "thinking":
                    thinking = str(evt.get("text", "")).strip()
                    if thinking:
                        yield {"type": "thinking", "text": thinking}
                elif tp == "error":
                    raise RuntimeError(str(evt.get("message", "agent worker error")))
                elif tp == "done":
                    final_reply = str(evt.get("reply", "")).strip() or raw_reply
                    if not final_reply.strip():
                        raise RuntimeError("agent worker returned empty reply")
                    # 有些 provider/路径只在 done 给最终文本，不触发 token 回调。
                    # 为了保持前端稳定的“流式体感”，这里补发分片 token。
                    if not streamed_any_token:
                        step = 24
                        for i in range(0, len(final_reply), step):
                            yield {"type": "token", "text": final_reply[i:i + step]}
                            await asyncio.sleep(0)
                    self._session_id = str(evt.get("session_id", effective_session) or effective_session)
                    t1 = time.perf_counter()
                    print(
                        f"[Perf][chat_service] worker_call_ms={(t1 - t0) * 1000:.1f} "
                        f"session_id={self._session_id} tokens={stream_tokens_count}"
                    )
                    LAST_CHAT_BACKEND_MODE = "hermes-agent-worker"
                    events = self._parse_caicai_events(final_reply)
                    clean = self._strip_caicai_tags(final_reply)
                    if not events:
                        events = [{"type": "expression", "value": "happy"}, {"type": "action", "value": "wave_hand"}]
                    if events:
                        yield {"type": "caicai_event", "events": events}
                    yield {
                        "type": "done",
                        "session": {"session_id": self._session_id},
                        "reply": clean,
                        "events": events,
                    }
                    return

    async def _send_via_persistent_channel(self, message: str) -> AsyncGenerator[dict, None]:
        """
        复用单个常驻 hermes chat 进程；后端启动后只初始化一次。
        """
        global LAST_CHAT_BACKEND_MODE
        async with self._channel_lock:
            await self.initialize_persistent_channel()
            if not self._channel_proc or self._channel_proc.returncode is not None:
                raise RuntimeError("persistent hermes channel not available")
            if self._channel_proc.stdin is None:
                raise RuntimeError("persistent channel stdin unavailable")

            start_idx = len(self._channel_events)
            self._channel_proc.stdin.write((message + "\n").encode("utf-8"))
            await self._channel_proc.stdin.drain()

            # 等待输出：有新内容后，空闲 500ms 视为本轮完成
            start_time = time.time()
            first_seen = False
            while True:
                await asyncio.sleep(0.05)
                if len(self._channel_events) > start_idx:
                    first_seen = True
                    last_ts = self._channel_events[-1][2]
                    if time.time() - last_ts > 0.5:
                        break
                if time.time() - start_time > HERMES_GUI_CHAT_TIMEOUT:
                    raise RuntimeError(f"persistent channel timeout after {HERMES_GUI_CHAT_TIMEOUT}s")
                if self._channel_proc.returncode is not None:
                    raise RuntimeError("persistent channel exited unexpectedly")

            slice_events = self._channel_events[start_idx:]
            stdout_text = "".join(text for stream, text, _ in slice_events if stream == "stdout")
            stderr_text = "".join(text for stream, text, _ in slice_events if stream == "stderr")

            for line in stderr_text.splitlines():
                thought = line.strip()
                if thought:
                    yield {"type": "thinking", "text": thought}

            clean_stdout = self._strip_hermes_cli_meta(stdout_text).strip()
            # 去掉交互回显行（与用户输入相同的首行）
            stdout_lines = [ln for ln in clean_stdout.splitlines() if ln.strip()]
            filtered_lines = [ln for ln in stdout_lines if ln.strip() != message.strip()]
            clean_stdout = "\n".join(filtered_lines).strip() if filtered_lines else clean_stdout
            clean = self._strip_caicai_tags(clean_stdout)
            # 常驻通道如果只回显了用户输入，视为无效结果，回退单次 CLI
            if (not clean and not first_seen) or clean.strip() == message.strip():
                raise RuntimeError("persistent channel returned echo/no-model-output")

            LAST_CHAT_BACKEND_MODE = "hermes-agent-persistent"
            events = self._parse_caicai_events(clean_stdout)
            if not events:
                events = [{"type": "expression", "value": "happy"}, {"type": "action", "value": "wave_hand"}]
            if clean:
                step = 24
                for i in range(0, len(clean), step):
                    yield {"type": "token", "text": clean[i:i + step]}
                    await asyncio.sleep(0)
            if events:
                yield {"type": "caicai_event", "events": events}
            done_session = {"session_id": self._session_id} if self._session_id else {}
            yield {"type": "done", "session": done_session, "reply": clean, "events": events}

    async def _fallback_via_gateway_bridge(self, message: str) -> AsyncGenerator[dict, None]:
        """
        Hermes CLI 不可用时，直接走 gateway_bridge 调模型（保留备用，默认不启用）。
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
