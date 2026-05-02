"""Hermes Bungalow: ensure per-session AIAgent uses automatic context compression.

Hermes Agent reads ``compression.*`` and ``context.engine`` from
``hermes_cli.config.load_config()`` inside ``AIAgent.__init__``.  This module
wraps that loader so Bungalow/WebUI/game sessions default to **enabled**
auto-compression even when a profile's ``config.yaml`` omitted the block or
set ``enabled: false``.

Each in-game Agent still has its **own** Hermes ``session_id`` / session file;
compression runs **per conversation**, not shared across agents.

Opt-out: ``HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION=1``

Optional tuning: ``HERMES_BUNGALOW_COMPRESSION_THRESHOLD`` (float 0–1, e.g. ``0.45``).
"""

from __future__ import annotations

import copy
import os
import threading
from contextlib import contextmanager
from typing import Any

_LOCK = threading.Lock()

# Bump when overlay semantics change so streaming.py agent-cache signatures invalidate.
CACHE_SIG_TOKEN = "comp-e1"


def bungalow_compression_overlay_active() -> bool:
    v = os.getenv("HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION", "").strip().lower()
    return v not in ("1", "true", "yes", "on")


def apply_bungalow_context_compression_overlay(base: dict[str, Any] | None) -> dict[str, Any]:
    """Return a deep copy of *base* with compression enabled for Bungalow."""
    if not bungalow_compression_overlay_active():
        return copy.deepcopy(base) if isinstance(base, dict) else {}
    cfg = copy.deepcopy(base) if isinstance(base, dict) else {}
    comp = cfg.get("compression")
    if not isinstance(comp, dict):
        comp = {}
    comp = dict(comp)
    comp["enabled"] = True
    thr = os.getenv("HERMES_BUNGALOW_COMPRESSION_THRESHOLD", "").strip()
    if thr:
        try:
            comp["threshold"] = float(thr)
        except ValueError:
            pass
    cfg["compression"] = comp

    ctx = cfg.get("context")
    if not isinstance(ctx, dict):
        ctx = {}
    ctx = dict(ctx)
    # Only fill engine when unset — respect explicit plugin engines (e.g. lcm).
    if not str(ctx.get("engine") or "").strip():
        ctx["engine"] = "compressor"
    cfg["context"] = ctx
    return cfg


@contextmanager
def bungalow_hermes_load_config_overlay():
    """Temporarily replace ``hermes_cli.config.load_config`` for AIAgent construction."""
    if not bungalow_compression_overlay_active():
        yield
        return
    try:
        import hermes_cli.config as m  # type: ignore[import-untyped]
    except ImportError:
        yield
        return

    orig = m.load_config

    def wrapped():
        raw = orig()
        return apply_bungalow_context_compression_overlay(raw if isinstance(raw, dict) else {})

    with _LOCK:
        m.load_config = wrapped  # type: ignore[assignment]
        try:
            yield
        finally:
            m.load_config = orig  # type: ignore[assignment]
