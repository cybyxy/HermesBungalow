import type { Agent } from '../types/game';
import type { ModelOption } from '../store/taskStore';
import type { ChannelOption } from '../services/gameApi';
import * as gameApi from '../services/gameApi';
import { colors, studioGlass } from './theme';
import { AgentAvatar } from './AgentAvatar';
import { genderEmoji, genderTitle } from './genderUtils';

export function AgentProfileSidebar(props: {
  agent: Agent;
  modelOptions: ModelOption[];
  channelOptions: ChannelOption[];
  editName: string | null;
  setEditName: (v: string) => void;
  editProf: string | null;
  setEditProf: (v: string) => void;
  onProfileUpdated?: () => void;
}) {
  const { agent, modelOptions, channelOptions, editName, setEditName, editProf, setEditProf, onProfileUpdated } = props;

  return (
    <div
      style={{
        ...studioGlass.muted,
        borderRadius: 8,
        padding: 12,
        border: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ position: 'relative', width: 56, height: 56, margin: '0 auto 8px', flexShrink: 0 }}>
        <AgentAvatar agent={agent} size={56} />
        <span
          title={genderTitle(agent.gender)}
          style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 13, lineHeight: 1 }}
        >
          {genderEmoji(agent.gender)}
        </span>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 2 }}>
        <input
          type="text"
          value={editName ?? (agent.display_name || agent.name)}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={() => {
            const v = (editName ?? '').trim();
            if (v && v !== agent.display_name) {
              void gameApi.updateAgentConfig({ id: agent.id, display_name: v }).then(() => {
                onProfileUpdated?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (editName ?? '').trim();
              if (v && v !== agent.display_name) {
                void gameApi.updateAgentConfig({ id: agent.id, display_name: v }).then(() => {
                  onProfileUpdated?.();
                });
              }
            }
          }}
          style={{
            ...studioGlass.inset,
            color: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 'bold',
            padding: '3px 6px',
            fontFamily: 'inherit',
            textAlign: 'center',
            width: '100%',
            boxSizing: 'border-box',
          }}
          title="修改后按 Enter 或点击外部即保存"
        />
      </div>
      <div style={{ textAlign: 'center', color: '#555', fontSize: 9 }}>@{agent.display_name || agent.name}</div>
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <input
          type="text"
          value={editProf ?? agent.profession ?? ''}
          onChange={(e) => setEditProf(e.target.value)}
          onBlur={() => {
            const v = (editProf ?? '').trim();
            if (v && v !== agent.profession) {
              void gameApi.updateAgentConfig({ id: agent.id, profession: v }).then(() => {
                onProfileUpdated?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (editProf ?? '').trim();
              if (v && v !== agent.profession) {
                void gameApi.updateAgentConfig({ id: agent.id, profession: v }).then(() => {
                  onProfileUpdated?.();
                });
              }
            }
          }}
          style={{
            ...studioGlass.inset,
            color: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            fontSize: 11,
            padding: '3px 6px',
            fontFamily: 'inherit',
            textAlign: 'center',
            width: '100%',
            boxSizing: 'border-box',
          }}
          title="修改后按 Enter 或点击外部即保存"
        />
      </div>
      <div
        style={{
          marginTop: 8,
          ...studioGlass.inset,
          borderRadius: 6,
          padding: 6,
          fontSize: 10,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#aaa' }}>Profile</span>
          <span style={{ color: '#bbb' }}>{agent.profile || 'default'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
          <span style={{ color: '#aaa' }}>模型</span>
          <select
            value={agent.reasoning_model ?? 'auto'}
            onChange={(e) => {
              void gameApi.updateAgentConfig({ id: agent.id, reasoning_model: e.target.value }).then(() => {
                onProfileUpdated?.();
              });
            }}
            style={{
              ...studioGlass.inset,
              color: '#87CEEB',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              fontSize: 9,
              padding: '2px 2px',
              cursor: 'pointer',
              maxWidth: 110,
            }}
          >
            {(() => {
              const cur = agent.reasoning_model ?? 'auto';
              const inList = modelOptions.some((o) => o.value === cur);
              if (!inList && cur) {
                return <option value={cur}>{cur}</option>;
              }
              return null;
            })()}
            {modelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.providerLabel ? `${o.providerLabel} / ${o.label}` : o.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
          <span style={{ color: '#aaa' }}>渠道</span>
          <select
            value={agent.channel ?? ''}
            onChange={(e) => {
              void gameApi.updateAgentConfig({ id: agent.id, channel: e.target.value }).then(() => {
                onProfileUpdated?.();
              });
            }}
            style={{
              ...studioGlass.inset,
              color: '#87CEEB',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              fontSize: 9,
              padding: '2px 2px',
              cursor: 'pointer',
              maxWidth: 110,
            }}
          >
            {channelOptions.map((o) => (
              <option key={o.channel_id} value={o.channel_id}>
                {o.channel_label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
