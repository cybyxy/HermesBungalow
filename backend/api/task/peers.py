"""Auto-extracted from service.py."""
from __future__ import annotations

import json
from typing import Any

from .models import Agent
# lazy imports in method bodies: from api.task.peers import normalize_peer_base_url, load_peer_allowlist

_META_PEER_PRESETS = "bungalow_peer_presets"
_META_ACTIVE_OUTBOUND = "bungalow_active_outbound"


class PeersMixin:
    """Mixin providing peers operations for TaskService."""

    def get_peer_presets_raw(self) -> list[dict[str, Any]]:
        with self._lock:
            raw = self._meta_get_unlocked(_META_PEER_PRESETS)
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return data if isinstance(data, list) else []

    def _peer_presets_for_api_unlocked(self) -> list[dict[str, Any]]:
        pub: list[dict[str, Any]] = []
        for p in self.get_peer_presets_raw():
            pid = str(p.get("id") or "").strip()
            if not pid:
                continue
            t = str(p.get("peer_token") or "").strip()
            pub.append(
                {
                    "id": pid,
                    "label": str(p.get("label") or pid).strip() or pid,
                    "base_url": str(p.get("base_url") or "").strip(),
                    "relay_agent_id": str(p.get("relay_agent_id") or "").strip(),
                    "has_peer_token": bool(t),
                }
            )
        return pub

    def get_peer_preset(self, preset_id: str) -> dict[str, Any] | None:
        pid = (preset_id or "").strip()
        if not pid:
            return None
        for p in self.get_peer_presets_raw():
            if str(p.get("id") or "").strip() == pid:
                return dict(p)
        return None

    def put_peer_presets(self, presets: list[Any]) -> dict[str, Any]:
        from api.task.peers import normalize_peer_base_url

        _MISSING = object()
        with self._lock:
            old_by_id = {str(p.get("id", "")).strip(): p for p in self.get_peer_presets_raw() if str(p.get("id") or "").strip()}
            out: list[dict[str, Any]] = []
            seen: set[str] = set()
            for p in presets:
                if not isinstance(p, dict):
                    continue
                pid = str(p.get("id") or "").strip()
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                label = str(p.get("label") or pid).strip() or pid
                base_url = str(p.get("base_url") or "").strip()
                if not base_url:
                    continue
                norm_base = normalize_peer_base_url(base_url)
                relay = str(p.get("relay_agent_id") or "").strip()
                tok_raw = p.get("peer_token", _MISSING)
                if tok_raw is _MISSING:
                    old_p = old_by_id.get(pid) or {}
                    old_t = old_p.get("peer_token")
                    tok = str(old_t).strip() if isinstance(old_t, str) else ""
                elif isinstance(tok_raw, str):
                    tok = tok_raw.strip()
                else:
                    tok = ""
                out.append(
                    {
                        "id": pid,
                        "label": label,
                        "base_url": norm_base,
                        "relay_agent_id": relay,
                        "peer_token": tok,
                    }
                )
            self._meta_set_unlocked(_META_PEER_PRESETS, json.dumps(out, ensure_ascii=False))
            return {"ok": True, "count": len(out)}

    def allowed_peer_bases(self) -> list[str]:
        from api.task.peers import load_peer_allowlist, normalize_peer_base_url

        bases = list(load_peer_allowlist())
        for p in self.get_peer_presets_raw():
            u = str(p.get("base_url") or "").strip()
            if not u:
                continue
            try:
                bases.append(normalize_peer_base_url(u))
            except ValueError:
                pass
        return sorted(set(bases))

    def get_active_outbound_visit(self) -> dict[str, Any] | None:
        with self._lock:
            raw = self._meta_get_unlocked(_META_ACTIVE_OUTBOUND)
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        if not str(data.get("visitor_id") or "").strip() or not str(data.get("target_base_url") or "").strip():
            return None
        return data

    def _active_outbound_public_unlocked(self) -> dict[str, Any] | None:
        raw = self._meta_get_unlocked(_META_ACTIVE_OUTBOUND)
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        if not str(data.get("visitor_id") or "").strip():
            return None
        return {
            "preset_id": str(data.get("preset_id") or ""),
            "label": str(data.get("label") or ""),
            "target_base_url": str(data.get("target_base_url") or ""),
        }

    def set_active_outbound_visit(self, preset_id: str, label: str, target_base_url: str, visitor_id: str) -> None:
        from api.task.peers import normalize_peer_base_url

        tgt = normalize_peer_base_url(target_base_url)
        payload = json.dumps(
            {
                "preset_id": (preset_id or "").strip(),
                "label": label or "",
                "target_base_url": tgt,
                "visitor_id": visitor_id.strip(),
            },
            ensure_ascii=False,
        )
        with self._lock:
            self._meta_set_unlocked(_META_ACTIVE_OUTBOUND, payload)

    def clear_active_outbound_visit(self) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM task_meta WHERE key = ?", (_META_ACTIVE_OUTBOUND,))
            self._conn.commit()

    def peer_visitor_as_agent(self, v: PeerVisitor) -> Agent:
        agent = Agent(
            id=v.visitor_id,
            name=v.name,
            display_name=v.display_name or v.name,
            profession=v.profession,
            profile=v.profile,
            hermes_session_id=None,
        )
        # Attach relay metadata as dynamic attributes
        object.__setattr__(agent, "peer_relay_base_url", v.relay_base_url)
        object.__setattr__(agent, "peer_relay_agent_id", v.relay_agent_id)
        return agent

    def _peer_visitor_public_dict(self, v: PeerVisitor) -> dict[str, Any]:
        d = self.peer_visitor_as_agent(v).to_dict()
        d["bungalow_peer_api"] = 1
        d["hermes_session_id"] = ""
        return d

    def iter_agents_for_api(self):
        with self._lock:
            for a in self._world.agents:
                yield a
            for v in self._peer_visitors:
                yield self.peer_visitor_as_agent(v)

    def iter_agents_for_token_resolve(self):
        with self._lock:
            world = list(self._world.agents)
            visitors = [self.peer_visitor_as_agent(v) for v in self._peer_visitors]
        yield from world
        yield from visitors

    def register_peer_visitor(self, v: PeerVisitor) -> None:
        with self._lock:
            self._peer_visitors = [
                x
                for x in self._peer_visitors
                if not (x.relay_base_url == v.relay_base_url and x.relay_agent_id == v.relay_agent_id)
            ]
            self._peer_visitors.append(v)
            self._append_event_log("peer_visit", {"visitor_id": v.visitor_id, "source": v.relay_base_url})
            self._broadcast("agent_status", {"action": "peer_visit", "agent": self._peer_visitor_public_dict(v)})

    def revoke_peer_visitor(self, visitor_id: str) -> bool:
        with self._lock:
            before = len(self._peer_visitors)
            self._peer_visitors = [x for x in self._peer_visitors if x.visitor_id != visitor_id]
            if len(self._peer_visitors) == before:
                return False
            self._append_event_log("peer_leave", {"visitor_id": visitor_id})
            self._broadcast("agent_status", {"action": "peer_leave", "visitor_id": visitor_id})
            return True

    def is_peer_visitor_agent_id(self, agent_id: str) -> bool:
        with self._lock:
            return any(x.visitor_id == agent_id for x in self._peer_visitors)

