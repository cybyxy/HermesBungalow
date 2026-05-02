import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GameWorldSnapshot } from '../types/game';
import { useUiStore, type InferenceEntry } from '../store/uiStore';
import { AgentAvatar } from './AgentAvatar';
import { colors, layoutPx } from './theme';

const panel: CSSProperties = {
  width: layoutPx.sidePanel,
  flexShrink: 0,
  background: colors.panel,
  borderLeft: `2px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const blockTitle: CSSProperties = {
  color: colors.gold,
  fontSize: 12,
  fontWeight: 'bold',
  marginBottom: 8,
};

const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const tableCellBorder = `1px solid ${colors.border}`;

const inferenceMdComponents: Components = {
    p: ({ children }) => <p style={{ margin: '0.35em 0', lineHeight: 1.45 }}>{children}</p>,
    h1: ({ children }) => <h1 style={{ fontSize: 14, margin: '0.5em 0 0.25em', fontWeight: 'bold' }}>{children}</h1>,
    h2: ({ children }) => <h2 style={{ fontSize: 13, margin: '0.5em 0 0.25em', fontWeight: 'bold' }}>{children}</h2>,
    h3: ({ children }) => <h3 style={{ fontSize: 12, margin: '0.4em 0 0.2em', fontWeight: 'bold' }}>{children}</h3>,
    ul: ({ children }) => <ul style={{ margin: '0.25em 0', paddingLeft: 18, lineHeight: 1.45 }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ margin: '0.25em 0', paddingLeft: 18, lineHeight: 1.45 }}>{children}</ol>,
    li: ({ children }) => <li style={{ margin: '0.15em 0' }}>{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: '0.35em 0',
          paddingLeft: 10,
          borderLeft: '3px solid #4a5a8a',
          color: '#a8b4c8',
        }}
      >
        {children}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a href={href} rel="noopener noreferrer" target="_blank" style={{ color: '#8ab4f8', textDecoration: 'underline' }}>
        {children}
      </a>
    ),
    strong: ({ children }) => <strong style={{ fontWeight: 'bold', color: colors.bright }}>{children}</strong>,
    em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
    hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '0.5em 0' }} />,
    pre: ({ children }) => (
      <pre
        style={{
          margin: '0.5em 0',
          padding: 8,
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 4,
          overflow: 'auto',
          fontFamily: mono,
          fontSize: 10,
          lineHeight: 1.4,
        }}
      >
        {children}
      </pre>
    ),
    code: (props) => {
      const { className, children, ...rest } = props;
      const isFenced = Boolean(className && /^language-/.test(className));
      if (isFenced) {
        return (
          <code
            className={className}
            style={{ fontFamily: mono, display: 'block', whiteSpace: 'pre', fontSize: 10 }}
            {...rest}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          style={{
            fontFamily: mono,
            background: 'rgba(0,0,0,0.35)',
            padding: '1px 4px',
            borderRadius: 3,
            fontSize: 10,
          }}
          {...rest}
        >
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div style={{ margin: '0.5em 0', overflowX: 'auto', maxWidth: '100%' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 10,
            lineHeight: 1.35,
            border: tableCellBorder,
          }}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead style={{ background: 'rgba(0,0,0,0.28)' }}>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
      <th
        style={{
          border: tableCellBorder,
          padding: '5px 7px',
          textAlign: 'left',
          fontWeight: 'bold',
          color: colors.bright,
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td style={{ border: tableCellBorder, padding: '5px 7px', textAlign: 'left', verticalAlign: 'top' }}>{children}</td>
    ),
};

function InferenceBody(props: { variant: InferenceEntry['variant']; body: string }) {
  const { variant, body } = props;
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
          fontFamily: mono,
        }}
      >
        {body}
      </pre>
    );
  }
  return (
    <div style={{ fontSize: 11, lineHeight: 1.45, color: '#c8d4e0', wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={inferenceMdComponents}>
        {body}
      </ReactMarkdown>
    </div>
  );
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

/** 用户消息首行：对话目标 Agent 名称（``agentId``；``/relay`` 或 ``@…|`` 从正文解析收件人）。 */
function userInferenceTargetName(e: InferenceEntry, snapshot: GameWorldSnapshot): string {
  const body = (e.body || '').trim();
  const relayM = body.match(/^\/relay\s+(\S+)\s*\|\s*/i);
  if (relayM) {
    const token = relayM[1].trim();
    const hit = snapshot.agents.find((a) => a.id === token || a.profile === token || a.name === token);
    return hit?.name ?? token;
  }
  const atM = body.match(/^@(\S+)\s*[|｜]\s*/);
  if (atM) {
    const token = atM[1].trim();
    const hit = snapshot.agents.find((a) => a.id === token || a.profile === token || a.name === token);
    return hit?.name ?? token;
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

export function RightPanel(props: {
  snapshot: GameWorldSnapshot;
  selectedTaskId: number | null;
  onSelectTask: (taskId: number) => void;
  onAssignTask: (taskId: number, agentId?: string | null) => void;
}) {
  const { snapshot, selectedTaskId, onSelectTask, onAssignTask } = props;
  const inferenceLog = useUiStore((s) => s.inferenceLog);
  const clearInferenceLog = useUiStore((s) => s.clearInferenceLog);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolScrollRef = useRef<HTMLDivElement>(null);
  const visibleInferenceLog = inferenceLog.filter(
    (e) => e.variant === 'user' || e.variant === 'reply' || e.variant === 'error' || e.variant === 'reasoning' || e.variant === 'status',
  );
  const visibleToolLog = inferenceLog.filter(
    (e) => e.variant === 'tool_start' || e.variant === 'tool_done' || e.variant === 'tool_failed',
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
    <aside style={panel}>
      {/* 上半部分：推理 Trace */}
      <div
        style={{
          flex: '1 1 50%',
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
          <div style={{ ...blockTitle, marginBottom: 0 }}>▶ 推理 Trace</div>
          <button
            type="button"
            onClick={() => clearInferenceLog()}
            style={{ fontSize: 10, padding: '4px 8px', opacity: 0.85 }}
          >
            清空
          </button>
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
              推理过程（reasoning / status）和最终回复将显示在此。
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
                            fontFamily: mono,
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
                    <InferenceBody variant={e.variant} body={e.body} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 下半部分：Tool Log */}
      <div
        style={{
          flex: '1 1 50%',
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
          <div style={{ ...blockTitle, marginBottom: 0 }}>🔧 Tool Log</div>
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
              工具调用记录将显示在此。
            </p>
          )}
          {visibleToolLog.map((e) => {
            const agent = e.agentId ? snapshot.agents.find((a) => a.id === e.agentId) : undefined;
            const { border, bg } = entryStyle(e.variant);
            const roleLabel = inferenceRoleLabel(e, agent);
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
                  <span style={{ fontSize: 9, color: '#555', flexShrink: 0 }}>
                    {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <InferenceBody variant={e.variant} body={e.body} />
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
