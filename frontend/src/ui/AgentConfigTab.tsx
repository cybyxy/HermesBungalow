import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Agent } from '../types/game';
import * as gameApi from '../services/gameApi';
import { colors, studioGlass } from './theme';

const taStyle: CSSProperties = {
  width: '100%',
  ...studioGlass.inset,
  color: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: '6px 8px',
  boxSizing: 'border-box',
  resize: 'vertical',
  fontSize: 10,
  fontFamily: 'Consolas, "Microsoft YaHei", monospace',
  lineHeight: 1.35,
};

const miniBtn: CSSProperties = {
  background: colors.btn,
  color: '#888',
  border: 'none',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 9,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export function AgentConfigTab(props: { agent: Agent; onProfileUpdated?: () => void }) {
  const { agent, onProfileUpdated } = props;
  const [soulText, setSoulText] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);

  // Fetch profile files when agent.id changes
  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    setCfgBusy(true);
    setCfgMsg(null);
    void (async () => {
      try {
        const data = await gameApi.getAgentProfileFiles(agent.id);
        if (!cancelled) {
          setSoulText(data.soul ?? '');
        }
      } catch (e) {
        if (!cancelled) setCfgMsg((e as Error).message);
      } finally {
        if (!cancelled) setCfgBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent?.id]);

  return (
    <div style={{ color: '#aaa', fontSize: 10, lineHeight: 1.45 }}>
      <div style={{ marginBottom: 6 }}>Profile: {agent.profile || 'default'}</div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>soul.md</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => {
                setCfgBusy(true);
                setCfgMsg(null);
                void gameApi
                  .saveAgentProfileFiles({ agent_id: agent.id, reset_soul: true })
                  .then(() => gameApi.getAgentProfileFiles(agent.id))
                  .then((d) => {
                    setSoulText(d.soul ?? '');
                    setCfgMsg('已重置 soul.md');
                    onProfileUpdated?.();
                  })
                  .catch((e) => setCfgMsg((e as Error).message))
                  .finally(() => setCfgBusy(false));
              }}
              style={miniBtn}
              disabled={cfgBusy}
            >
              重置
            </button>
            <button
              type="button"
              onClick={() => {
                setCfgBusy(true);
                setCfgMsg(null);
                void gameApi
                  .saveAgentProfileFiles({ agent_id: agent.id, soul: soulText })
                  .then(() => {
                    setCfgMsg('已保存 soul.md');
                    onProfileUpdated?.();
                  })
                  .catch((e) => setCfgMsg((e as Error).message))
                  .finally(() => setCfgBusy(false));
              }}
              style={{ ...miniBtn, color: '#fff', background: '#2a5a2a' }}
              disabled={cfgBusy}
            >
              保存
            </button>
          </div>
        </div>
        <textarea value={soulText} onChange={(e) => setSoulText(e.target.value)} rows={12} style={taStyle} disabled={cfgBusy} />
      </div>
      {cfgMsg && <div style={{ marginTop: 6, color: cfgMsg.includes('已') ? '#90EE90' : '#ff6b6b' }}>{cfgMsg}</div>}
    </div>
  );
}
