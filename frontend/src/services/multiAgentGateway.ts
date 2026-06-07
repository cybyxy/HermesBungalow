/**
 * Multi-Agent WebSocket client for /ws/multi-agent.
 *
 * Protocol:
 *   Client → Gateway:  {type:'init', profile:'default'}
 *   Gateway → Client:  {type:'session_ready', session_id:'...', profile:'...', description:'...'}
 *
 *   Client → Gateway:  {type:'chat', session_id:'...', message:'...'}
 *   Gateway → Client:  {type:'chat_stream', content:'token', done:false}
 *                     {type:'chat_done', content:'full response', game_events:{...}}
 *                     {type:'error', message:'...'}
 *
 * Usage:
 *   const client = new MultiAgentGatewayClient();
 *   await client.connect('PyMaster');
 *   client.onStream(token => appendToUI(token));
 *   client.onDone(response => finishUI(response));
 *   client.sendMessage('Hello agent!');
 */

type StreamHandler = (payload: { token?: string; done?: boolean; content?: string }) => void;
type DoneHandler = (payload: { content?: string; game_events?: unknown }) => void;
type ErrorHandler = (message: string) => void;
type InitHandler = (payload: { session_id: string; profile: string; description: string }) => void;

export type AgentProfile = 'default' | 'PyMaster';

function multiAgentWsUrl(): string {
  const isHttps = location.protocol === 'https:';
  const scheme = isHttps ? 'wss' : 'ws';
  const port = import.meta.env.DEV
    ? (import.meta.env.VITE_BACKEND_PORT ?? '8765')
    : location.port;
  return `${scheme}://${location.hostname}:${port}/ws/multi-agent`;
}

export class MultiAgentGatewayClient {
  private ws: WebSocket | null = null;
  private _sessionId: string | null = null;
  private _profile: AgentProfile | null = null;
  private _status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private _statusListeners = new Set<(s: typeof this._status) => void>();
  private _streamHandlers = new Set<StreamHandler>();
  private _doneHandlers = new Set<DoneHandler>();
  private _errorHandlers = new Set<ErrorHandler>();
  private _initHandlers = new Set<InitHandler>();

  get sessionId(): string | null { return this._sessionId; }
  get profile(): AgentProfile | null { return this._profile; }
  get status() { return this._status; }

  onStatus(fn: (s: typeof this._status) => void): () => void {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  onStream(fn: StreamHandler): () => void {
    this._streamHandlers.add(fn);
    return () => this._streamHandlers.delete(fn);
  }

  onDone(fn: DoneHandler): () => void {
    this._doneHandlers.add(fn);
    return () => this._doneHandlers.delete(fn);
  }

  onError(fn: ErrorHandler): () => void {
    this._errorHandlers.add(fn);
    return () => this._errorHandlers.delete(fn);
  }

  onInit(fn: InitHandler): () => void {
    this._initHandlers.add(fn);
    return () => this._initHandlers.delete(fn);
  }

  private _setStatus(s: typeof this._status) {
    this._status = s;
    this._statusListeners.forEach(fn => fn(s));
  }

  /**
   * Connect and authenticate with a profile.
   * Returns a promise that resolves when session_ready is received.
   */
  async connect(profile: AgentProfile = 'default'): Promise<{ session_id: string; description: string }> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
      }

      this._profile = profile;
      this._setStatus('connecting');

      const url = multiAgentWsUrl();
      const ws = new WebSocket(url);
      this.ws = ws;

      // Timeout if connection doesn't establish
      const timeout = setTimeout(() => {
        ws.close();
        this._setStatus('error');
        reject(new Error('Connection timeout'));
      }, 15000);

      ws.onopen = () => {
        // Send init to request a session with this profile
        ws.send(JSON.stringify({ type: 'init', profile }));
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this._setStatus('error');
        reject(new Error('WebSocket error'));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        if (this._status !== 'error') {
          this._setStatus('disconnected');
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string;
            session_id?: string;
            profile?: string;
            description?: string;
            content?: string;
            done?: boolean;
            game_events?: unknown;
            message?: string;
          };

          switch (msg.type) {
            case 'session_ready':
              clearTimeout(timeout);
              this._sessionId = msg.session_id ?? null;
              this._setStatus('connected');
              this._initHandlers.forEach(fn => fn({
                session_id: msg.session_id!,
                profile: msg.profile!,
                description: msg.description!,
              }));
              resolve({ session_id: msg.session_id!, description: msg.description! });
              break;

            case 'chat_stream':
              this._streamHandlers.forEach(fn => fn({
                token: msg.content,
                done: msg.done,
              }));
              break;

            case 'chat_done':
              this._doneHandlers.forEach(fn => fn({
                content: msg.content,
                game_events: msg.game_events,
              }));
              break;

            case 'error':
              this._errorHandlers.forEach(fn => fn(msg.message ?? 'Unknown error'));
              break;
          }
        } catch {
          /* ignore parse errors */
        }
      };
    });
  }

  /**
   * Send a chat message. Must be called after connect() has resolved.
   */
  sendMessage(message: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this._sessionId) {
      throw new Error('Not connected. Call connect() first.');
    }
    this.ws.send(JSON.stringify({
      type: 'chat',
      session_id: this._sessionId,
      message,
    }));
  }

  /**
   * Fetch conversation history for the current session.
   */
  requestHistory(): void {
    if (this.ws?.readyState !== WebSocket.OPEN || !this._sessionId) return;
    this.ws.send(JSON.stringify({ type: 'history', session_id: this._sessionId }));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this._sessionId = null;
    this._profile = null;
    this._setStatus('disconnected');
  }
}

/** Singleton for the current tab — each tab gets its own client instance. */
export const multiAgentClient = new MultiAgentGatewayClient();
