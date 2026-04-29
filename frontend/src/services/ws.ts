// WebSocket 连接 + SSE 流式处理 — HermesBungalow 前端
import { useGameState, type ChatMessage, type GatewayEvent, type ImageData } from '../store/gameState';
import { type Expression } from '../store/gameState';

// ========================
// 状态
// ========================
let ws: WebSocket | null = null;
let allowAutoReconnect = true;
const WS_URL = import.meta.env.DEV
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000/ws/caicai`
  : `/ws/caicai`;

function updateMessages(
  updater: (messages: ChatMessage[]) => ChatMessage[],
  extraState?: Partial<ReturnType<typeof useGameState.getState>>
): void {
  useGameState.setState((state) => ({
    ...extraState,
    messages: updater(state.messages),
  }));
}

function removeThinkingBubbles(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m._thinking);
}

function stripThinkTags(text: string): string {
  if (!text) return text;
  let out = text;
  // Remove full thinking blocks including their content
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  // Fallback: strip dangling opening/closing tags if model output is malformed
  out = out.replace(/<\/?think\b[^>]*>/gi, '');
  out = out.replace(/<\/?thinking\b[^>]*>/gi, '');
  // Remove leading "think:" style labels
  out = out.replace(/^\s*(think|thinking)\s*[:：]\s*/i, '');
  return out.trim();
}

// 心跳
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT  = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

// 重连
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY  = 8_000;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ========================
// 连接管理
// ========================
export function connectWS(): void {
  // 防止重复建连：OPEN / CONNECTING 都不再创建新连接
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  allowAutoReconnect = true;

  const store = useGameState.getState();
  store.setWsStatus('connecting');

  try {
    const socket = new WebSocket(WS_URL);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      console.log('[WS] Connected to Gateway');
      reconnectAttempts = 0;
      store.setWsStatus('open');
      startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        handleWSEvent(data);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      stopHeartbeat();
      if (!allowAutoReconnect) {
        store.setWsStatus('disconnected');
        return;
      }
      store.setWsStatus('reconnecting');
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      if (ws !== socket) return;
      console.error('[WS] Error:', err);
    };
  } catch (e) {
    console.error('[WS] Connection failed:', e);
    store.setWsStatus('reconnecting');
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  reconnectAttempts++;

  console.log(`[WS] Reconnecting in ${delay}ms (attempt #${reconnectAttempts})`);
  const store = useGameState.getState();
  store.setWsStatus('reconnecting');

  reconnectTimer = setTimeout(() => {
    connectWS();
  }, delay);
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimeout = setTimeout(() => {
    console.warn('[WS] Heartbeat timeout');
    if (ws) ws.close();
  }, HEARTBEAT_TIMEOUT);

  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch (e) {
      console.error('[WS] Heartbeat failed:', e);
      if (ws) ws.close();
    }
  }, HEARTBEAT_INTERVAL);
}

function resetHeartbeatTimeout(): void {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  heartbeatTimeout = setTimeout(() => {
    console.warn('[WS] Heartbeat timeout');
    if (ws) ws.close();
  }, HEARTBEAT_TIMEOUT);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
}

// ========================
// 事件处理
// ========================
function handleWSEvent(data: any): void {
  const store = useGameState.getState();

  switch (data.type) {
    case 'pong':
      resetHeartbeatTimeout();
      break;

    case 'token': {
      // 流式 token — 追加到最后一条崽崽消息
      const messages = store.messages;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.sender === 'caicai' && lastMsg._streaming) {
        const updated = { ...lastMsg, text: lastMsg.text + (data.text || '') };
        updateMessages((prev) => [...prev.slice(0, -1), updated]);
      } else {
        // 创建新的流式消息
        const streamingMsg: ChatMessage = {
          id: `stream-${Date.now()}`,
          sender: 'caicai',
          text: data.text,
          timestamp: new Date(),
          _streaming: true,
        };
        updateMessages((prev) => [...prev, streamingMsg]);
      }
      break;
    }

    case 'caicai_event': {
      // Caicai 表情/动作事件
      const ev = data.event as { type: string; value: string };
      if (ev.type === 'expression') {
        store.setExpression(ev.value as Expression);
      } else if (ev.type === 'action') {
        // 通知 GameScene 处理动作
        window.dispatchEvent(new CustomEvent('caicai-action', { detail: ev }));
      }
      break;
    }

    case 'chat_reply': {
      // 最终回复 — 替换流式消息
      const messages = removeThinkingBubbles(store.messages);
      const lastMsg = messages[messages.length - 1];
      // 合并事件
      const events: GatewayEvent[] = (data.events || []).map((e: any) => ({
        type: e.type,
        value: e.value,
      }));
      const fallbackText = '*崽崽这次没有返回可显示文本*';
      const finalText = (typeof data.reply === 'string' && data.reply.trim())
        ? stripThinkTags(data.reply)
        : (lastMsg?.sender === 'caicai' ? lastMsg.text : fallbackText);

      if (lastMsg && lastMsg.sender === 'caicai' && lastMsg._streaming) {
        const finalMsg: ChatMessage = {
          id: lastMsg.id,
          sender: 'caicai',
          text: finalText,
          timestamp: lastMsg.timestamp,
          events,
          _streaming: false,
        };
        updateMessages((prev) => {
          const cleaned = removeThinkingBubbles(prev);
          return [...cleaned.slice(0, -1), finalMsg];
        }, { isTyping: false });
      } else {
        const finalMsg: ChatMessage = {
          id: `reply-${Date.now()}`,
          sender: 'caicai',
          text: finalText,
          timestamp: new Date(),
          events,
          _streaming: false,
        };
        updateMessages((prev) => [...removeThinkingBubbles(prev), finalMsg], { isTyping: false });
      }
      if (typeof data.session_id === 'string' && data.session_id) {
        store.setSessionId(data.session_id);
      }
      store.clearThinkingTrace();

      // 通知 Phaser：可根据最终回复文本做互动兜底（即使 events 为空）
      window.dispatchEvent(new CustomEvent('caicai-chat-reply', {
        detail: { reply: finalText, events },
      }));

      // 处理事件
      if (events.length > 0) {
        store.handleGatewayEvents(events);
        // 兼容：有些后端只在 chat_reply 里返回 events，不会单独发 caicai_event
        for (const ev of events) {
          if (ev.type === 'action') {
            window.dispatchEvent(new CustomEvent('caicai-action', {
              detail: { type: 'action', value: ev.value },
            }));
          }
        }
      }
      break;
    }

    case 'session_history': {
      const sid = typeof data.session_id === 'string' ? data.session_id : '';
      const rows = Array.isArray(data.messages) ? data.messages : [];
      const history: ChatMessage[] = rows
        .filter((m: any) => typeof m?.text === 'string' && m.text.trim())
        .map((m: any, idx: number) => ({
          id: String(m.id || `boot-${Date.now()}-${idx}`),
          sender: m.sender === 'user' ? 'user' : 'caicai',
          text: String(m.text || ''),
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          _streaming: false,
        }));
      if (sid) store.setSessionId(sid);
      if (history.length > 0) {
        store.setMessages(history);
      }
      store.setIsTyping(false);
      store.clearThinkingTrace();
      break;
    }

    case 'thinking':
      if (data.text) {
        const thinkMsg: ChatMessage = {
          id: `think-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sender: 'caicai',
          text: String(data.text),
          timestamp: new Date(),
          _thinking: true,
          _streaming: false,
        };
        updateMessages((prev) => [...prev, thinkMsg]);
        store.appendThinkingTrace(String(data.text));
      }
      break;

    case 'state_update':
      console.log('[WS] State update:', data.state);
      break;

    case 'error':
      console.error('[WS] Error:', data.message);
      store.setIsTyping(false);
      store.clearThinkingTrace();
      // 出错时添加错误消息
      const errMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'caicai',
        text: `*崽崽遇到了点问题* 💦\n${data.message}`,
        timestamp: new Date(),
      };
      updateMessages((prev) => [...removeThinkingBubbles(prev), errMsg]);
      break;

    case 'typing':
      store.setIsTyping(true);
      break;

    case 'chat_stopped':
      store.setIsTyping(false);
      store.clearThinkingTrace();
      updateMessages((prev) => removeThinkingBubbles(prev));
      break;
  }
}

// ========================
// 发送消息（支持多图）
// ========================
export function sendChatMessage(text: string, images?: ImageData[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] Not connected');
    return;
  }

  const payload: Record<string, any> = { type: 'chat', message: text };
  useGameState.getState().clearThinkingTrace();
  updateMessages((prev) => removeThinkingBubbles(prev));
  const currentSessionId = useGameState.getState().sessionId;
  if (currentSessionId) {
    payload.session_id = currentSessionId;
  } else {
    // 显式告诉后端：这是“新建会话”后的首条消息
    payload.new_session = true;
  }
  if (images && images.length > 0) {
    payload.images = images;
  }
  ws.send(JSON.stringify(payload));
}

export function stopChatMessage(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'stop' }));
}

// ========================
// 连接清理
// ========================
export function disconnectWS(): void {
  allowAutoReconnect = false;
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    const socket = ws;
    ws = null;
    try { socket.close(); } catch {}
  }
  useGameState.getState().setWsStatus('disconnected');
}

