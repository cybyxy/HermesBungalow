"""Model config + provider profiles + channels routes."""
from __future__ import annotations

import json as _json
import os
import urllib.request
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from api.task.service import read_json_body
from ._server_helpers import _ensure_hermes_agent_on_syspath


async def get_model_config(request: Request) -> JSONResponse:  # noqa: ARG001
    from api.config import get_config

    cfg = get_config()
    model_cfg = cfg.get("model", {}) if isinstance(cfg.get("model"), dict) else {}
    providers_cfg = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}

    return JSONResponse({
        "model": model_cfg,
        "providers": providers_cfg,
        "active_profile": cfg.get("_active_profile", "default"),
    })


async def post_model_config(request: Request) -> JSONResponse:
    import yaml as _yaml

    body = read_json_body(await request.body())
    from api.profiles import get_active_hermes_home

    config_path = get_active_hermes_home() / "config.yaml"
    if not config_path.exists():
        return JSONResponse({"ok": False, "error": "config_not_found"}, status_code=404)

    cfg = {}
    try:
        loaded = _yaml.safe_load(config_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            cfg = loaded
    except Exception:
        return JSONResponse({"ok": False, "error": "config_parse_error"}, status_code=500)

    model_section = cfg.get("model", {})
    if not isinstance(model_section, dict):
        model_section = {}
    if "default" in body:
        model_section["default"] = body["default"]
    if "provider" in body:
        model_section["provider"] = body["provider"]
    if "base_url" in body:
        model_section["base_url"] = body["base_url"]
    cfg["model"] = model_section

    config_path.write_text(
        _yaml.dump(cfg, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )

    from api.config import reload_config
    reload_config()

    return JSONResponse({"ok": True, "model": model_section})


async def post_model_provider(request: Request) -> JSONResponse:
    import yaml as _yaml

    body = read_json_body(await request.body())
    action = str(body.get("action") or "add")
    provider_id = str(body.get("provider_id") or "").strip().lower()
    if not provider_id:
        return JSONResponse({"ok": False, "error": "provider_id_required"}, status_code=400)

    from api.profiles import get_active_hermes_home

    config_path = get_active_hermes_home() / "config.yaml"
    if not config_path.exists():
        return JSONResponse({"ok": False, "error": "config_not_found"}, status_code=404)

    cfg: dict = {}
    try:
        loaded = _yaml.safe_load(config_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            cfg = loaded
    except Exception:
        return JSONResponse({"ok": False, "error": "config_parse_error"}, status_code=500)

    providers = cfg.get("providers", {})
    if not isinstance(providers, dict):
        providers = {}

    if action == "delete":
        providers.pop(provider_id, None)
    else:
        new_provider: dict = {
            "name": str(body.get("name") or provider_id),
            "api": str(body.get("api") or ""),
            "transport": str(body.get("transport") or "anthropic_messages"),
            "default_model": str(body.get("default_model") or ""),
            "key_env": str(body.get("key_env") or ""),
        }
        context_length = body.get("context_length")
        if context_length is not None:
            new_provider["context_length"] = int(context_length)
        elif provider_id in providers and isinstance(providers[provider_id], dict):
            existing_cl = providers[provider_id].get("context_length")
            if existing_cl is not None:
                new_provider["context_length"] = existing_cl
        cached_models = body.get("cached_models")
        if isinstance(cached_models, list):
            new_provider["cached_models"] = [str(m) for m in cached_models if m and str(m).strip()]
        if "cached_models" not in new_provider and provider_id in providers:
            existing = providers[provider_id]
            if isinstance(existing, dict) and "cached_models" in existing:
                new_provider["cached_models"] = list(existing["cached_models"])
        providers[provider_id] = new_provider

    cfg["providers"] = providers

    config_path.write_text(
        _yaml.dump(cfg, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )

    # Sync provider configs to all agent profile configs
    profiles_dir = config_path.parent / "profiles"
    if profiles_dir.is_dir():
        for entry in profiles_dir.iterdir():
            if not entry.is_dir():
                continue
            profile_config = entry / "config.yaml"
            if not profile_config.exists():
                continue
            try:
                pc = _yaml.safe_load(profile_config.read_text(encoding="utf-8"))
                if isinstance(pc, dict):
                    pc["providers"] = dict(providers)
                    profile_config.write_text(
                        _yaml.dump(pc, default_flow_style=False, allow_unicode=True),
                        encoding="utf-8",
                    )
            except Exception:
                pass

    from api.config import reload_config
    reload_config()

    return JSONResponse({"ok": True, "providers": list(providers.keys())})


async def get_provider_profiles(request: Request) -> JSONResponse:  # noqa: ARG001
    import sys
    _ensure_hermes_agent_on_syspath()
    try:
        from providers import list_providers
        try:
            from hermes_cli.models import CANONICAL_PROVIDERS
            _canonical_labels = {p.slug: p.label for p in CANONICAL_PROVIDERS}
            _canonical_descs = {p.slug: p.tui_desc for p in CANONICAL_PROVIDERS}
        except Exception:
            _canonical_labels = {}
            _canonical_descs = {}
        profiles = []
        for p in list_providers():
            label = p.display_name or _canonical_labels.get(p.name) or p.name
            desc = p.description or _canonical_descs.get(p.name, "")
            profiles.append({
                "id": p.name,
                "display_name": label,
                "base_url": (p.base_url or "").rstrip("/"),
                "description": desc,
                "api_mode": p.api_mode or "chat_completions",
            })
        return JSONResponse({"profiles": profiles})
    except Exception as e:
        return JSONResponse({"profiles": [], "error": str(e)})


async def post_fetch_remote_models(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    base_url = str(body.get("base_url") or "").strip().rstrip("/")
    api_key = str(body.get("api_key") or "").strip()

    if not base_url:
        return JSONResponse({"ok": False, "error": "base_url is required"}, status_code=400)

    import os as _os
    if api_key and not api_key.startswith("sk-") and not api_key.startswith("eyJ"):
        env_file = _os.path.expanduser("~/.hermes/.env")
        try:
            if _os.path.isfile(env_file):
                with open(env_file) as fh:
                    for line in fh:
                        line = line.strip()
                        if line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        if k.strip() == api_key:
                            api_key = v.strip().strip('"').strip("'")
                            break
        except Exception:
            pass

    models_url = f"{base_url}/models"
    try:
        req = urllib.request.Request(models_url)
        if api_key:
            req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read().decode())
        items = data if isinstance(data, list) else data.get("data", [])
        models = [{"id": m.get("id", ""), "label": m.get("id", "")} for m in items if isinstance(m, dict) and "id" in m]
        return JSONResponse({"ok": True, "models": models})
    except Exception as e:
        return JSONResponse({"ok": False, "models": [], "error": str(e)})


async def get_configured_models(request: Request) -> JSONResponse:  # noqa: ARG001
    from api.config import get_config
    cfg = get_config()
    providers_cfg = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}

    _ensure_hermes_agent_on_syspath()
    curated_models: dict[str, list[dict]] = {}
    curated_labels: dict[str, str] = {}
    try:
        from providers import list_providers
        for p in list_providers():
            curated_labels[p.name] = p.display_name or p.name
            curated_models[p.name] = [
                {"id": m, "label": m} for m in (p.fallback_models or [])
            ]
    except Exception:
        pass

    try:
        from hermes_cli.models import CANONICAL_PROVIDERS
        for cp in CANONICAL_PROVIDERS:
            curated_labels.setdefault(cp.slug, cp.label)
    except Exception:
        pass

    result: list[dict] = []
    for pid, pinfo in providers_cfg.items():
        label = curated_labels.get(pid, pinfo.get("name") or pid)
        models = curated_models.get(pid, [])

        cached = pinfo.get("cached_models")
        if isinstance(cached, list) and cached:
            models = [{"id": m, "label": str(m)} for m in cached if m]
        elif not models:
            api_url = (pinfo.get("api") or "").strip().rstrip("/")
            key_env = (pinfo.get("key_env") or "").strip()
            if api_url:
                api_key = ""
                if key_env:
                    env_file = os.path.expanduser("~/.hermes/.env")
                    try:
                        if os.path.isfile(env_file):
                            with open(env_file) as fh:
                                for line in fh:
                                    line = line.strip()
                                    if line.startswith("#") or "=" not in line:
                                        continue
                                    k, v = line.split("=", 1)
                                    if k.strip() == key_env:
                                        api_key = v.strip().strip('"').strip("'")
                                        break
                    except Exception:
                        pass
                try:
                    req = urllib.request.Request(f"{api_url}/models")
                    if api_key:
                        req.add_header("Authorization", f"Bearer {api_key}")
                    req.add_header("Accept", "application/json")
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        data = _json.loads(resp.read().decode())
                    items = data if isinstance(data, list) else data.get("data", [])
                    models = [{"id": m["id"], "label": m.get("id", m["id"])}
                              for m in items if isinstance(m, dict) and "id" in m]
                except Exception:
                    pass

            if not models:
                dm = (pinfo.get("default_model") or "").strip()
                if dm:
                    models = [{"id": dm, "label": dm}]

        for m in models:
            result.append({
                "provider_id": pid,
                "provider_label": label,
                "model_id": m["id"],
                "model_label": m.get("label", m["id"]),
            })

    return JSONResponse({"models": result})


async def get_configured_channels(request: Request) -> JSONResponse:  # noqa: ARG001
    import os as _os

    from api.profiles import _DEFAULT_HERMES_HOME
    import yaml as _yaml

    config_path = _DEFAULT_HERMES_HOME / "config.yaml"
    cfg = {}
    if config_path.exists():
        try:
            loaded = _yaml.safe_load(config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                cfg = loaded
        except Exception:
            pass

    def _get_platform_config(pname: str) -> dict:
        section = cfg.get("platforms", {}).get(pname)
        if isinstance(section, dict):
            return section
        section = cfg.get(pname)
        if isinstance(section, dict):
            return section
        return {}

    _ensure_hermes_agent_on_syspath()
    ALL_PLATFORMS: dict[str, str] = {}
    SKIP_PLATFORMS = {"cli", "cron", "homeassistant"}
    try:
        from hermes_cli.platforms import get_all_platforms
        for k, info in get_all_platforms().items():
            if k not in SKIP_PLATFORMS:
                ALL_PLATFORMS[k] = getattr(info, "label", None) or k
    except Exception:
        ALL_PLATFORMS = {
            "feishu": "🪽 Feishu", "discord": "💬 Discord", "slack": "💼 Slack",
            "telegram": "📱 Telegram", "matrix": "💬 Matrix", "mattermost": "💬 Mattermost",
            "whatsapp": "📱 WhatsApp", "signal": "📡 Signal", "dingtalk": "💬 DingTalk",
            "wecom": "💬 WeCom", "wecom_callback": "💬 WeCom Callback",
            "weixin": "💬 Weixin", "qqbot": "💬 QQBot", "yuanbao": "🤖 Yuanbao",
            "bluebubbles": "💙 BlueBubbles", "email": "📧 Email",
            "api_server": "🌐 API Server", "webhook": "🔗 Webhook",
        }

    env_vars: dict[str, str] = {}
    try:
        env_path = Path("~/.hermes/.env").expanduser()
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass

    for k in ("FEISHU_APP_ID", "DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN",
              "SLACK_BOT_TOKEN", "MATRIX_PASSWORD", "MATTERMOST_TOKEN",
              "WHATSAPP_MODE", "WHATSAPP_ENABLED", "SIGNAL_HTTP_URL",
              "DINGTALK_CLIENT_ID", "WECHAT_APP_ID", "QQ_APP_ID"):
        v = _os.getenv(k, "")
        if v:
            env_vars.setdefault(k, v)

    def _is_connected(pname: str, pdata: dict) -> bool:
        if not isinstance(pdata, dict):
            return False
        if not pdata.get("enabled", True):
            return False

        extra = pdata.get("extra", {}) or {}
        if not isinstance(extra, dict):
            extra = {}

        if pdata.get("token") or pdata.get("api_key"):
            return True

        if pname == "feishu":
            return bool(extra.get("app_id") or env_vars.get("FEISHU_APP_ID"))
        if pname == "whatsapp":
            return bool(env_vars.get("WHATSAPP_MODE") or env_vars.get("WHATSAPP_ENABLED"))
        if pname == "signal":
            return bool(extra.get("http_url") or env_vars.get("SIGNAL_HTTP_URL"))
        if pname == "dingtalk":
            return bool(extra.get("client_id") or env_vars.get("DINGTALK_CLIENT_ID"))
        if pname == "email":
            return bool(extra.get("address"))
        if pname == "weixin":
            return bool(extra.get("account_id") and (pdata.get("token") or extra.get("token")))
        if pname == "qqbot":
            return bool(extra.get("app_id") and extra.get("client_secret"))
        if pname == "bluebubbles":
            return bool(extra.get("server_url") and extra.get("password"))
        if pname == "wecom":
            return bool(extra.get("bot_id") and extra.get("secret"))
        if pname == "wecom_callback":
            return bool(extra.get("corp_id") or extra.get("apps"))
        if pname == "yuanbao":
            return bool(extra.get("app_id") and extra.get("app_secret"))
        if pname == "matrix":
            return bool(extra.get("homeserver") and (extra.get("password") or env_vars.get("MATRIX_PASSWORD")))
        if pname in ("api_server", "webhook", "msgraph_webhook"):
            return True
        if pname == "google_chat":
            return bool(env_vars.get("GOOGLE_CHAT_PROJECT_ID") and env_vars.get("GOOGLE_CHAT_SUBSCRIPTION_NAME"))
        if pname == "irc":
            return bool(env_vars.get("IRC_SERVER") and env_vars.get("IRC_CHANNEL"))
        if pname == "line":
            return bool(env_vars.get("LINE_CHANNEL_ACCESS_TOKEN") and env_vars.get("LINE_CHANNEL_SECRET"))
        if pname == "simplex":
            return bool(env_vars.get("SIMPLEX_WS_URL"))
        if pname == "teams":
            return bool(env_vars.get("TEAMS_CLIENT_ID") and env_vars.get("TEAMS_CLIENT_SECRET") and env_vars.get("TEAMS_TENANT_ID"))
        if pname == "discord":
            return bool(env_vars.get("DISCORD_BOT_TOKEN"))
        if pname == "telegram":
            return bool(env_vars.get("TELEGRAM_BOT_TOKEN"))
        if pname == "slack":
            return bool(env_vars.get("SLACK_BOT_TOKEN"))
        if pname == "mattermost":
            return bool(env_vars.get("MATTERMOST_TOKEN"))

        return False

    result: list[dict] = []
    for pid, label in sorted(ALL_PLATFORMS.items()):
        pdata = _get_platform_config(pid)
        connected = _is_connected(pid, pdata)
        result.append({
            "channel_id": pid,
            "channel_label": label,
            "connected": connected,
        })

    return JSONResponse({"channels": result})


async def post_channel_config(request: Request) -> JSONResponse:
    import yaml as _yaml

    body = read_json_body(await request.body())
    channel_id = str(body.get("channel_id") or "").strip()
    if not channel_id:
        return JSONResponse({"ok": False, "error": "channel_id_required"}, status_code=400)

    from api.profiles import _DEFAULT_HERMES_HOME

    config_path = _DEFAULT_HERMES_HOME / "config.yaml"
    if not config_path.exists():
        return JSONResponse({"ok": False, "error": "config_not_found"}, status_code=404)

    cfg: dict = {}
    try:
        loaded = _yaml.safe_load(config_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            cfg = loaded
    except Exception:
        return JSONResponse({"ok": False, "error": "config_parse_error"}, status_code=500)

    platforms_cfg = cfg.get("platforms", {})
    if not isinstance(platforms_cfg, dict):
        platforms_cfg = {}
        cfg["platforms"] = platforms_cfg

    if channel_id in platforms_cfg:
        target = platforms_cfg[channel_id]
    elif channel_id in cfg and isinstance(cfg[channel_id], dict):
        target = cfg[channel_id]
    else:
        target = platforms_cfg.get(channel_id, {})

    if "enabled" in body:
        target["enabled"] = bool(body["enabled"])

    if "token" in body:
        token = str(body["token"] or "").strip()
        if token:
            target["token"] = token
        else:
            target.pop("token", None)
    if "api_key" in body:
        k = str(body["api_key"] or "").strip()
        if k:
            target["api_key"] = k
        else:
            target.pop("api_key", None)

    extra = body.get("extra")
    if isinstance(extra, dict):
        existing_extra = target.get("extra", {})
        if not isinstance(existing_extra, dict):
            existing_extra = {}
        for ek, ev in extra.items():
            val = str(ev or "").strip()
            if val:
                existing_extra[ek] = val
            else:
                existing_extra.pop(ek, None)
        if existing_extra:
            target["extra"] = existing_extra
        else:
            target.pop("extra", None)

    if channel_id in platforms_cfg or channel_id not in cfg:
        platforms_cfg[channel_id] = target
        cfg["platforms"] = platforms_cfg
    else:
        cfg[channel_id] = target

    try:
        config_path.write_text(
            _yaml.dump(cfg, default_flow_style=False, allow_unicode=True),
            encoding="utf-8",
        )
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)

    from api.config import reload_config
    reload_config()

    return JSONResponse({"ok": True, "channel_id": channel_id})
