type GameEventHandler = (channel: string, data: Record<string, unknown>) => void;
type ChatStreamHandler = (payload: { token?: string; done?: boolean; content?: string; game_events?: unknown }) => void;

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function defaultGatewayWsUrl(): string {
  const isHttps = location.protocol === 'https:';
  const scheme = isHttps ? 'wss' : 'ws';
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BACKEND_PORT ?? '8765';
    return `${scheme}://${location.hostname}:${port}/ws/gateway`;
  }
  return `${scheme}://${location.host}/ws/gateway`;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export class HermesGameGateway {
  private ws: WebSocket | null = null;
  private handlers = new Set<GameEventHandler>();
  private chatHandlers = new Set<ChatStreamHandler>();
  private _status: GatewayStatus = 'disconnected';
  private statusListeners = new Set<(s: GatewayStatus) => void>();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempt = 0;
  private _intentionalClose = false;

  get status(): GatewayStatus {
    return this._status;
  }

  onStatus(fn: (s: GatewayStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: GatewayStatus) {
    this._status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  onGameEvent(handler: GameEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onChatStream(handler: ChatStreamHandler): () => void {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }

  private _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt));
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._intentionalClose) return;
      this.connect();
    }, delay);
  }

  connect(url?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this._intentionalClose = false;
    const u = url ?? defaultGatewayWsUrl();
    this.setStatus('connecting');
    const ws = new WebSocket(u);
    this.ws = ws;
    ws.onopen = () => {
      this._reconnectAttempt = 0;
      this.setStatus('connected');
      ws.send(JSON.stringify({ type: 'game_event_sub', channels: ['task'] }));
    };
    ws.onerror = () => { /* let onclose handle final status */ };
    ws.onclose = () => {
      this.setStatus('disconnected');
      this.ws = null;
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          channel?: string;
          data?: Record<string, unknown>;
          content?: string;
          done?: boolean;
          game_events?: unknown;
        };
        if (msg.type === 'game_event' && msg.channel && msg.data) {
          this.handlers.forEach((h) => h(msg.channel!, msg.data!));
        } else if (msg.type === 'chat_stream') {
          this.chatHandlers.forEach((h) => h({ token: msg.content, done: msg.done }));
        } else if (msg.type === 'chat_done') {
          this.chatHandlers.forEach((h) => h({ done: true, content: msg.content, game_events: msg.game_events }));
        }
      } catch {
        /* ignore */
      }
    };
  }

  disconnect(): void {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempt = 0;
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }
}

export const gameGateway = new HermesGameGateway();
