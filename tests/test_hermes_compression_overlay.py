import os

from api.hermes_compression_overlay import (
    apply_bungalow_context_compression_overlay,
    bungalow_compression_overlay_active,
)


def test_overlay_forces_enabled(monkeypatch):
    monkeypatch.delenv("HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION", raising=False)
    c = apply_bungalow_context_compression_overlay({"compression": {"enabled": False, "threshold": 0.44}})
    assert c["compression"]["enabled"] is True
    assert c["compression"]["threshold"] == 0.44
    assert c["context"]["engine"] == "compressor"


def test_overlay_respects_explicit_engine(monkeypatch):
    monkeypatch.delenv("HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION", raising=False)
    c = apply_bungalow_context_compression_overlay({"context": {"engine": "lcm"}})
    assert c["context"]["engine"] == "lcm"


def test_overlay_disabled_env(monkeypatch):
    monkeypatch.setenv("HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION", "1")
    assert bungalow_compression_overlay_active() is False
    c = apply_bungalow_context_compression_overlay({"compression": {"enabled": False}})
    assert c["compression"]["enabled"] is False


def test_threshold_env(monkeypatch):
    monkeypatch.delenv("HERMES_BUNGALOW_DISABLE_CONTEXT_COMPRESSION", raising=False)
    monkeypatch.setenv("HERMES_BUNGALOW_COMPRESSION_THRESHOLD", "0.33")
    c = apply_bungalow_context_compression_overlay({})
    assert c["compression"]["threshold"] == 0.33
    monkeypatch.delenv("HERMES_BUNGALOW_COMPRESSION_THRESHOLD", raising=False)
