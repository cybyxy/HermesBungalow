// WebSocket 连接 + SSE 流式处理 — HermesBungalow 前端
import { useGameState, type ChatMessage, type GatewayEvent, type ImageData } from '../store/gameState';
import { type Expression } from '../store/gameState';

// ========================
// 状态
// ========================
let ws: WebSocket | null = null;
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
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const store = useGameState.getState();
  store.setWsStatus('connecting');

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WS] Connected to Gateway');
      reconnectAttempts = 0;
      store.setWsStatus('open');
      startHeartbeat();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        handleWSEvent(data);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      store.setWsStatus('reconnecting');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
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
      const messages = store.messages;
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg) break;

      // 防止重复处理：如果已经不是 streaming 状态，跳过
      if (!lastMsg._streaming) break;

      // 合并事件
      const events: GatewayEvent[] = (data.events || []).map((e: any) => ({
        type: e.type,
        value: e.value,
      }));
      const finalMsg: ChatMessage = {
        id: lastMsg.id,
        sender: 'caicai',
        text: data.reply || lastMsg.text,
        timestamp: lastMsg.timestamp,
        events,
        _streaming: false,
      };
      updateMessages((prev) => [...prev.slice(0, -1), finalMsg], { isTyping: false });

      // 通知 Phaser：可根据最终回复文本做互动兜底（即使 events 为空）
      window.dispatchEvent(new CustomEvent('caicai-chat-reply', {
        detail: { reply: finalMsg.text, events },
      }));

      // 处理事件
      if (events.length > 0) {
        store.handleGatewayEvents(events);
      }
      break;
    }

    case 'state_update':
      console.log('[WS] State update:', data.state);
      break;

    case 'error':
      console.error('[WS] Error:', data.message);
      store.setIsTyping(false);
      // 出错时添加错误消息
      const errMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'caicai',
        text: `*崽崽遇到了点问题* 💦\n${data.message}`,
        timestamp: new Date(),
      };
      updateMessages((prev) => [...prev, errMsg]);
      break;

    case 'typing':
      store.setIsTyping(true);
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
  if (images && images.length > 0) {
    payload.images = images;
  }
  ws.send(JSON.stringify(payload));
}

// ========================
// 连接清理
// ========================
export function disconnectWS(): void {
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) ws.close();
}

