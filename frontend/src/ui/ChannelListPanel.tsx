import { useCallback, useEffect, useState } from 'react';
import * as gameApi from '../services/gameApi';
import type { ChannelOption } from '../services/gameApi';
import { useUiStore } from '../store/uiStore';
import { colors } from './theme';

export function ChannelListPanel() {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);

  const loadChannels = useCallback(async () => {
    setBusy(true);
    try {
      const data = await gameApi.fetchConfiguredChannels();
      setChannels(data.channels ?? []);
    } catch { /* ignore */ }
    setBusy(false);
  }, []);

  useEffect(() => { void loadChannels(); }, [loadChannels]);

  const configuredChannels = channels.filter((ch) => ch.connected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 360, overflowY: 'auto', alignContent: 'flex-start' }}>
        {/* 添加渠道卡片 */}
        <div
          onClick={() => openFloatingWindow({ kind: 'addChannel' })}
          style={{
            width: 240, flex: '0 0 auto',
            padding: '16px', borderRadius: 6,
            border: `1px dashed ${colors.gold}`,
            background: 'rgba(255,215,0,0.03)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: colors.gold, fontSize: 13, minHeight: 80,
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,215,0,0.07)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,215,0,0.03)'; }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
          <span>添加渠道</span>
        </div>

        {/* 已配置的渠道 */}
        {!busy && configuredChannels.length === 0 && (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 16, width: '100%' }}>
            暂无已配置的渠道，点击「添加渠道」卡片开始配置。
          </div>
        )}

        {configuredChannels.map((ch) => (
          <div
            key={ch.channel_id}
            onClick={() => openFloatingWindow({ kind: 'channelConfig', channelId: ch.channel_id })}
            style={{
              width: 240, flex: '0 0 auto',
              padding: '12px', borderRadius: 6,
              background: '#0a1a0a',
              border: `1px solid #4CAF50`,
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 6,
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7BEF80'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#4CAF50'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: colors.bright, fontSize: 13, fontWeight: 600, flex: 1 }}>
                {ch.channel_label}
              </span>
              <span
                style={{
                  color: '#4CAF50',
                  fontSize: 9,
                  background: 'rgba(76,175,80,0.15)',
                  padding: '1px 6px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                }}
              >
                已连接
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#888' }}>ID: {ch.channel_id}</div>
            <div style={{ fontSize: 10, color: '#4CAF50' }}>
              Agent 可绑定此渠道进行外部通信
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
