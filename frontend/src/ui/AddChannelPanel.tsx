import { useEffect, useState } from 'react';
import * as gameApi from '../services/gameApi';
import type { ChannelOption } from '../services/gameApi';
import { useUiStore } from '../store/uiStore';
import { colors, studioGlass } from './theme';

const CHANNEL_TYPES: Record<string, string> = {
  feishu: '飞书 (Feishu / Lark)',
  discord: 'Discord',
  slack: 'Slack',
  telegram: 'Telegram',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  dingtalk: '钉钉',
  weixin: '微信',
  qqbot: 'QQ 机器人',
  bluebubbles: 'BlueBubbles',
  wecom: '企业微信',
  wecom_callback: '企业微信回调',
  yuanbao: '元宝',
  email: 'Email',
  api_server: 'API Server',
  webhook: 'Webhook',
  google_chat: 'Google Chat',
  irc: 'IRC',
  line: 'LINE',
  simplex: 'SimpleX Chat',
  teams: 'Microsoft Teams',
};

export function AddChannelPanel(props: { onClose: () => void }) {
  const { onClose } = props;
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);

  useEffect(() => {
    void (async () => {
      try {
        const data = await gameApi.fetchConfiguredChannels();
        setChannels(data.channels ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  const availableTypes = Object.entries(CHANNEL_TYPES).filter(
    ([id]) => !channels.some((ch) => ch.channel_id === id && ch.connected),
  );

  return (
    <div style={{ padding: 0 }}>
      <div style={{ color: colors.bright, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        选择要添加的渠道类型
      </div>

      {availableTypes.length === 0 ? (
        <div style={{ color: '#666', fontSize: 12, padding: 16, textAlign: 'center' }}>
          所有渠道类型已添加。
        </div>
      ) : (
        <div
          className="rb-scroll"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {availableTypes.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onClose();
                openFloatingWindow({ kind: 'channelConfig', channelId: id });
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: studioGlass.inset.background,
                color: '#ccc',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.gold;
                e.currentTarget.style.color = colors.gold;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = '#ccc';
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
