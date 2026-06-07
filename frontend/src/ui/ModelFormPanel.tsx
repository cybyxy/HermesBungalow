import { useEffect, useState } from 'react';
import * as gameApi from '../services/gameApi';
import { colors } from './theme';

interface ProviderProfile {
  id: string;
  display_name: string;
  base_url: string;
  description: string;
  api_mode: string;
}

interface ModelEntry {
  id: string;
  label: string;
}

interface ModelFormPanelProps {
  providerId?: string;
  onClose: () => void;
}

export function ModelFormPanel({ providerId, onClose }: ModelFormPanelProps) {
  const isEdit = !!providerId;

  const [name, setName] = useState('');
  const [api, setApi] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [transport, setTransport] = useState('anthropic_messages');
  const [keyEnv, setKeyEnv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ── 厂商下拉 ──
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [vendorCustom, setVendorCustom] = useState(false);

  // ── 模型下拉 ──
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // 加载厂商列表
  useEffect(() => {
    void gameApi.fetchProviderProfiles().then((r) => {
      setProfiles(r.profiles || []);
    }).catch(() => {});
  }, []);

  // 编辑模式：加载已有值
  useEffect(() => {
    if (!isEdit) return;
    void (async () => {
      try {
        const c = await gameApi.fetchModelConfig();
        const p = (c.providers ?? {})[providerId!];
        if (p) {
          setName(p.name || '');
          setApi(p.api || '');
          setDefaultModel(p.default_model || '');
          setTransport(p.transport || 'anthropic_messages');
          setKeyEnv(p.key_env || '');

          // 尝试匹配已知厂商
          const normalized = (p.api || '').trim().toLowerCase();
          const matched = profiles.find((pf) =>
            pf.base_url.toLowerCase() === normalized ||
            (pf.base_url.toLowerCase() + '/v1') === normalized ||
            pf.base_url.toLowerCase() === normalized.replace(/\/v1\/?$/, ''),
          );
          if (matched) {
            setSelectedVendor(matched.id);
          } else {
            setSelectedVendor('__custom__');
            setVendorCustom(true);
          }
        }
      } catch { /* ignore */ }
    })();
  }, [isEdit, providerId, profiles]);

  const handleVendorChange = (vendorId: string) => {
    setSelectedVendor(vendorId);
    if (vendorId === '__custom__') {
      setVendorCustom(true);
      setApi('');
      if (!isEdit) {
        setName('');
      }
    } else {
      setVendorCustom(false);
      const profile = profiles.find((p) => p.id === vendorId);
      if (profile) {
        setApi(profile.base_url);
        setTransport(profile.api_mode || 'anthropic_messages');
        if (!isEdit) {
          setName(profile.id);
        }
      }
      // 清空已加载的模型列表
      setModels([]);
    }
  };

  const handleFetchModels = async () => {
    if (!api.trim()) return;
    setFetchingModels(true);
    setError('');
    try {
      const r = await gameApi.fetchRemoteModels(api.trim(), keyEnv.trim());
      if (r.ok) {
        const modelList = r.models || [];
        setModels(modelList);
        // 预存模型列表到 provider 配置，避免 agent 选模型时重复拉取
        const modelIds = modelList.map(m => m.id);
        const pid = isEdit ? providerId! : (name.trim().toLowerCase() || 'custom');
        try {
          await gameApi.saveModelProvider({
            action: 'add',
            provider_id: pid,
            name: name.trim() || pid,
            api: api.trim(),
            transport: transport.trim() || 'anthropic_messages',
            default_model: defaultModel.trim(),
            key_env: keyEnv.trim(),
            cached_models: modelIds,
          });
        } catch { /* save models silently */ }
      } else {
        setError(r.error || '获取模型列表失败');
      }
    } catch {
      setError('获取模型列表异常');
    }
    setFetchingModels(false);
  };

  const onSubmit = async () => {
    if (!api.trim()) { setError('API URL 不能为空'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await gameApi.saveModelProvider({
        action: isEdit ? 'add' : 'add',
        provider_id: isEdit ? providerId! : name.trim().toLowerCase() || 'custom',
        name: name.trim() || (isEdit ? providerId! : 'custom'),
        api: api.trim(),
        transport: transport.trim() || 'anthropic_messages',
        default_model: defaultModel.trim(),
        key_env: keyEnv.trim(),
      });
      if (r.ok) { onClose(); }
      else setError(r.error || '保存失败');
    } catch { setError('请求异常'); }
    setBusy(false);
  };

  const input: React.CSSProperties = {
    width: '100%', padding: '6px 8px', background: '#0a0a15', color: '#fff',
    border: `1px solid ${colors.border}`, borderRadius: 4, boxSizing: 'border-box',
    fontSize: 12, fontFamily: 'monospace',
  };

  const select: React.CSSProperties = {
    ...input, cursor: 'pointer', appearance: 'auto',
  };

  const label = (text: string) => (
    <div style={{ color: colors.text, fontSize: 11, marginBottom: 3 }}>{text}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── 选择厂商 ── */}
      <div>
        {label('选择厂商')}
        <select value={selectedVendor} onChange={(e) => handleVendorChange(e.target.value)}
          style={select}>
          <option value="">-- 请选择 --</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name || p.id}</option>
          ))}
          <option value="__custom__">自定义...</option>
        </select>
      </div>

      {isEdit && (
        <div>
          {label('Provider ID')}
          <div style={{ color: '#888', fontSize: 12, padding: '6px 0' }}>{providerId}</div>
        </div>
      )}

      {!isEdit && vendorCustom && (
        <div>
          {label('Provider ID *')}
          <input value={name} onChange={e => setName(e.target.value)}
            style={input} placeholder="如 my-provider" autoFocus />
          <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
            作为唯一标识，保存后不可修改
          </div>
        </div>
      )}

      <div>
        {label('显示名称')}
        <input value={name} onChange={e => setName(e.target.value)}
          style={input} placeholder="如 Agnes AI" />
      </div>

      {/* ── API URL ── */}
      <div>
        {label('API URL *')}
        <input value={api} onChange={e => { setApi(e.target.value); setModels([]); }}
          style={input} placeholder="https://api.example.com/v1" />
      </div>

      {/* ── API Key ── */}
      <div>
        {label('API Key 环境变量')}
        <input value={keyEnv} onChange={e => setKeyEnv(e.target.value)}
          style={input} placeholder="如 AGNES_API_KEY" />
        <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>key 需在 ~/.hermes/.env 中配置</div>
      </div>

      {/* ── 获取模型列表 ── */}
      {api.trim() && (
        <div>
          <button onClick={() => void handleFetchModels()} disabled={fetchingModels}
            style={{
              padding: '5px 14px',
              background: fetchingModels ? '#333' : 'transparent',
              color: fetchingModels ? '#888' : colors.gold,
              border: `1px solid ${colors.gold}`,
              borderRadius: 4, cursor: fetchingModels ? 'not-allowed' : 'pointer',
              fontSize: 11,
            }}>
            {fetchingModels ? '获取中…' : '获取模型列表'}
          </button>
        </div>
      )}

      {/* ── Transport ── */}
      <div>
        {label('Transport')}
        <select value={transport} onChange={e => setTransport(e.target.value)}
          style={select}>
          <option value="chat_completions">chat_completions (OpenAI / Ollama / vLLM)</option>
          <option value="anthropic_messages">anthropic_messages (Claude / MiniMax)</option>
          <option value="codex_responses">codex_responses (Codex / Agnes Video)</option>
          <option value="bedrock_converse">bedrock_converse (AWS Bedrock)</option>
          <option value="codex_app_server">codex_app_server</option>
        </select>
      </div>

      {/* ── 模型名称下拉 ── */}
      {models.length > 0 && (
        <div>
          {label('默认模型')}
          <select value={defaultModel} onChange={e => setDefaultModel(e.target.value)}
            style={select}>
            <option value="">-- 请选择 --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label || m.id}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── 手动输入模型（无模型列表时） ── */}
      {models.length === 0 && (
        <div>
          {label('默认模型')}
          <input value={defaultModel} onChange={e => setDefaultModel(e.target.value)}
            style={input} placeholder="model-id" />
        </div>
      )}

      {error && (
        <div style={{ color: '#f66', fontSize: 11, padding: '4px 8px', background: 'rgba(255,80,80,0.1)', borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '6px 16px', background: 'transparent', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>取消</button>
        <button onClick={() => void onSubmit()} disabled={busy}
          style={{ padding: '6px 20px', background: busy ? '#333' : colors.gold, color: busy ? '#888' : '#000', border: 'none', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600 }}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
