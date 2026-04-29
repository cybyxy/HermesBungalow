import asyncio
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class HermesCliResult:
    returncode: int
    stdout: str
    stderr: str
    command: list[str]

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class HermesCliApi:
    """
    独立 Hermes CLI API 封装，供其他服务类统一调用。
    """

    def __init__(self, workspace: str, binary: str = "hermes", default_timeout: int = 20):
        self.workspace = workspace
        self.binary = binary
        self.default_timeout = default_timeout

    def run_sync(
        self,
        args: list[str],
        *,
        timeout: Optional[int] = None,
        check: bool = False,
    ) -> HermesCliResult:
        cmd = [self.binary, *args]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout or self.default_timeout,
            check=False,
            cwd=self.workspace,
        )
        if check and proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout or "").strip() or f"hermes command failed: {' '.join(cmd)}")
        return HermesCliResult(
            returncode=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
            command=cmd,
        )

    async def run_async(
        self,
        args: list[str],
        *,
        timeout: Optional[int] = None,
        check: bool = False,
    ) -> HermesCliResult:
        cmd = [self.binary, *args]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout or self.default_timeout,
        )
        res = HermesCliResult(
            returncode=proc.returncode or 0,
            stdout=(stdout_b or b"").decode("utf-8", errors="ignore"),
            stderr=(stderr_b or b"").decode("utf-8", errors="ignore"),
            command=cmd,
        )
        if check and not res.ok:
            raise RuntimeError((res.stderr or res.stdout).strip() or f"hermes command failed: {' '.join(cmd)}")
        return res

    def list_top_level_commands(self) -> list[str]:
        help_res = self.run_sync(["--help"], timeout=8, check=True)
        m = re.search(r"\{([^}]+)\}", help_res.stdout)
        if not m:
            return []
        return [x.strip() for x in m.group(1).split(",") if x.strip()]

    def get_commands_tree(self) -> dict[str, Any]:
        commands = self.list_top_level_commands()
        tree: dict[str, Any] = {"root": commands, "subcommands": {}}
        for cmd in commands:
            res = self.run_sync([cmd, "--help"], timeout=8)
            if not res.ok:
                tree["subcommands"][cmd] = []
                continue
            m = re.search(r"\{([^}]+)\}", res.stdout)
            if not m:
                tree["subcommands"][cmd] = []
                continue
            sub = [x.strip() for x in m.group(1).split(",") if x.strip()]
            tree["subcommands"][cmd] = sub
        return tree

