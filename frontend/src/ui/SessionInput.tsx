import { useEffect, useState } from 'react';
import { bindSessionId, connectWS } from '../services/ws';
import { useGameState } from '../store/gameState';

export function SessionInput() {
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
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
      const sid = String(data?.session?.session_id || data?.session_id || '');
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
      const startData = await startResp.json();
      const streamId = String(startData?.stream_id || '');
      if (!streamId) {
        appendChat('caicai', '缺少流式ID。');
        setIsStreaming(false);
        return;
      }

      const streamResp = await fetch(`/api/chat/stream?stream_id=${encodeURIComponent(streamId)}`);
      if (!streamResp.ok || !streamResp.body) {
        appendChat('caicai', '流式响应不可用。');
        setIsStreaming(false);
        return;
      }
      const reader = streamResp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let finalText = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
          if (!line.startsWith('data: ')) continue;
          const payloadText = line.slice(6).trim();
          if (!payloadText) continue;
          if (currentEvent === 'message' || currentEvent === 'token' || currentEvent === 'text') {
            try {
              const parsed = JSON.parse(payloadText);
              const txt = String(parsed?.text || '');
              if (txt) finalText += txt;
            } catch {
              finalText += payloadText;
            }
          }
          if (currentEvent === 'stream_end') {
            break;
          }
        }
        setStreamingText(finalText || '...');
      }
      appendChat('caicai', finalText || streamingText || '（无输出）');
    } catch {
      appendChat('caicai', '请求异常，请检查后端服务。');
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">会话输入 ({wsStatus})</div>
      <div className="chat-list" style={{ maxHeight: 220 }}>
        {chat.slice(-8).map((m) => (
          <div key={m.id} className={`chat-bubble ${m.sender}`}>{m.text}</div>
        ))}
        {isStreaming && <div className="chat-bubble caicai">{streamingText || '...'}</div>}
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
          placeholder="输入需求，Enter发送，Shift+Enter换行"
          rows={2}
        />
        <button onClick={onSend}>发送</button>
      </div>
    </section>
  );
}
