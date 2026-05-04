"""Read Hermes persona data from the active profile config/SOUL."""

from __future__ import annotations

import hashlib
import re
from typing import Any


def personality_stable_id(display_name: str) -> str:
    """ASCII-stable id for URLs/game state; same name always maps to same id."""
    h = hashlib.sha256(display_name.encode("utf-8")).hexdigest()[:16]
    return f"hp_{h}"


def list_hermes_personalities(*, preview_max: int | None = None) -> list[dict[str, str]]:
    """Return [{name, description}, ...] from config.yaml agent.personalities.

    preview_max: if set, clip description length (for Web UI list); None = full text for game sync.
    """
    from api.config import get_config, reload_config

    reload_config()
    cfg = get_config()
    agent_cfg = cfg.get("agent", {}) or {}
    raw = agent_cfg.get("personalities", {})
    out: list[dict[str, str]] = []
    if not isinstance(raw, dict):
        return out
    for name, value in raw.items():
        desc = ""
        if isinstance(value, dict):
            desc = str(value.get("description", "") or "")
        elif isinstance(value, str):
            desc = value
        if preview_max is not None and len(desc) > preview_max:
            desc = desc[:preview_max] + ("…" if preview_max > 0 else "")
        out.append({"name": str(name), "description": desc})
    return out


def personalities_payload_for_api() -> dict[str, Any]:
    """Response body for GET /api/personalities (short descriptions in list)."""
    return {"personalities": list_hermes_personalities(preview_max=80)}


def _active_hermes_home():
    from api.profiles import get_active_hermes_home

    return get_active_hermes_home()


def _read_soul_text() -> str:
    try:
        soul = _active_hermes_home() / "SOUL.md"
        if soul.exists():
            return soul.read_text(encoding="utf-8")
    except Exception:
        return ""
    return ""


def primary_hermes_agent() -> dict[str, str] | None:
    """Resolve the single installed Hermes agent identity.

    Priority:
      1. Parse name from SOUL.md body (e.g. "你叫**崽崽**")
      2. HERMES_WEBUI_BOT_NAME / settings bot_name
      3. fallback "Hermes"
    """
    soul = _read_soul_text()
    name = ""
    if soul:
        m = re.search(r"你叫\*\*(.+?)\*\*", soul)
        if m:
            name = m.group(1).strip()
    if not name:
        from api.config import load_settings

        settings = load_settings()
        val = settings.get("bot_name")
        if isinstance(val, str) and val.strip():
            name = val.strip()
    if not name:
        name = "Hermes"
    if not name:
        return None
    description = soul.strip() if soul.strip() else "Hermes assistant"
    return {"id": personality_stable_id(name), "name": name, "description": description}


def _read_name_from_soul_text(soul: str) -> str:
    if not soul:
        return ""
    m = re.search(r"你叫\*\*([^*]+)\*\*", soul)
    if m:
        return m.group(1).strip()
    return ""


def _read_profession_from_soul_text(soul: str) -> str:
    """Extract profession from SOUL.md '定位' field under '## 核心身份'.

    Handles formats:
      - **定位**: xxx
      - 定位: xxx
    """
    if not soul:
        return ""
    # Match optional bold markers, then 定位, then colon and value to end of line
    m = re.search(r"\*?\*?定位\*?\*?[：:]\s*(.+)", soul, re.MULTILINE)
    if m:
        return m.group(1).strip().rstrip("·-")
    return ""


_MEMES_HEADERS = frozenset({"梗语", "memes", "梗", "meme"})
_PERSONALITY_HEADERS = frozenset({"性格", "性格特点", "性格描述", "personality"})
_CATCHPHRASE_HEADERS = frozenset({"口头禅", "catchphrase", "口癖"})
_GENDER_HEADERS = frozenset({"性别", "gender", "sex"})
_AVATAR_HEADERS = frozenset({"avatar", "头像", "头像路径", "形象", "外观", "sprite", "sprites"})


def _extract_section_body(soul: str, headers: frozenset[str]) -> str | None:
    """Extract section body from ## heading. Returns None if not found."""
    if not soul:
        return None
    for line_start in re.finditer(r"(?m)^##\s+(.+)$", soul):
        title = line_start.group(1).strip()
        if title in headers:
            start = line_start.end()
            next_heading = re.search(r"(?m)^##\s+", soul[start:])
            end = start + next_heading.start() if next_heading else len(soul)
            return soul[start:end].strip()
    return None


def _extract_inline_field(soul: str, keywords: frozenset[str]) -> str | None:
    """Extract inline **Keyword**: or Keyword: field value.

    Stops at blank line or a ## heading.
    Returns None if not found.
    """
    if not soul:
        return None
    # Build pattern: **Keyword**: or **Keyword**: or Keyword:
    alt_kw = "|".join(re.escape(kw) for kw in sorted(keywords, key=len, reverse=True))
    # Match optional bold markers, keyword, optional bold colon, whitespace, then value
    pattern = rf"(?m)^\*?\*?({alt_kw})\*?\*?[：:]\s*(.+?)(?:\n|$)"
    for m in re.finditer(pattern, soul):
        value = m.group(2).strip()
        # Stop at blank line or ## heading
        rest = m.group(0)[m.end(2):]
        # Find next meaningful line
        next_line = re.search(r"(?m)^[^\n]*\n+([ \t]*[^\n#])", m.group(0) + "\n" + soul[m.end():])
        if next_line:
            # If next non-blank line starts with # or is blank, value is just this line
            pass
        return value
    return None


def _extract_inline_multiline(soul: str, keywords: frozenset[str]) -> list[str]:
    """Extract inline **Keyword**: ... block that may span multiple lines.

    Stops at blank line or ## heading.
    """
    if not soul:
        return []
    alt_kw = "|".join(re.escape(kw) for kw in sorted(keywords, key=len, reverse=True))
    pattern = rf"(?m)^\*?\*?({alt_kw})\*?\*?[：:]\s*(.+?)(?:\n\n|#|\Z)"
    for m in re.finditer(pattern, soul, re.DOTALL):
        body = m.group(2)
        items: list[str] = []
        for line in body.splitlines():
            stripped = line.strip().lstrip("-*·").strip().strip('"').strip("'")
            if stripped:
                items.append(stripped)
        return items
    return []


def _read_memes_from_soul_text(soul: str) -> list[str]:
    """Extract memes from ## 梗语 section OR inline **梗语**: block."""
    if not soul:
        return []
    # Try ## section first
    body = _extract_section_body(soul, _MEMES_HEADERS)
    if body is not None:
        memes: list[str] = []
        for line in body.splitlines():
            stripped = line.strip().lstrip("-*·").strip().strip('"').strip("'")
            if stripped:
                memes.append(stripped)
        if memes:
            return memes
    # Fall back to inline format
    return _extract_inline_multiline(soul, _MEMES_HEADERS)


def _read_personality_from_soul_text(soul: str) -> str:
    """Extract personality from ## 性格 section OR inline **性格**: field."""
    if not soul:
        return ""
    # Try ## section first
    body = _extract_section_body(soul, _PERSONALITY_HEADERS)
    if body:
        return body
    # Fall back to inline format
    val = _extract_inline_field(soul, _PERSONALITY_HEADERS)
    return val if val else ""


def _read_catchphrase_from_soul_text(soul: str) -> list[str]:
    """Extract catchphrases from ## 口头禅 section OR inline **口头禅**: block."""
    if not soul:
        return []
    # Try ## section first
    body = _extract_section_body(soul, _CATCHPHRASE_HEADERS)
    if body is not None:
        phrases: list[str] = []
        for line in body.splitlines():
            stripped = line.strip().lstrip("-*·").strip().strip('"').strip("'")
            if stripped:
                phrases.append(stripped)
        if phrases:
            return phrases
    # Fall back to inline format (single line value, treat as one phrase)
    val = _extract_inline_field(soul, _CATCHPHRASE_HEADERS)
    if val:
        # Strip outer quotes/delimiters only (don't split on 、 within the phrase)
        stripped = val.strip().lstrip("-*·").strip().strip('"').strip("'")
        if stripped:
            return [stripped]
    return []


def _read_avatar_from_soul_text(soul: str) -> str:
    """Extract sprite base or path from SOUL.md: ``## 头像`` section first, then inline **头像** / **avatar**."""
    if not soul:
        return ""
    body = _extract_section_body(soul, _AVATAR_HEADERS)
    if body:
        for line in body.splitlines():
            stripped = line.strip().lstrip("-*·").strip().strip('"').strip("'")
            if stripped:
                return stripped
    val = _extract_inline_field(soul, _AVATAR_HEADERS)
    return val if val else ""


def _read_gender_from_soul_text(soul: str) -> str:
    """Extract gender from SOUL.md: ``## 性别`` section or inline **性别** field. Returns 'male', 'female', or 'male' as fallback."""
    if not soul:
        return "male"
    body = _extract_section_body(soul, _GENDER_HEADERS)
    if body:
        for line in body.splitlines():
            stripped = line.strip().lstrip("-*·").strip().strip('"').strip("'")
            if stripped:
                return _normalize_gender(stripped)
    val = _extract_inline_field(soul, _GENDER_HEADERS)
    if val:
        return _normalize_gender(val)
    return "male"


def _normalize_gender(raw: str) -> str:
    """Normalize gender string to 'male' or 'female'."""
    if not raw:
        return "male"
    low = raw.lower()
    if low in ("女", "female", "f", "woman"):
        return "female"
    return "male"


def list_hermes_profile_agents() -> list[dict[str, str]]:
    """Return one display agent per Hermes profile.

    Each profile contributes one agent identity resolved from its SOUL.md first,
    then falls back to profile name.
    """
    from api.profiles import get_hermes_home_for_profile, list_profiles_api

    agents: list[dict[str, str]] = []
    for p in list_profiles_api():
        pname = str(p.get("name") or "").strip()
        if not pname:
            continue
        home = get_hermes_home_for_profile(pname)
        soul_file = home / "SOUL.md"
        soul = ""
        try:
            if soul_file.exists():
                soul = soul_file.read_text(encoding="utf-8")
        except Exception:
            soul = ""
        display = _read_name_from_soul_text(soul) or pname
        prof = _read_profession_from_soul_text(soul)
        personality = _read_personality_from_soul_text(soul)
        catchphrase_list = _read_catchphrase_from_soul_text(soul)
        memes = _read_memes_from_soul_text(soul)
        avatar = _read_avatar_from_soul_text(soul)
        gender = _read_gender_from_soul_text(soul)
        # description kept as full soul text for backwards compat
        desc = soul.strip() if soul.strip() else f"Hermes profile: {pname}"
        agents.append(
            {
                "id": personality_stable_id(f"profile:{pname}"),
                "name": display,
                "description": desc,
                "profile": pname,
                "profession": prof,
                "personality": personality,
                "catchphrase": catchphrase_list,
                "memes": memes,
                "avatar": avatar,
                "gender": gender,
            }
        )
    return agents
