import { useCallback, useEffect, useState } from 'react';
import * as gameApi from '../services/gameApi';
import type { ModelConfigData } from '../services/gameApi';
import { useUiStore } from '../store/uiStore';
import { colors } from './theme';

const cardBorder = `1px solid ${colors.border}`;

export function ModelListPanel() {
  const [config, setConfig] = useState<ModelConfigData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);

  const loadConfig = useCallback(async () => {
    try { setConfig(await gameApi.fetchModelConfig()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const onDelete = async (id: string) => {
    if (config?.model?.provider === id) return; // 默认模型不可删除
    if (!window.confirm(`确定删除 "${id}"？`)) return;
    setBusy(id);
    try {
      await gameApi.saveModelProvider({ action: 'delete', provider_id: id });
      void loadConfig();
    } catch { /* ignore */ }
    setBusy(null);
  };

  const onSetDefault = async (id: string) => {
    setBusy(id);
    try {
      await gameApi.updateModelConfig({ provider: id });
      void loadConfig();
    } catch { /* ignore */ }
    setBusy(null);
  };

  const providers = Object.entries(config?.providers ?? {});

  const hostname = (url: string) => {
    try { return new URL(url).hostname; } catch { return url || ''; }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 360, overflowY: 'auto', alignContent: 'flex-start' }}>
      {/* 添加卡片 */}
      <div
        onClick={() => openFloatingWindow({ kind: 'addModel' })}
        style={{
          width: 220, padding: '12px', borderRadius: 6, cursor: 'pointer',
          border: `1px dashed ${colors.gold}`,
          background: 'rgba(255,215,0,0.03)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: colors.gold, fontSize: 13, flex: '0 0 auto',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
        <span>添加模型</span>
      </div>

      {providers.length === 0 && (
        <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 16, width: '100%' }}>暂无 Provider</div>
      )}

      {providers.map(([id, p]) => {
        const isActive = config?.model?.provider === id;
        return (
          <div
            key={id}
            style={{
              width: 240, flex: '0 0 auto',
              padding: '12px', borderRadius: 6,
              background: isActive ? '#0a0a18' : '#0d0d20',
              border: isActive ? `1px solid ${colors.gold}` : cardBorder,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {/* 第一行：名称 + 状态标签 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                onClick={() => openFloatingWindow({ kind: 'modelDetail', providerId: id })}
                style={{ color: colors.bright, fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1 }}
              >
                {p.name || id}
              </span>
              {isActive && (
                <span style={{ color: colors.gold, fontSize: 9, background: 'rgba(255,215,0,0.15)', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                  当前
                </span>
              )}
            </div>

            {/* 第二行：hostname + 默认模型 */}
            <div style={{ fontSize: 10, color: '#888', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {p.api && <span>{hostname(p.api)}</span>}
              {p.default_model && <span>默认: {p.default_model}</span>}
            </div>

            {/* 第三行：操作按钮 */}
            <div style={{ display: 'flex', gap: 4 }}>
              {!isActive && (
                <button
                  onClick={() => void onSetDefault(id)} disabled={busy === id}
                  style={{
                    padding: '2px 8px', background: 'transparent', color: colors.gold,
                    border: `1px solid ${colors.gold}33`, borderRadius: 3,
                    cursor: busy === id ? 'not-allowed' : 'pointer', fontSize: 10,
                    opacity: busy === id ? 0.5 : 1,
                  }}
                >设为默认</button>
              )}
              <button
                onClick={() => void onDelete(id)} disabled={busy === id || isActive}
                style={{
                  padding: '2px 8px', background: 'transparent', color: isActive ? '#666' : '#f66',
                  border: `1px solid ${isActive ? '#333' : '#441111'}`, borderRadius: 3,
                  cursor: (busy === id || isActive) ? 'not-allowed' : 'pointer', fontSize: 10,
                }}
              >删除</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
