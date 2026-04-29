import asyncio
from typing import Optional


class HermesGatewayManager:
    """
    负责 Hermes Gateway 进程的生命周期管理：
    - 后端启动时拉起
    - 后端关闭时回收
    """

    def __init__(self, workspace: str):
        self.workspace = workspace
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._stderr_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self._proc and self._proc.returncode is None:
            print(f"[HermesGateway] already running pid={self._proc.pid}")
            return

        self._proc = await asyncio.create_subprocess_exec(
            "hermes",
            "gateway",
            "run",
            cwd=self.workspace,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        if not self._proc.stderr:
            return

        async def _drain_stderr() -> None:
            assert self._proc and self._proc.stderr
            while True:
                line = await self._proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="ignore").strip()
                if text:
                    print(f"[HermesGateway] {text}")

        self._stderr_task = asyncio.create_task(_drain_stderr())
        print(f"[HermesGateway] started with backend lifecycle pid={self._proc.pid}")

    async def stop(self) -> None:
        if self._stderr_task:
            self._stderr_task.cancel()
            self._stderr_task = None

        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except Exception:
                self._proc.kill()
                await self._proc.wait()
            print("[HermesGateway] stopped with backend shutdown")
        self._proc = None


hermes_gateway_manager = HermesGatewayManager(
    workspace="/Users/bobo/ai_projects/HermesBungalow"
)

