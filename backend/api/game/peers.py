"""Peer URL allowlist + token helpers for cross-instance 「串门」."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from starlette.requests import Request

_PEER_RELAY_SEM = threading.BoundedSemaphore(8)


def normalize_peer_base_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("empty_peer_base_url")
    if "://" not in raw:
        raw = f"http://{raw}"
    pr = urlparse(raw)
    if pr.scheme not in ("http", "https"):
        raise ValueError("peer_url_scheme")
    if not pr.hostname:
        raise ValueError("peer_url_host")
    netloc = pr.netloc
    path = (pr.path or "").rstrip("/")
    if path:
        return f"{pr.scheme}://{netloc}{path}".rstrip("/")
    return f"{pr.scheme}://{netloc}".rstrip("/")


def load_peer_allowlist() -> list[str]:
    raw = os.environ.get("HERMES_BUNGALOW_PEERS", "").strip()
    if not raw:
        return []
    p = Path(raw)
    if p.is_file():
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError("peers_file_not_array")
        return [normalize_peer_base_url(str(x)) for x in data if str(x).strip()]
    return [normalize_peer_base_url(x.strip()) for x in raw.split(",") if x.strip()]


def peer_base_in_allowlist(base: str, *, allow: list[str] | None = None) -> bool:
    norm = normalize_peer_base_url(base)
    allowed = allow if allow is not None else load_peer_allowlist()
    return norm in set(allowed)


def peer_auth_configured() -> bool:
    return bool(os.environ.get("HERMES_BUNGALOW_PEER_TOKEN", "").strip())


def server_peer_token() -> str:
    return os.environ.get("HERMES_BUNGALOW_PEER_TOKEN", "").strip()


def verify_peer_token(token: str) -> bool:
    expected = server_peer_token()
    if not expected or not token:
        return False
    a = hashlib.sha256(token.encode("utf-8")).digest()
    b = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(a, b)


def extract_peer_token(body: dict[str, Any], request: Request | None) -> str:
    t = str(body.get("peer_token") or "").strip()
    if t:
        return t
    if request is not None:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
    return ""


def public_base_for_outbound(request: Request | None) -> str | None:
    env = os.environ.get("HERMES_BUNGALOW_PUBLIC_BASE", "").strip()
    if env:
        try:
            return normalize_peer_base_url(env)
        except ValueError:
            return None
    if request is not None:
        try:
            return normalize_peer_base_url(f"{request.url.scheme}://{request.url.netloc}")
        except ValueError:
            return None
    return None


def cross_peer_agent_relay_sync(
    base_url: str,
    relay_agent_id: str,
    message: str,
    *,
    allow: list[str] | None = None,
    peer_token_override: str | None = None,
) -> dict[str, Any]:
    """POST ``/api/game/agent-relay-from-peer`` on the peer Hermes instance (sync, blocking)."""
    tok = (peer_token_override or "").strip() or server_peer_token()
    if not tok:
        raise RuntimeError("peer_token_not_configured")
    norm = normalize_peer_base_url(base_url)
    if not peer_base_in_allowlist(norm, allow=allow):
        raise PermissionError("peer_not_allowlisted")
    url = f"{norm}/api/game/agent-relay-from-peer"
    payload = {"target_agent_id": relay_agent_id, "message": message, "peer_token": tok}
    headers = {"Authorization": f"Bearer {tok}"}
    with _PEER_RELAY_SEM:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(url, json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError((r.text or r.reason_phrase or "upstream_error")[:2000])
    out = r.json()
    if not isinstance(out, dict):
        raise RuntimeError("invalid_upstream_json")
    raw_tr = out.get("trace")
    if isinstance(raw_tr, str):
        try:
            raw_tr = json.loads(raw_tr)
        except json.JSONDecodeError:
            raw_tr = []
    if not isinstance(raw_tr, list):
        raw_tr = []
    out["trace"] = [x for x in raw_tr if isinstance(x, dict)]
    return out
