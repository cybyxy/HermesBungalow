"""Hermes Bungalow @-handoff parsing (aligned with frontend ``gameApi.ts``)."""

from __future__ import annotations

import re
from typing import Any

USER_RELAY_RE = re.compile(r"^/relay\s+(\S+)\s*\|\s*([\s\S]+)$", re.I)
USER_AT_PIPE_RE = re.compile(r"^@([^\s|@\n]+)\s*[|｜]\s*([\s\S]+)$")
USER_AT_SPACE_RE = re.compile(r"^@([^\s|@\n]+)\s+([\s\S]+)$")

_AT_PIPE_LINE = re.compile(r"^\s*@([^\s|@]+)\s*[|｜]\s*(.+)$")
_AT_SPACE_LINE = re.compile(r"^\s*@([^\s|@]+)\s+([\s\S]+)$")


def is_broadcast_all_handoff_token(token: str) -> bool:
    t = (token or "").strip()
    return t == "所有人" or t.lower() == "all"


def parse_user_handoff_prefix(text: str) -> dict[str, Any] | None:
    """Parse leading user handoff: ``/relay``, ``@a|b``, ``@a b``."""
    raw = (text or "").lstrip()
    m = USER_RELAY_RE.match(raw)
    if m:
        token = str(m.group(1) or "").strip()
        message = str(m.group(2) or "").strip()
        if token and message:
            return {"token": token, "message": message, "was_legacy_relay": True}
        return None
    m = USER_AT_PIPE_RE.match(raw)
    if m:
        token = str(m.group(1) or "").strip()
        message = str(m.group(2) or "").strip()
        if token and message:
            return {"token": token, "message": message, "was_legacy_relay": False}
        return None
    m = USER_AT_SPACE_RE.match(raw)
    if m:
        token = str(m.group(1) or "").strip()
        message = str(m.group(2) or "").strip()
        if token and message:
            return {"token": token, "message": message, "was_legacy_relay": False}
    return None


def _norm_handoff_line(line: str) -> str:
    return line.replace("\uff5c", "|")


def parse_at_handoff_lines(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw in (text or "").splitlines():
        line = _norm_handoff_line(raw).strip()
        if not line.startswith("@"):
            continue
        mp = _AT_PIPE_LINE.match(line)
        if not mp:
            mp = _AT_SPACE_LINE.match(line)
        if not mp:
            continue
        target = str(mp.group(1) or "").strip()
        message = str(mp.group(2) or "").strip()
        if target and message:
            out.append((target, message))
    return out


def parse_hermes_bungalow_invokes(text: str) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for t, msg in parse_at_handoff_lines(text):
        key = (t, msg)
        if key in seen:
            continue
        seen.add(key)
        out.append((t, msg))
    return out


def strip_handoff_lines(text: str) -> str:
    """Remove @ handoff lines (assistant / invoker context peel)."""
    lines: list[str] = []
    for raw_line in (text or "").splitlines():
        line = _norm_handoff_line(raw_line).strip()
        if line.startswith("@") and (_AT_PIPE_LINE.match(line) or _AT_SPACE_LINE.match(line)):
            continue
        lines.append(raw_line)
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def expand_broadcast_invokes_for_sender(
    from_agent: Any,
    agents: list[Any],
    invokes: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Expand ``@所有人`` / ``@all`` to one row per other agent (profile token)."""
    pid = getattr(from_agent, "id", None)
    out: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for tt, msg in invokes:
        t = str(tt).strip()
        m = msg.strip()
        if not t or not m:
            continue
        if is_broadcast_all_handoff_token(t):
            for a in agents:
                if getattr(a, "id", None) == pid:
                    continue
                prof = str(getattr(a, "profile", "") or "").strip() or str(getattr(a, "id", ""))
                key = (prof, m)
                if key in seen:
                    continue
                seen.add(key)
                out.append((prof, m))
        else:
            key = (t, m)
            if key not in seen:
                seen.add(key)
                out.append((t, m))
    return out
