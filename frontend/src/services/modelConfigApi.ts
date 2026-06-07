import { JSON_HDR, parseJson } from './gameApi';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ModelConfigData {
  model: {
    default?: string;
    provider?: string;
    base_url?: string;
  };
  providers: Record<string, {
    name?: string;
    api?: string;
    transport?: string;
    default_model?: string;
    key_env?: string;
  }>;
  active_profile?: string;
}

export interface ChannelOption {
  channel_id: string;
  channel_label: string;
  connected: boolean;
}

// ── Functions ──────────────────────────────────────────────────────────────

export async function fetchModelConfig(): Promise<ModelConfigData> {
  const res = await fetch('/api/task/model-config');
  return parseJson(res);
}

export async function updateModelConfig(payload: {
  default?: string;
  provider?: string;
  base_url?: string;
}): Promise<{ ok: boolean; model?: Record<string, string>; error?: string }> {
  const res = await fetch('/api/task/model-config', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function fetchProviders(): Promise<{
  providers: Array<{
    id: string;
    display_name: string;
    has_key: boolean;
    configurable: boolean;
    key_source: string;
    models: Array<{ id: string; label: string }>;
  }>;
}> {
  const res = await fetch('/api/providers');
  return parseJson(res);
}

export async function fetchProviderProfiles(): Promise<{
  profiles: Array<{
    id: string;
    display_name: string;
    base_url: string;
    description: string;
    api_mode: string;
  }>;
}> {
  const res = await fetch('/api/task/provider-profiles');
  return parseJson(res);
}

export async function fetchConfiguredModels(): Promise<{
  models: Array<{
    provider_id: string;
    provider_label: string;
    model_id: string;
    model_label: string;
  }>;
}> {
  const res = await fetch('/api/task/configured-models');
  return parseJson(res);
}

export async function fetchConfiguredChannels(): Promise<{
  channels: ChannelOption[];
}> {
  const res = await fetch('/api/task/configured-channels');
  return parseJson(res);
}

export async function postChannelConfig(payload: {
  channel_id: string;
  enabled?: boolean;
  token?: string;
  api_key?: string;
  extra?: Record<string, string>;
}): Promise<{ ok: boolean; channel_id?: string; error?: string }> {
  const res = await fetch('/api/task/channel-config', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; channel_id?: string; error?: string }>(res);
}

export async function fetchRemoteModels(baseUrl: string, apiKey: string): Promise<{
  ok: boolean;
  models: Array<{ id: string; label: string }>;
  error?: string;
}> {
  const res = await fetch('/api/task/models/fetch', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
  });
  return parseJson(res);
}

export async function fetchModels(): Promise<{
  active_provider: string;
  default_model: string;
  groups: Array<{
    provider: string;
    provider_id: string;
    models: Array<{ id: string; label: string }>;
  }>;
}> {
  const res = await fetch('/api/models');
  return parseJson(res);
}

export async function saveModelProvider(payload: {
  action?: 'add' | 'delete';
  provider_id: string;
  name?: string;
  api?: string;
  transport?: string;
  default_model?: string;
  key_env?: string;
  cached_models?: string[];
}): Promise<{ ok: boolean; providers?: string[]; error?: string }> {
  const res = await fetch('/api/task/model-config/provider', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}
