import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { GameWorldSnapshot } from '../types/game';
import { useUiStore, type InferenceEntry } from '../store/uiStore';
import { AgentAvatar } from './AgentAvatar';
import { InferenceMarkdownBody, inferenceMono } from './inferenceMarkdown';
import { MarkdownWorkspace } from './MarkdownWorkspace';
import { colors } from './theme';
import * as gameApi from '../services/gameApi';

const blockTitle: CSSProperties = {
  color: colors.gold,
  fontSize: 12,
  fontWeight: 'bold',
  marginBottom: 8,
};

function InferenceBody(props: {
  variant: InferenceEntry['variant'];
  body: string;
  markdownEditor?: boolean;
}) {
  const { variant, body, markdownEditor } = props;
  if (variant === 'error') {
    return (
      <pre
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: 1.45,
          color: '#f88',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: inferenceMono,
        }}
      >
        {body}
      </pre>
    );
  }

  if (markdownEditor && variant === 'reply') {
    return <MarkdownWorkspace body={body} />;
  }

  return <InferenceMarkdownBody body={body} />;
}

/** 用户侧气泡头像（与 Agent 圆形风格一致，固定在消息右侧）。 */
function UserAvatar(props: { size?: number }) {
  const size = props.size ?? 34;
  return (
    <span
      title="你"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `2px solid ${colors.gold}`,
        background: '#2a2848',
        color: colors.gold,
        fontSize: Math.max(10, Math.round(size * 0.3)),
        fontWeight: 'bold',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxSizing: 'border-box',
        fontFamily: 'inherit',
      }}
    >
      我
    </span>
  );
}

/** 用户消息首行：对话目标 Agent 名称（``agentId``；正文 ``@…|`` 或旧式 ``/relay`` 解析收件人）。 */
function userInferenceTargetName(e: InferenceEntry, snapshot: GameWorldSnapshot): string {
  const body = (e.body || '').trim();
  const h = gameApi.parseUserHandoffPrefix(body);
  if (h) {
    if (gameApi.isBroadcastAllHandoffToken(h.token)) return '全体同伴';
    const hit = gameApi.resolveGameAgent(snapshot.agents, h.token);
    return hit?.name ?? h.token;
  }
  if (e.agentId) {
    const hit = snapshot.agents.find((a) => a.id === e.agentId);
    if (hit?.name) return hit.name;
  }
  return 'Agent';
}

/** 首行「职业」文案：系统 / Agent 职业（无则退回 headline 后缀）。 */
function inferenceRoleLabel(e: InferenceEntry, agent: { profession?: string } | undefined): string {
  if (e.variant === 'user') return '';
  if (e.variant === 'error') {
    const h = (e.headline || '').trim();
    return h && h !== '系统' ? h : '系统';
  }
  const p = (agent?.profession || '').trim();
  if (p) return p;
  const h = e.headline || '';
  const i = h.indexOf(' · ');
  if (i >= 0) return h.slice(i + 3).trim() || h;
  return h || 'Agent';
}

function entryStyle(v: InferenceEntry['variant']): { border: string; bg: string } {
  if (v === 'user') return { border: '#4a5a8a', bg: 'rgba(42,58,90,0.35)' };
  if (v === 'status') return { border: '#3a4558', bg: 'rgba(30,35,55,0.6)' };
  if (v === 'error') return { border: '#8a3a3a', bg: 'rgba(60,20,20,0.35)' };
  if (v === 'reasoning') return { border: '#5a4a8a', bg: 'rgba(50,40,90,0.28)' };
  if (v === 'tool_start') return { border: '#8a7a2a', bg: 'rgba(90,80,30,0.3)' };
  if (v === 'tool_done') return { border: '#2a6a4a', bg: 'rgba(26,80,58,0.28)' };
  if (v === 'tool_failed') return { border: '#8a4a2a', bg: 'rgba(90,40,26,0.32)' };
  return { border: '#2a4a3a', bg: 'rgba(26,58,42,0.25)' };
}

export function RightPanel(props: { snapshot: GameWorldSnapshot }) {
  const { snapshot } = props;
  const inferenceLog = useUiStore((s) => s.inferenceLog);
  const clearInferenceLog = useUiStore((s) => s.clearInferenceLog);
  const toggleStudioRightPanelCollapsed = useUiStore((s) => s.toggleStudioRightPanelCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolScrollRef = useRef<HTMLDivElement>(null);
  const visibleInferenceLog = inferenceLog.filter(
    (e) => e.variant === 'user' || e.variant === 'reply' || e.variant === 'error',
  );
  const visibleToolLog = inferenceLog.filter(
    (e) =>
      e.variant === 'tool_start' ||
      e.variant === 'tool_done' ||
      e.variant === 'tool_failed' ||
      e.variant === 'reasoning' ||
      e.variant === 'status',
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [inferenceLog]);

  useEffect(() => {
    const el = toolScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [inferenceLog]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* 上半：会话 */}
      <div
        style={{
          flex: '7 1 70%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: `1px solid ${colors.border}`,
          minWidth: 0,
        }}
      >
        <div
          style={{
            padding: '10px 12px 6px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ ...blockTitle, marginBottom: 0 }}>💬 会话</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              title="收起"
              onClick={() => toggleStudioRightPanelCollapsed()}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: 'rgba(42,58,90,0.6)',
                color: colors.bright,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => clearInferenceLog()}
              style={{ fontSize: 10, padding: '4px 8px', opacity: 0.85 }}
            >
              清空
            </button>
          </div>
        </div>
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0 10px 10px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          {visibleInferenceLog.length === 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: '#666',
                lineHeight: 1.5,
                width: '100%',
                alignSelf: 'stretch',
              }}
            >
              用户消息与 Agent 回复将显示在此。
            </p>
          )}
          {visibleInferenceLog.map((e) => {
            const agent = e.agentId ? snapshot.agents.find((a) => a.id === e.agentId) : undefined;
            const { border, bg } = entryStyle(e.variant);
            const time = new Date(e.at).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const isUser = e.variant === 'user';
            const AV = 34;
            const roleLabel = inferenceRoleLabel(e, agent);
            const userTargetName = isUser ? userInferenceTargetName(e, snapshot) : '';
            return (
              <div
                key={e.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: 'min(100%, 520px)',
                  minWidth: 0,
                  width: 'fit-content',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      minWidth: 0,
                    }}
                  >
                    {isUser ? (
                      <>
                        <span style={{ fontSize: 9, color: '#666', flexShrink: 0 }}>{time}</span>
                        <span style={{ width: 10, flexShrink: 0 }} />
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 11,
                            fontWeight: 'bold',
                            color: colors.gold,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'right',
                          }}
                          title={userTargetName}
                        >
                          {userTargetName}
                        </span>
                        <span
                          style={{
                            color: '#5a6378',
                            fontSize: 10,
                            flexShrink: 0,
                            userSelect: 'none',
                            marginLeft: 2,
                            fontFamily: inferenceMono,
                          }}
                        >
                          {'<---'}
                        </span>
                        <UserAvatar size={AV} />
                      </>
                    ) : (
                      <>
                        <AgentAvatar agent={agent} size={AV} />
                        <span style={{ color: '#5a6378', fontSize: 11, flexShrink: 0, userSelect: 'none' }}>--</span>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 11,
                            fontWeight: 'bold',
                            color: colors.gold,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'left',
                          }}
                          title={roleLabel}
                        >
                          {roleLabel}
                        </span>
                        <span style={{ fontSize: 9, color: '#666', flexShrink: 0 }}>{time}</span>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      border: `1px solid ${border}`,
                      background: bg,
                      borderRadius: 12,
                      padding: '8px 10px',
                      minWidth: 0,
                    }}
                  >
                    <InferenceBody variant={e.variant} body={e.body} markdownEditor={e.markdownEditor} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 下半：过程与工具 */}
      <div
        style={{
          flex: '3 1 30%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <div
          style={{
            padding: '10px 12px 6px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ ...blockTitle, marginBottom: 0 }}>🔧 过程与工具</div>
        </div>
        <div
          ref={toolScrollRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '0 10px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {visibleToolLog.length === 0 && (
            <p style={{ margin: 0, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
              推理过程、工具调用与状态将显示在此。
            </p>
          )}
          {visibleToolLog.map((e) => {
            const agent = e.agentId ? snapshot.agents.find((a) => a.id === e.agentId) : undefined;
            const { border, bg } = entryStyle(e.variant);
            const roleLabel = inferenceRoleLabel(e, agent);
            const time = new Date(e.at).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            if (e.variant === 'reasoning' || e.variant === 'status') {
              return (
                <div
                  key={e.id}
                  style={{
                    border: `1px solid ${border}`,
                    background: bg,
                    borderRadius: 12,
                    padding: '8px 10px',
                    minWidth: 0,
                  }}
                >
                  <div style={{ fontSize: 9, color: '#666', marginBottom: 4 }}>{time}</div>
                  <div style={{ fontSize: 10, fontWeight: 'bold', color: colors.gold, marginBottom: 4 }}>
                    {roleLabel}
                  </div>
                  <InferenceBody variant={e.variant} body={e.body} markdownEditor={e.markdownEditor} />
                </div>
              );
            }
            return (
              <div
                key={e.id}
                style={{
                  border: `1px solid ${border}`,
                  background: bg,
                  borderRadius: 8,
                  padding: '6px 10px',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: e.variant === 'tool_start' ? 4 : 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 'bold',
                      color: e.variant === 'tool_done' ? '#5fda7a' : e.variant === 'tool_failed' ? '#f88' : '#aaa',
                      flexShrink: 0,
                    }}
                  >
                    {e.variant === 'tool_start' ? '→' : e.variant === 'tool_done' ? '✓' : e.variant === 'tool_failed' ? '✗' : '•'}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 'bold', color: colors.gold }}>{roleLabel}</span>
                  <span style={{ fontSize: 9, color: '#555', flexShrink: 0 }}>{time}</span>
                </div>
                <InferenceBody variant={e.variant} body={e.body} markdownEditor={e.markdownEditor} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
