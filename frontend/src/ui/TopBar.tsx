import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, GameWorldSnapshot, PeerPresetPayload } from '../types/game';
import { postPeersLeaveOutbound, postPeersVisitByPreset, putPeerPresets } from '../services/gameApi';
import { AgentAvatar } from './AgentAvatar';
import { displayAgentProfession } from './buildingLayout';
import { colors, layoutPx } from './theme';

const bar: CSSProperties = {
  height: layoutPx.topBar,
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center',
  padding: '0 16px',
  background: '#151525',
  borderBottom: `2px solid ${colors.border}`,
  gap: 8,
  overflow: 'visible',
};

export function TopBar(props: {
  snapshot: GameWorldSnapshot | null;
  gatewayStatus: string;
  loading: boolean;
  onRefresh: () => void;
  selectedAgentId: string | null;
  onOpenAgentDetail: (agentId: string) => void;
}) {
  const { snapshot, gatewayStatus, loading, onRefresh, selectedAgentId, onOpenAgentDetail } = props;
  /** 回家：选填，不填则用当前外出预设里保存的 token 做本机鉴权 */
  const [peerToken, setPeerToken] = useState('');
  /** 串门：选填，不填则用所选预设里保存的 token 做本机鉴权 */
  const [visitTokenOptional, setVisitTokenOptional] = useState('');
  const [peerBusy, setPeerBusy] = useState(false);
  const [peerHint, setPeerHint] = useState('');
  const [peerMenuOpen, setPeerMenuOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const peerWrapRef = useRef<HTMLDivElement>(null);
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [newPresetUrl, setNewPresetUrl] = useState('');
  const [newPresetToken, setNewPresetToken] = useState('');

  const closePeerMenu = useCallback(() => {
    setPeerMenuOpen(false);
  }, []);

  const activeVisit = snapshot?.active_peer_visit;
  const presets = snapshot?.peer_presets ?? [];

  useEffect(() => {
    if (selectedPresetId && !presets.some((p) => p.id === selectedPresetId)) {
      setSelectedPresetId('');
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (!peerMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = peerWrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      closePeerMenu();
    };
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [peerMenuOpen, closePeerMenu]);

  const presetsForPut = useCallback((): PeerPresetPayload[] => {
    return (snapshot?.peer_presets ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      base_url: p.base_url,
      relay_agent_id: p.relay_agent_id || undefined,
    }));
  }, [snapshot?.peer_presets]);

  const onGoHome = useCallback(async () => {
    setPeerBusy(true);
    setPeerHint('');
    try {
      const data = await postPeersLeaveOutbound(peerToken.trim() ? { peer_token: peerToken.trim() } : {});
      onRefresh();
      if (data.ok) {
        setPeerHint('');
        closePeerMenu();
      } else {
        setPeerHint(data.error ?? '离开失败');
      }
    } catch (e) {
      setPeerHint(e instanceof Error ? e.message : String(e));
    } finally {
      setPeerBusy(false);
    }
  }, [closePeerMenu, onRefresh, peerToken]);

  const onDoVisit = useCallback(async () => {
    if (!selectedPresetId) {
      setPeerHint('请在下拉框中选择串门预设');
      return;
    }
    setPeerBusy(true);
    setPeerHint('');
    try {
      const payload: { preset_id: string; peer_token?: string } = { preset_id: selectedPresetId };
      if (visitTokenOptional.trim()) payload.peer_token = visitTokenOptional.trim();
      const res = await postPeersVisitByPreset(payload);
      onRefresh();
      if (res.ok) {
        setPeerHint('');
        closePeerMenu();
      } else {
        const errLine = res.error ?? '失败';
        setPeerHint(res.hint ? `${errLine} — ${res.hint}` : errLine);
      }
    } catch (e) {
      setPeerHint(e instanceof Error ? e.message : String(e));
    } finally {
      setPeerBusy(false);
    }
  }, [closePeerMenu, onRefresh, selectedPresetId, visitTokenOptional]);

  const onAddPreset = useCallback(async () => {
    const label = newPresetLabel.trim();
    const url = newPresetUrl.trim();
    if (!label || !url) {
      setPeerHint('添加预设：填写名称与对方 base URL');
      return;
    }
    const id = `p_${Date.now().toString(36)}`;
    setPeerBusy(true);
    setPeerHint('');
    try {
      const next: PeerPresetPayload[] = [
        ...presetsForPut(),
        {
          id,
          label,
          base_url: url,
          peer_token: newPresetToken.trim() || undefined,
        },
      ];
      await putPeerPresets(next);
      setNewPresetLabel('');
      setNewPresetUrl('');
      setNewPresetToken('');
      setSelectedPresetId(id);
      onRefresh();
    } catch (e) {
      setPeerHint(e instanceof Error ? e.message : String(e));
    } finally {
      setPeerBusy(false);
    }
  }, [newPresetLabel, newPresetToken, newPresetUrl, onRefresh, presetsForPut]);

  return (
    <header style={bar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <strong style={{ color: colors.gold, fontSize: 16 }}>Hermes 数字工作室</strong>
        {snapshot && (
          <span style={{ color: colors.text, fontSize: 12 }}>
            第 {snapshot.day} 天 {snapshot.time} · 💰 {snapshot.money} · 👥 {snapshot.agents.length} · 📋 {snapshot.tasks.length}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 'max-content',
          flexShrink: 0,
          overflowX: 'auto',
          gap: 6,
          padding: '0 6px',
        }}
      >
        {snapshot?.agents.map((a: Agent) => {
          const isSel = a.id === selectedAgentId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenAgentDetail(a.id)}
              title={(() => {
                const p = displayAgentProfession(a);
                return p ? `${a.name}（${p}）` : a.name;
              })()}
              style={{
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: 20,
                outline: isSel ? `2px solid ${colors.gold}` : 'none',
                outlineOffset: 2,
                flexShrink: 0,
              }}
            >
              <AgentAvatar agent={a} size={36} />
            </button>
          );
        })}
      </div>
      <div
        style={{
          justifySelf: 'end',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          minWidth: 0,
        }}
      >
        {snapshot && (
          <span style={{ color: colors.text, fontSize: 11, textAlign: 'right' }}>
            <span style={{ color: colors.gold }}>👑 Lv.{snapshot.lord_level}</span>
            <br />
            <span style={{ fontSize: 10 }}>XP: {snapshot.lord_xp}</span>
          </span>
        )}
        <span style={{ color: '#555', fontSize: 10 }} title="开发用">
          GW:{gatewayStatus}
        </span>
        {activeVisit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch', minWidth: 120, flexShrink: 0 }}>
            <input
              type="password"
              autoComplete="off"
              placeholder="Peer token（选填，不填用预设中保存的）"
              value={peerToken}
              onChange={(e) => setPeerToken(e.target.value)}
              style={{ fontSize: 10, padding: 4, width: '100%' }}
            />
            <button
              type="button"
              disabled={peerBusy}
              onClick={() => void onGoHome()}
              style={{ fontSize: 11, padding: '6px 10px', color: colors.gold, border: `1px solid ${colors.gold}`, borderRadius: 4, background: '#1a1a2e' }}
              title={`正在：${activeVisit.label || activeVisit.target_base_url}`}
            >
              {peerBusy ? '…' : '回家'}
            </button>
            {peerHint ? <span style={{ color: colors.gold, wordBreak: 'break-all', fontSize: 9 }}>{peerHint}</span> : null}
          </div>
        ) : (
          <div ref={peerWrapRef} style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setPeerMenuOpen((o) => !o)}
              style={{ cursor: 'pointer', color: '#888', userSelect: 'none', fontSize: 10, background: 'transparent', border: 'none', padding: '2px 4px' }}
            >
              串门
            </button>
            {peerMenuOpen ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 6,
                  zIndex: 200,
                  width: 'min(320px, calc(100vw - 32px))',
                  maxHeight: 'min(72vh, 520px)',
                  overflowY: 'auto',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  background: '#1a1a2e',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
                }}
              >
                <p style={{ margin: 0, fontSize: 9, color: '#777', lineHeight: 1.45 }}>
                  选一个已保存的预设出发，或在下方添加新预设；串门 token 不填则用该预设里保存的 token。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 9, color: '#aaa' }}>预设</label>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    style={{ fontSize: 11, padding: 6, borderRadius: 4, background: '#12121f', color: colors.text, border: `1px solid ${colors.border}` }}
                  >
                    <option value="">请选择…</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="本机鉴权 token（选填）"
                    value={visitTokenOptional}
                    onChange={(e) => setVisitTokenOptional(e.target.value)}
                    style={{ fontSize: 10, padding: 6, width: '100%', boxSizing: 'border-box', borderRadius: 4, border: `1px solid ${colors.border}`, background: '#12121f', color: colors.text }}
                  />
                  <button
                    type="button"
                    disabled={peerBusy}
                    onClick={() => void onDoVisit()}
                    style={{
                      fontSize: 11,
                      padding: '8px 10px',
                      color: '#111',
                      background: colors.gold,
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    {peerBusy ? '…' : '前往'}
                  </button>
                </div>
                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 9, color: '#aaa' }}>新预设</label>
                  <input
                    placeholder="显示名称"
                    value={newPresetLabel}
                    onChange={(e) => setNewPresetLabel(e.target.value)}
                    style={{ fontSize: 10, padding: 6, width: '100%', boxSizing: 'border-box', borderRadius: 4, border: `1px solid ${colors.border}`, background: '#12121f', color: colors.text }}
                  />
                  <input
                    placeholder="对方 base URL"
                    value={newPresetUrl}
                    onChange={(e) => setNewPresetUrl(e.target.value)}
                    style={{ fontSize: 10, padding: 6, width: '100%', boxSizing: 'border-box', borderRadius: 4, border: `1px solid ${colors.border}`, background: '#12121f', color: colors.text }}
                  />
                  <input
                    type="password"
                    placeholder="预设内 token（选填）"
                    value={newPresetToken}
                    onChange={(e) => setNewPresetToken(e.target.value)}
                    style={{ fontSize: 10, padding: 6, width: '100%', boxSizing: 'border-box', borderRadius: 4, border: `1px solid ${colors.border}`, background: '#12121f', color: colors.text }}
                  />
                  <button type="button" disabled={peerBusy} onClick={() => void onAddPreset()} style={{ fontSize: 10, padding: '6px 10px', alignSelf: 'flex-start', borderRadius: 4, border: `1px solid ${colors.border}`, background: '#252538', color: colors.text, cursor: 'pointer' }}>
                    保存预设
                  </button>
                </div>
                {peerHint ? <span style={{ color: colors.gold, wordBreak: 'break-all', fontSize: 9 }}>{peerHint}</span> : null}
              </div>
            ) : null}
          </div>
        )}
        <button type="button" onClick={() => onRefresh()} disabled={loading} style={{ fontSize: 11, padding: '6px 10px' }}>
          {loading ? '…' : '刷新'}
        </button>
      </div>
    </header>
  );
}
