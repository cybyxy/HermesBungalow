import type { Agent } from '../types/game';

/** 判断 agent 是否为跨机访客（peer visitor），非本地 Hermes agent。 */
export function isPeerVisitorAgent(a: Pick<Agent, 'bungalow_peer_api' | 'peer_relay_base_url'>): boolean {
  return !!(a.bungalow_peer_api || a.peer_relay_base_url);
}
