type GameEventHandler = (channel: string, data: Record<string, unknown>) => void;
type ChatStreamHandler = (payload: { token?: string; done?: boolean; content?: string; game_events?: unknown }) => void;

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function defaultGatewayWsUrl(): string {
  const isHttps = location.protocol === 'https:';
  const scheme = isHttps ? 'wss' : 'ws';
  // Avoid Vite's ws proxy — it often logs EPIPE when the backend closes or the tab refreshes.
  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BACKEND_PORT ?? '8000';
    return `${scheme}://${location.hostname}:${port}/ws/gateway`;
  }
  return `${scheme}://${location.host}/ws/gateway`;
}

/**
 * WebSocket client for /ws/gateway.
 * Dev: connects directly to the backend port (same hostname as the page). Prod: same host as the app.
 */
export class HermesGameGateway {
  private ws: WebSocket | null = null;
  private handlers = new Set<GameEventHandler>();
  private chatHandlers = new Set<ChatStreamHandler>();
  private _status: GatewayStatus = 'disconnected';
  private statusListeners = new Set<(s: GatewayStatus) => void>();
  /** User called `disconnect()` — do not auto-reconnect after `onclose`. */
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastUrl: string | undefined;

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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  onGameEvent(handler: GameEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onChatStream(handler: ChatStreamHandler): () => void {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }

  connect(url?: string): void {
    this.intentionalClose = false;
    this.lastUrl = url ?? defaultGatewayWsUrl();
    this.clearReconnectTimer();
    this.openSocket();
  }

  private openSocket(): void {
    if (this.intentionalClose) return;
    const u = this.lastUrl ?? defaultGatewayWsUrl();
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.setStatus('connecting');
    const ws = new WebSocket(u);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      ws.send(JSON.stringify({ type: 'game_event_sub', channels: ['task', 'agent_status', 'competition', 'social'] }));
    };
    ws.onerror = () => { /* let onclose handle final status */ };
    ws.onclose = () => {
      this.ws = null;
      if (this.intentionalClose) {
        this.setStatus('disconnected');
        return;
      }
      this.setStatus('disconnected');
      this.reconnectAttempt += 1;
      const cap = 30_000;
      const base = 400 + this.reconnectAttempt * 450;
      const jitter = Math.random() * 500;
      const delay = Math.min(cap, base + jitter);
      this.clearReconnectTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.intentionalClose) return;
        this.openSocket();
      }, delay);
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
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  sendChat(message: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', message }));
    }
  }
}

export const gameGateway = new HermesGameGateway();
