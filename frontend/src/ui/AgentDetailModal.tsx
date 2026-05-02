import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import * as gameApi from '../services/gameApi';
import { statusColor, statusLabelCn, taskStatusLabelCn } from './theme';
import { Modal } from './Modal';

type DetailTab = 'basic' | 'config' | 'skill' | 'task' | 'achieve' | 'relation';

export function AgentDetailModal(props: {
  open: boolean;
  snapshot: GameWorldSnapshot | null;
  agentId: string | null;
  onClose: () => void;
  onProfileUpdated?: () => void;
}) {
  const { open, snapshot, agentId, onClose, onProfileUpdated } = props;
  const [tab, setTab] = useState<DetailTab>('basic');
  const [soulText, setSoulText] = useState('');
  const [memoryText, setMemoryText] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);

  const agent = useMemo(
    () => snapshot?.agents.find((a) => a.id === agentId) ?? null,
    [snapshot, agentId],
  );
  const tasks = useMemo(
    () => (snapshot?.tasks ?? []).filter((t) => t.assignee_id === agent?.id),
    [snapshot, agent?.id],
  );

  useEffect(() => {
    if (!open || tab !== 'config' || !agent?.id) return;
    let cancelled = false;
    setCfgBusy(true);
    setCfgMsg(null);
    void (async () => {
      try {
        const data = await gameApi.getAgentProfileFiles(agent.id);
        if (!cancelled) {
          setSoulText(data.soul ?? '');
          setMemoryText(data.memory ?? '');
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
  }, [open, tab, agent?.id]);

  if (!agent) return null;

  const moodColor =
    (agent.mood ?? 0) >= 80 ? '#90EE90' : (agent.mood ?? 0) >= 60 ? '#98FB98' : (agent.mood ?? 0) >= 40 ? '#FFD700' : '#FF6347';

  const stat = (label: string, value: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
      <div style={{ width: 54, color: '#888', fontSize: 11 }}>{label}</div>
      <div style={{ flex: 1, height: 8, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
      </div>
      <div style={{ width: 34, color, fontSize: 10, textAlign: 'right' }}>{Math.round(value)}</div>
    </div>
  );

  return (
    <Modal title="👥 Agent详情" open={open} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, minHeight: 240 }}>
        <div style={{ background: '#252540', borderRadius: 8, padding: 14 }}>
          <div style={{ width: 68, height: 68, borderRadius: 34, background: '#4169E1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#fff', fontSize: 26 }}>
            {(agent.name && agent.name[0]) || '?'}
          </div>
          <div style={{ textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: 'bold' }}>{agent.name}</div>
          <div style={{ textAlign: 'center', color: '#888', fontSize: 11, marginTop: 4 }}>👤 {agent.profession}</div>
          <div style={{ marginTop: 10, background: '#1a1a30', borderRadius: 6, padding: 8, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#aaa' }}>状态</span>
              <span style={{ color: statusColor(agent.status) }}>{statusLabelCn(agent.status)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: '#aaa' }}>位置</span>
              <span style={{ color: '#87CEEB' }}>{agent.location || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: '#aaa' }}>Profile</span>
              <span style={{ color: '#bbb' }}>{agent.profile || 'default'}</span>
            </div>
          </div>
        </div>

        <div style={{ background: '#1a1a30', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #333', overflowX: 'auto' }}>
            {[
              ['basic', '📋 基本'],
              ['config', '⚙️ 配置'],
              ['skill', '⭐ 技能'],
              ['task', '📋 任务'],
              ['achieve', '🏆 成就'],
              ['relation', '❤️ 关系'],
            ].map(([k, label]) => {
              const active = tab === (k as DetailTab);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k as DetailTab)}
                  style={{
                    padding: '10px 12px',
                    border: 'none',
                    background: active ? '#252540' : 'transparent',
                    color: active ? '#FFD700' : '#888',
                    borderBottom: active ? '2px solid #FFD700' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {tab === 'basic' && (
              <div>
                {stat('能量', agent.energy ?? 0, '#228B22')}
                {stat('情绪', agent.mood ?? 0, moodColor)}
                {stat('专注', agent.focus ?? 80, '#4169E1')}
                {stat('睡意', agent.sleepiness ?? 10, '#8B4513')}
                {stat('饱食', agent.satiety ?? 80, '#FF8C00')}
                <div style={{ marginTop: 12, background: '#0a0a15', borderRadius: 6, padding: 10 }}>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 4 }}>💬 口头禅</div>
                  <div style={{ color: '#fff', fontSize: 12 }}>{agent.catchphrase || '暂无口头禅'}</div>
                </div>
                <div style={{ marginTop: 10, background: '#0a0a15', borderRadius: 6, padding: 10 }}>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 4 }}>🧠 性格特点</div>
                  <div style={{ color: '#aaa', fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                    {agent.personality || '暂无描述'}
                  </div>
                </div>
                {(agent.memes ?? []).length > 0 && (
                  <div style={{ marginTop: 10, background: '#0a0a15', borderRadius: 6, padding: 10 }}>
                    <div style={{ color: '#666', fontSize: 10, marginBottom: 6 }}>🎭 梗语</div>
                    <div style={{ color: '#ccc', fontSize: 11, lineHeight: 1.6 }}>
                      {(agent.memes ?? []).map((m, i) => (
                        <div key={i} style={{ marginBottom: i < (agent.memes?.length ?? 0) - 1 ? 4 : 0 }}>
                          · {m}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'config' && (
              <div style={{ color: '#aaa', fontSize: 11, lineHeight: 1.5 }}>
                <div style={{ marginBottom: 8 }}>Profile: {agent.profile || 'default'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>soul.md</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setCfgBusy(true);
                            setCfgMsg(null);
                            void gameApi
                              .saveAgentProfileFiles({ agent_id: agent.id, reset_soul: true })
                              .then(() => {
                                return gameApi.getAgentProfileFiles(agent.id);
                              })
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
                    <textarea
                      value={soulText}
                      onChange={(e) => setSoulText(e.target.value)}
                      rows={10}
                      style={taStyle}
                      disabled={cfgBusy}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span>memory.md</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            const blob = new Blob([memoryText], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'memory.md';
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          style={miniBtn}
                          disabled={cfgBusy}
                        >
                          导出
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCfgBusy(true);
                            setCfgMsg(null);
                            void gameApi
                              .saveAgentProfileFiles({ agent_id: agent.id, memory: memoryText })
                              .then(() => setCfgMsg('已保存 memory.md'))
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
                    <textarea
                      value={memoryText}
                      onChange={(e) => setMemoryText(e.target.value)}
                      rows={10}
                      style={taStyle}
                      disabled={cfgBusy}
                    />
                  </div>
                </div>
                {cfgMsg && <div style={{ marginTop: 6, color: cfgMsg.includes('已') ? '#90EE90' : '#ff6b6b' }}>{cfgMsg}</div>}
              </div>
            )}

            {tab === 'skill' && <div style={{ color: '#888', fontSize: 12 }}>技能面板占位（后续接 Hermes 技能列表）。</div>}

            {tab === 'task' && (
              <div>
                {tasks.length === 0 && <div style={{ color: '#888', fontSize: 12 }}>当前无分配任务</div>}
                {tasks.map((t) => {
                  const st = taskStatusLabelCn(t.status);
                  return (
                    <div key={t.id} style={{ background: '#0a0a15', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ color: '#fff', fontSize: 12 }}>{t.name}</span>
                        <span style={{ color: st.color, fontSize: 10 }}>{st.text}</span>
                      </div>
                      <div style={{ height: 6, background: '#333', borderRadius: 3 }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, t.progress))}%`, height: '100%', background: '#FFD700', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'achieve' && <div style={{ color: '#888', fontSize: 12 }}>成就面板占位（后续接成就系统）。</div>}

            {tab === 'relation' && (
              <div style={{ color: '#aaa', fontSize: 12 }}>
                <div style={{ marginBottom: 8 }}>❤️ 与城主好感：{agent.affection ?? 0}</div>
                <div style={{ marginBottom: 8 }}>🤝 与同伴关系：{agent.relation ?? 0}</div>
                <div style={{ color: '#666', fontSize: 10 }}>最近互动记录将接入 event_log。</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const taStyle: CSSProperties = {
  width: '100%',
  background: '#0a0a15',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 6,
  padding: '8px 10px',
  boxSizing: 'border-box',
  resize: 'vertical',
  fontSize: 11,
  fontFamily: 'Consolas, "Microsoft YaHei", monospace',
  lineHeight: 1.4,
};

const miniBtn: CSSProperties = {
  background: '#333',
  color: '#888',
  border: 'none',
  padding: '2px 8px',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
