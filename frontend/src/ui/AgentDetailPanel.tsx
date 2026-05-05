import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import * as gameApi from '../services/gameApi';
import { colors, statusColor, statusLabelCn, studioGlass, taskStatusLabelCn } from './theme';
import { AgentAvatar } from './AgentAvatar';

const REASONING_MODEL_OPTIONS = [
  { value: 'auto', label: '自动选择' },
  { value: 'reasoning', label: '深度推理' },
  { value: 'balanced', label: '平衡模式' },
  { value: 'instant', label: '即时响应' },
];

type DetailTab = 'basic' | 'config' | 'skill' | 'task' | 'achieve' | 'relation';

function genderEmoji(g: string | undefined): string {
  const x = (g || '').trim().toLowerCase();
  if (x === 'female' || x === 'f' || x === '女') return '👩';
  if (x === 'male' || x === 'm' || x === '男') return '👨';
  if (x === 'random') return '🎲';
  return '⚧';
}

function genderTitle(g: string | undefined): string {
  const x = (g || '').trim().toLowerCase();
  if (x === 'female' || x === 'f' || x === '女') return '性别：女';
  if (x === 'male' || x === 'm' || x === '男') return '性别：男';
  if (x === 'random') return '性别：随机';
  return x ? `性别：${g}` : '性别：未设置';
}

export function AgentDetailPanel(props: {
  snapshot: GameWorldSnapshot | null;
  agentId: string | null;
  /** 当前是否在底部弹层中展示（用于拉取 profile 等副作用） */
  active: boolean;
  onProfileUpdated?: () => void;
}) {
  const { snapshot, agentId, active, onProfileUpdated } = props;
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
    if (!active || tab !== 'config' || !agent?.id) return;
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
  }, [active, tab, agent?.id]);

  if (!agent) {
    return <div style={{ color: '#888', fontSize: 12, padding: 8 }}>未找到该 Agent。</div>;
  }

  const moodColor =
    (agent.mood ?? 0) >= 80 ? '#90EE90' : (agent.mood ?? 0) >= 60 ? '#98FB98' : (agent.mood ?? 0) >= 40 ? '#FFD700' : '#FF6347';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 200px) minmax(0, 1fr)', gap: 12, minHeight: 200 }}>
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
        <div style={{ textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{agent.name}</div>
        <div style={{ textAlign: 'center', color: '#888', fontSize: 10, marginTop: 4 }}>👤 {agent.profession}</div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
            <span style={{ color: '#aaa' }}>推理</span>
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
                maxWidth: 100,
              }}
            >
              {REASONING_MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div
        style={{
          ...studioGlass.muted,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, overflowX: 'auto' }}>
          {(
            [
              ['basic', '📋 基本'],
              ['config', '⚙️ 配置'],
              ['skill', '⭐ 技能'],
              ['task', '📋 任务'],
              ['achieve', '🏆 成就'],
              ['relation', '❤️ 关系'],
            ] as const
          ).map(([k, label]) => {
            const act = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k as DetailTab)}
                style={{
                  padding: '8px 8px',
                  border: 'none',
                  background: act ? studioGlass.tabActive.background : 'transparent',
                  color: act ? colors.gold : '#888',
                  borderBottom: act ? `2px solid ${colors.gold}` : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {tab === 'basic' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ ...studioGlass.inset, padding: 8, borderRadius: 6, border: `1px solid ${colors.border}` }}>
                {[
                  { label: '能量', value: agent.energy ?? 0, color: '#228B22', icon: '⚡' },
                  { label: '情绪', value: agent.mood ?? 0, color: moodColor, icon: '😊' },
                  { label: '专注', value: agent.focus ?? 80, color: '#4169E1', icon: '🎯' },
                  { label: '睡意', value: agent.sleepiness ?? 10, color: '#8B4513', icon: '😴' },
                  { label: '饱食', value: agent.satiety ?? 80, color: '#FF8C00', icon: '🍽️' },
                ].map(({ label, value, color, icon }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                    <div
                      style={{
                        flex: 1,
                        height: 18,
                        ...studioGlass.inset,
                        borderRadius: 9,
                        overflow: 'hidden',
                        margin: '0 6px',
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, value))}%`,
                          height: '100%',
                          background: color,
                          borderRadius: 9,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 8,
                        }}
                      >
                        <span style={{ fontSize: 10, color: '#fff', fontWeight: 'bold' }}>{label}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color, fontWeight: 'bold', width: 36, textAlign: 'right' }}>{Math.round(value)}%</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>💬</span>
                  <div
                    style={{
                      flex: 1,
                      height: 18,
                      ...studioGlass.inset,
                      borderRadius: 9,
                      margin: '0 6px',
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{ width: '75%', height: '100%', background: '#9932CC', borderRadius: 9, paddingLeft: 8, display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#fff', fontWeight: 'bold' }}>社交</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: '#9932CC', fontWeight: 'bold', width: 36, textAlign: 'right' }}>75%</span>
                </div>
                {(() => {
                  const skill = agent.skills?.[0];
                  const name = skill?.name ?? '代码';
                  const level = skill?.level ?? 5;
                  const pct = Math.min(100, (level / 10) * 100);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>🔥</span>
                      <div
                        style={{
                          flex: 1,
                          height: 18,
                          ...studioGlass.inset,
                          borderRadius: 9,
                          margin: '0 6px',
                          border: `1px solid ${colors.border}`,
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: '#FF6347', borderRadius: 9, paddingLeft: 8, display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#fff', fontWeight: 'bold' }}>{name}</span>
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: '#FF6347', fontWeight: 'bold', width: 36, textAlign: 'right' }}>Lv.{level}</span>
                    </div>
                  );
                })()}
                {(() => {
                  const rel = agent.affection ?? 0;
                  const stage =
                    rel >= 80
                      ? { label: '挚友', color: '#FF69B4' }
                      : rel >= 55
                        ? { label: '朋友', color: '#87CEEB' }
                        : rel >= 25
                          ? { label: '认识', color: '#98FB98' }
                          : { label: '陌生', color: '#888' };
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 13, width: 24, textAlign: 'center' }}>💞</span>
                      <span style={{ fontSize: 10, color: '#666', marginLeft: 2 }}>关系</span>
                      <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: stage.color + '22', color: stage.color, fontSize: 10, fontWeight: 'bold' }}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <div
                  style={{
                    ...studioGlass.inset,
                    padding: 8,
                    borderRadius: 4,
                    marginBottom: 6,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>💬 口头禅</div>
                  <div style={{ color: '#fff', fontSize: 11, fontStyle: 'italic' }}>&quot;{agent.catchphrase || '暂无口头禅'}&quot;</div>
                </div>
                <div
                  style={{
                    ...studioGlass.inset,
                    padding: 8,
                    borderRadius: 4,
                    marginBottom: 6,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>🧠 性格</div>
                  <div style={{ color: '#aaa', fontSize: 10, lineHeight: 1.45 }}>{agent.personality || '暂无描述'}</div>
                </div>
                <div
                  style={{
                    ...studioGlass.inset,
                    padding: 8,
                    borderRadius: 4,
                    marginBottom: 6,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>🎭 梗语</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(agent.memes ?? ['暂无梗']).map((m, i) => (
                      <span key={i} style={{ background: '#2a2a40', color: '#aaa', padding: '2px 6px', borderRadius: 8, fontSize: 9 }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ ...studioGlass.inset, padding: 8, borderRadius: 4, border: `1px solid ${colors.border}` }}>
                  <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>📋 当前任务</div>
                  <div style={{ color: '#90EE90', fontSize: 11 }}>{agent.current_task_id ? `#${agent.current_task_id}` : '无'}</div>
                </div>
              </div>
            </div>
          )}

          {tab === 'config' && (
            <div style={{ color: '#aaa', fontSize: 10, lineHeight: 1.45 }}>
              <div style={{ marginBottom: 6 }}>Profile: {agent.profile || 'default'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                  <textarea value={soulText} onChange={(e) => setSoulText(e.target.value)} rows={8} style={taStyle} disabled={cfgBusy} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>memory.md</span>
                    <div style={{ display: 'flex', gap: 4 }}>
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
                  <textarea value={memoryText} onChange={(e) => setMemoryText(e.target.value)} rows={8} style={taStyle} disabled={cfgBusy} />
                </div>
              </div>
              {cfgMsg && <div style={{ marginTop: 6, color: cfgMsg.includes('已') ? '#90EE90' : '#ff6b6b' }}>{cfgMsg}</div>}
            </div>
          )}

          {tab === 'skill' && <div style={{ color: '#888', fontSize: 11 }}>技能面板占位（后续接 Hermes 技能列表）。</div>}

          {tab === 'task' && (
            <div>
              {tasks.length === 0 && <div style={{ color: '#888', fontSize: 11 }}>当前无分配任务</div>}
              {tasks.map((t) => {
                const st = taskStatusLabelCn(t.status);
                return (
                  <div
                    key={t.id}
                    style={{
                      ...studioGlass.inset,
                      borderRadius: 6,
                      padding: 8,
                      marginBottom: 6,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#fff', fontSize: 11 }}>{t.name}</span>
                      <span style={{ color: st.color, fontSize: 9 }}>{st.text}</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(26,26,46,0.85)', borderRadius: 3, border: `1px solid ${colors.border}` }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, t.progress))}%`, height: '100%', background: '#FFD700', borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'achieve' && <div style={{ color: '#888', fontSize: 11 }}>成就面板占位（后续接成就系统）。</div>}

          {tab === 'relation' && (
            <div style={{ color: '#aaa', fontSize: 11 }}>
              <div style={{ marginBottom: 6 }}>❤️ 与城主好感：{agent.affection ?? 0}</div>
              <div style={{ marginBottom: 6 }}>🤝 与同伴关系：{agent.relation ?? 0}</div>
              <div style={{ color: '#666', fontSize: 9 }}>最近互动记录将接入 event_log。</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
