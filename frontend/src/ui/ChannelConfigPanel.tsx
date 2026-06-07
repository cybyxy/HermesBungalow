import { useEffect, useState } from 'react';
import * as gameApi from '../services/gameApi';
import type { ChannelOption } from '../services/gameApi';
import { useTaskStore } from '../store/taskStore';
import { colors, studioGlass } from './theme';

/** Known extra field labels per channel — mirrors Hermes platform config fields */
const EXTRA_FIELDS: Record<string, Record<string, string>> = {
  feishu: {
    app_id: 'App ID（必填）',
    app_secret: 'App Secret（必填）',
    domain: 'Domain',
    connection_mode: '连接模式',
    encrypt_key: 'Encrypt Key',
    verification_token: 'Verification Token',
    webhook_host: 'Webhook Host',
    webhook_port: 'Webhook Port',
    require_mention: '需要 @提及',
    allow_bots: '机器人消息策略',
    ws_reconnect_nonce: 'WS 重连 Nonce',
    ws_reconnect_interval: 'WS 重连间隔(s)',
    ws_ping_interval: 'WS Ping 间隔(s)',
    ws_ping_timeout: 'WS Ping 超时(s)',
    group_rules: '群组路由规则',
    admins: '管理员列表',
    default_group_policy: '默认群组策略',
  },
  discord: {
    require_mention: '需要 @提及',
    thread_require_mention: '线程需要 @提及',
    auto_thread: '自动创建线程',
    reactions: '显示反应',
    history_backfill: '历史消息回填',
    history_backfill_limit: '回填消息数量上限',
    allowed_channels: '允许的频道',
    ignored_channels: '忽略的频道',
    free_response_channels: '免提及频道',
    no_thread_channels: '不自动线程的频道',
    allowed_users: '允许的用户',
    allowed_roles: '允许的角色',
    dm_role_auth_guild: 'DM 角色认证服务器 ID',
    slash_commands: '启用斜杠命令',
    allow_bots: '机器人消息策略',
    allow_mention_everyone: '允许 @everyone',
    allow_mention_roles: '允许 @role',
    allow_mention_users: '允许 @user',
    allow_mention_replied_user: '允许回复 @user',
  },
  slack: {
    app_token: 'App Token',
    require_mention: '需要 @提及',
    strict_mention: '严格提及模式',
    free_response_channels: '免提及频道',
    allowed_channels: '允许的频道',
    reactions: '显示反应',
    reply_broadcast: '广播回复到频道',
    reply_in_thread: '在线程中回复',
    dm_top_level_threads_as_sessions: 'DM 线程独立会话',
    allow_bots: '机器人消息策略',
  },
  telegram: {
    guest_mode: '访客模式',
    allowed_chats: '允许的群组 ID',
    ignored_threads: '忽略的线程 ID',
    free_response_chats: '免提及群组',
    mention_patterns: '提及匹配模式',
    fallback_ips: 'API 备用 IP（GFW）',
    reactions: '显示反应',
    base_url: 'API Base URL',
    base_file_url: '文件 Base URL',
    disable_link_previews: '禁用链接预览',
    dm_topics: 'DM 主题配置',
    group_topics: '群组论坛主题绑定',
    notifications_mode: '通知模式',
  },
  matrix: {
    password: 'Password',
    homeserver: 'Homeserver URL（必填）',
    user_id: 'Bot User ID',
    encryption: '启用 E2EE 加密',
    device_id: 'Device ID',
    require_mention: '需要 @提及',
    free_response_rooms: '免提及房间',
    allowed_rooms: '允许的房间',
    auto_thread: '自动创建线程',
    dm_mention_threads: 'DM 提及线程',
  },
  mattermost: {
    url: 'Server URL（必填）',
    reply_mode: '回复模式',
    require_mention: '需要 @提及',
    free_response_channels: '免提及频道',
    allowed_channels: '允许的频道',
  },
  whatsapp: {
    bridge_port: 'Bridge Port',
    bridge_script: 'Bridge Script 路径',
    session_path: 'Session 路径',
    reply_prefix: '回复前缀',
    require_mention: '需要 @提及',
    free_response_chats: '免提及群组',
    mention_patterns: '提及匹配模式',
    dm_policy: 'DM 策略',
    allow_from: '允许的用户',
    group_policy: '群组策略',
    group_allow_from: '允许的群组用户',
  },
  signal: {
    http_url: 'HTTP URL（必填）',
    account: 'Account（必填）',
    ignore_stories: '忽略 Story',
  },
  dingtalk: {
    client_id: 'Client ID（必填）',
    client_secret: 'Client Secret（必填）',
    robot_code: 'Robot Code',
    card_template_id: '卡片模板 ID',
    require_mention: '需要 @提及',
    free_response_chats: '免提及群组',
    allowed_chats: '允许的群组',
    mention_patterns: '提及匹配模式',
    allowed_users: '允许的用户',
  },
  weixin: {
    account_id: 'Account ID（必填）',
    base_url: 'API Base URL',
    cdn_base_url: 'CDN Base URL',
    send_chunk_delay_seconds: '分块发送延迟(s)',
    send_chunk_retries: '分块重试次数',
    dm_policy: 'DM 策略',
    group_policy: '群组策略',
    allow_from: '允许的用户',
    group_allow_from: '允许的群组用户',
    split_multiline_messages: '拆分多行消息',
  },
  qqbot: {
    app_id: 'App ID（必填）',
    client_secret: 'Client Secret（必填）',
    markdown_support: '启用 Markdown',
    dm_policy: 'DM 策略',
    allow_from: '允许的用户',
    group_policy: '群组策略',
    group_allow_from: '允许的群组用户',
  },
  bluebubbles: {
    server_url: 'Server URL（必填）',
    password: 'Password（必填）',
    webhook_host: 'Webhook Host',
    webhook_port: 'Webhook Port',
    webhook_path: 'Webhook Path',
    send_read_receipts: '发送已读回执',
  },
  wecom: {
    bot_id: 'Bot ID（必填）',
    secret: 'Secret（必填）',
    websocket_url: 'WebSocket URL',
    dm_policy: 'DM 策略',
    allow_from: '允许的用户',
    group_policy: '群组策略',
    group_allow_from: '允许的群组用户',
    groups: '群组映射',
  },
  wecom_callback: {
    corp_id: 'Corp ID（必填）',
    corp_secret: 'Corp Secret（必填）',
    agent_id: 'Agent ID',
    encoding_aes_key: 'Encoding AES Key',
    host: 'Listen Host',
    port: 'Listen Port',
    path: 'URL Path',
  },
  yuanbao: {
    app_id: 'App ID（必填）',
    app_secret: 'App Secret（必填）',
    bot_id: 'Bot ID',
    ws_url: 'WebSocket URL',
    api_domain: 'API Domain',
    route_env: 'Route Env',
    dm_policy: 'DM 策略',
    dm_allow_from: 'DM 允许用户',
    group_policy: '群组策略',
    group_allow_from: '群组允许用户',
  },
  email: {
    address: 'Address（必填）',
    password: 'Password',
    imap_host: 'IMAP Host',
    imap_port: 'IMAP Port',
    smtp_host: 'SMTP Host',
    smtp_port: 'SMTP Port',
    poll_interval: '轮询间隔(s)',
    skip_attachments: '跳过附件',
  },
  google_chat: {
    project_id: 'GCP Project ID（必填）',
    subscription_name: 'Pub/Sub 订阅路径（必填）',
    service_account_json: 'SA JSON 路径',
    allowed_users: '允许的用户',
    home_channel: 'Home Space ID',
  },
  irc: {
    server: 'IRC Server（必填）',
    channel: 'Channel（必填）',
    nickname: 'Bot 昵称（必填）',
    port: '端口',
    use_tls: '启用 TLS',
    server_password: 'Server Password',
    nickserv_password: 'NickServ Password',
    allowed_users: '允许的 nicks',
    allow_all_users: '允许所有用户',
    home_channel: 'Home Channel',
  },
  line: {
    channel_access_token: 'Channel Access Token（必填）',
    channel_secret: 'Channel Secret（必填）',
    port: 'Webhook Port',
    host: 'Webhook Host',
    public_url: 'Public HTTPS URL',
    allowed_users: '允许的用户 ID',
    allowed_groups: '允许的群组 ID',
    allowed_rooms: '允许的房间 ID',
    allow_all_users: '允许所有用户',
    home_channel: 'Home Channel ID',
    slow_response_threshold: '慢响应阈值(s)',
  },
  simplex: {
    ws_url: 'WebSocket URL（必填）',
    allowed_users: '允许的联系人 ID',
    allow_all_users: '允许所有联系人',
    home_channel: 'Home Channel ID',
    home_channel_name: 'Home Channel 名称',
  },
  teams: {
    client_id: 'Azure AD Client ID（必填）',
    client_secret: 'Client Secret（必填）',
    tenant_id: 'Azure AD Tenant ID（必填）',
    port: 'Webhook Port',
    allowed_users: '允许的用户',
    allow_all_users: '允许所有用户',
    home_channel: 'Home Channel',
    home_channel_name: 'Home Channel 名称',
  },
};

const LABELS: Record<string, string> = {
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  ...studioGlass.inset,
  color: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  fontFamily: 'Consolas, "Microsoft YaHei", monospace',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  border: 'none',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export function ChannelConfigPanel(props: { channelId: string; onClose: () => void }) {
  const { channelId, onClose } = props;
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; token: string; api_key: string; extra: Record<string, string> }>({
    enabled: true,
    token: '',
    api_key: '',
    extra: {},
  });

  const loadConfiguredChannels = useTaskStore((s) => s.loadConfiguredChannels);

  useEffect(() => {
    void (async () => {
      try {
        const data = await gameApi.fetchConfiguredChannels();
        setChannels(data.channels ?? []);
        // Pre-fill extra fields with empty strings
        const extraFields = EXTRA_FIELDS[channelId] || {};
        setForm((prev) => ({
          ...prev,
          extra: Object.fromEntries(Object.keys(extraFields).map((k) => [k, prev.extra[k] || ''])),
        }));
      } catch { /* ignore */ }
    })();
  }, [channelId]);

  const channelInfo = channels.find((c) => c.channel_id === channelId);
  const label = LABELS[channelId] || channelInfo?.channel_label || channelId;
  const extraFields = EXTRA_FIELDS[channelId] || {};

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        channel_id: channelId,
        enabled: form.enabled,
      };
      if (form.token) payload.token = form.token;
      if (form.api_key) payload.api_key = form.api_key;
      if (Object.keys(extraFields).length > 0 && Object.values(form.extra).some((v) => v)) {
        payload.extra = form.extra;
      }
      const res = await gameApi.postChannelConfig(payload as Parameters<typeof gameApi.postChannelConfig>[0]);
      if (res.ok) {
        setMsg('配置已保存。请重启后端使配置生效。');
        void loadConfiguredChannels();
      } else {
        setMsg(`保存失败: ${res.error || '未知错误'}`);
      }
    } catch (e) {
      setMsg(`保存失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: colors.bright, fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#888', fontSize: 10, marginLeft: 8 }}>ID: {channelId}</span>
        {channelInfo?.connected && (
          <span style={{ color: '#4CAF50', fontSize: 10, marginLeft: 8, background: 'rgba(76,175,80,0.15)', padding: '1px 6px', borderRadius: 3 }}>
            已连接
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Enabled toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#aaa', fontSize: 11, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          启用此渠道
        </label>

        {/* Token (for Discord/Telegram/Slack etc.) */}
        <div>
          <div style={{ color: '#aaa', fontSize: 10, marginBottom: 3 }}>Token / API Key</div>
          <input
            type="password"
            value={form.token || form.api_key || ''}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, token: v, api_key: v }));
            }}
            placeholder="输入认证 token..."
            style={inputStyle}
            disabled={busy}
          />
          <div style={{ color: '#666', fontSize: 9, marginTop: 2 }}>
            或设置环境变量 ~/.hermes/.env 中的对应 key
          </div>
        </div>

        {/* Extra fields (platform-specific) */}
        {Object.entries(extraFields).map(([key, fieldLabel]) => (
          <div key={key}>
            <div style={{ color: '#aaa', fontSize: 10, marginBottom: 3 }}>{fieldLabel}</div>
            <input
              type={key.includes('secret') || key.includes('password') ? 'password' : 'text'}
              value={form.extra[key] || ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  extra: { ...f.extra, [key]: e.target.value },
                }))
              }
              placeholder={`输入 ${fieldLabel}...`}
              style={inputStyle}
              disabled={busy}
            />
          </div>
        ))}

        {msg && (
          <div style={{ color: msg.includes('失败') ? '#ff6b6b' : '#4CAF50', fontSize: 11, padding: '6px 0' }}>
            {msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ ...btnStyle, background: '#333', color: '#aaa' }}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            style={{ ...btnStyle, background: '#2a5a2a', color: '#fff' }}
            disabled={busy}
          >
            {busy ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
