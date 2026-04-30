import { useGameState } from '../store/gameState';

let socket: WebSocket | null = null;
let boundSessionId: string | null = null;

export function connectWS() {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  useGameState.getState().setWsStatus('connecting');
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.onopen = () => useGameState.getState().setWsStatus('open');
  socket.onclose = () => useGameState.getState().setWsStatus('disconnected');
  socket.onerror = () => useGameState.getState().setWsStatus('disconnected');
  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'chat_reply') useGameState.getState().appendChat('caicai', data.text || '');
      window.dispatchEvent(new CustomEvent('hb-ws-event', { detail: data }));
    } catch {
      // ignore malformed frame
    }
  };
}

export function bindSessionId(sessionId: string | null) {
  boundSessionId = sessionId;
}

export function sendChat(text: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: 'chat', text, session_id: boundSessionId }));
  return true;
}
