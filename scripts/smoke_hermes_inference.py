#!/usr/bin/env python3
"""POST /api/session/new -> /api/chat/start -> GET /api/chat/stream; exit 0 if model text is received."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _post_json(base: str, path: str, body: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _session_id(data: dict[str, Any]) -> str:
    sid = data.get("session_id")
    if isinstance(sid, str) and sid:
        return sid
    sess = data.get("session")
    if isinstance(sess, dict):
        inner = sess.get("session_id")
        if isinstance(inner, str) and inner:
            return inner
    raise SystemExit("session_id missing from /api/session/new")


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    msg = sys.argv[2] if len(sys.argv) > 2 else "Reply with exactly: pong"

    try:
        raw_sess = _post_json(base, "/api/session/new", {})
    except urllib.error.HTTPError as e:
        raise SystemExit(f"/api/session/new HTTP {e.code}: {e.read().decode(errors='replace')}") from e
    sid = _session_id(raw_sess)

    try:
        started = _post_json(base, "/api/chat/start", {"session_id": sid, "message": msg})
    except urllib.error.HTTPError as e:
        raise SystemExit(f"/api/chat/start HTTP {e.code}: {e.read().decode(errors='replace')}") from e
    stream_id = started.get("stream_id")
    if not isinstance(stream_id, str) or not stream_id:
        raise SystemExit("stream_id missing from /api/chat/start")

    url = f"{base.rstrip('/')}/api/chat/stream?stream_id={urllib.parse.quote(stream_id)}"
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"}, method="GET")

    assembled: list[str] = []
    apperror: str | None = None

    with urllib.request.urlopen(req, timeout=300) as resp:
        buf = ""
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            parts = buf.split("\n\n")
            buf = parts.pop() or ""
            for block in parts:
                event_name = ""
                data_raw = ""
                for line in block.split("\n"):
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_raw = line[5:].strip()
                if not data_raw:
                    continue
                try:
                    payload = json.loads(data_raw)
                except json.JSONDecodeError:
                    continue
                if event_name == "apperror":
                    apperror = str(payload.get("message") or payload)
                    break
                if event_name == "stream_end":
                    break
                if event_name == "done":
                    sess = payload.get("session")
                    if isinstance(sess, dict):
                        msgs = sess.get("messages")
                        if isinstance(msgs, list) and msgs:
                            last = msgs[-1]
                            if isinstance(last, dict) and last.get("role") == "assistant":
                                c = last.get("content")
                                if isinstance(c, str) and c.strip():
                                    assembled = [c]
                    break
                # hermes-webui streaming: event:token data:{"text":"..."}; some paths use delta
                if event_name in ("token", "delta") or "delta" in payload:
                    piece = payload.get("delta")
                    if not isinstance(piece, str) or not piece:
                        piece = payload.get("text")
                    if isinstance(piece, str) and piece:
                        assembled.append(piece)
                tok = payload.get("token")
                if isinstance(tok, str) and tok:
                    assembled.append(tok)
            if apperror:
                break

    text = "".join(assembled).strip()
    if apperror:
        raise SystemExit(f"INFERENCE_FAIL: {apperror}")
    if not text:
        raise SystemExit("INFERENCE_FAIL: empty stream (no token/delta/done content)")
    print("INFERENCE_OK:", text[:500] + ("…" if len(text) > 500 else ""))


if __name__ == "__main__":
    main()
