import { useEffect, useState } from 'react';
import { bindSessionId, connectWS } from '../services/ws';
import { useGameState } from '../store/gameState';

export function DialogBox() {
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinking, setThinking] = useState('');
  const chat = useGameState((s) => s.chatMessages);
  const wsStatus = useGameState((s) => s.wsStatus);
  const appendChat = useGameState((s) => s.appendChat);

  useEffect(() => {
    connectWS();
  }, []);

  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    try {
      const resp = await fetch('/api/session/new', { method: 'POST' });
      if (!resp.ok) return null;
      const data = await resp.json();
      const sid = String(data?.session_id || '');
      if (!sid) return null;
      setSessionId(sid);
      bindSessionId(sid);
      return sid;
    } catch {
      return null;
    }
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text) return;
    appendChat('user', text);
    setInput('');
    setThinking('');
    setStreamingText('');
    setIsStreaming(true);

    const sid = await ensureSession();
    if (!sid) {
      appendChat('caicai', '会话创建失败，请稍后重试。');
      setIsStreaming(false);
      return;
    }

    try {
      const startResp = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sid }),
      });
      if (!startResp.ok) {
        appendChat('caicai', '聊天启动失败。');
        setIsStreaming(false);
        return;
      }

      const streamResp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sid }),
      });
      if (!streamResp.ok || !streamResp.body) {
        appendChat('caicai', '流式响应不可用。');
        setIsStreaming(false);
        return;
      }

      const reader = streamResp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalText = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'thinking') {
            setThinking(String(payload.chunk || ''));
          } else if (payload.type === 'chunk') {
            finalText = `${finalText}${finalText ? '\n' : ''}${String(payload.text || '')}`;
            setStreamingText(finalText);
          } else if (payload.type === 'done') {
            finalText = String(payload.text || finalText || '');
          } else if (payload.type === 'error') {
            finalText = String(payload.text || 'stream error');
          }
        }
      }
      appendChat('caicai', finalText || streamingText || '（无输出）');
    } catch {
      appendChat('caicai', '请求异常，请检查后端服务。');
    } finally {
      setIsStreaming(false);
      setThinking('');
      setStreamingText('');
    }
  };

  return (
    <section className="panel chat-panel">
      <div className="panel-title">会话区 ({wsStatus})</div>
      <div className="chat-list">
        {chat.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.sender}`}>{m.text}</div>
        ))}
        {isStreaming && (
          <div className="chat-bubble caicai">
            {thinking ? `💭 ${thinking}\n` : ''}{streamingText || '...'}
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="输入需求，Enter 发送，Shift+Enter 换行"
          rows={2}
        />
        <button onClick={onSend}>发送</button>
      </div>
    </section>
  );
}
