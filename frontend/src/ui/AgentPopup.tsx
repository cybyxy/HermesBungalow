import { useMemo, useState } from 'react';
import { useGameState } from '../store/gameState';

type TabKey = 'basic' | 'core' | 'model' | 'skills' | 'gateway';

export function AgentPopup({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('basic');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('zaizai');
  const agents = useGameState((s) => s.agents);
  const cityLordLevel = useGameState((s) => s.cityLordLevel);
  const cityLordPoints = useGameState((s) => s.cityLordPoints);
  const restRoomLevel = useGameState((s) => s.restRoomLevel);
  const serverRoomLevel = useGameState((s) => s.serverRoomLevel);
  const tasks = useGameState((s) => s.tasks);

  const summary = useMemo(() => {
    const total = agents.length || 1;
    const avg = (k: 'energy' | 'quota' | 'socialNeed') =>
      (agents.reduce((acc, cur) => acc + cur[k], 0) / total).toFixed(0);
    return { energy: avg('energy'), quota: avg('quota'), social: avg('socialNeed') };
  }, [agents]);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? agents[0],
    [agents, selectedAgentId]
  );
  const selectedTask = selectedAgent
    ? tasks.find((t) => t.agentId === selectedAgent.id && (t.status === 'queued' || t.status === 'in_progress'))
    : null;

  return (
    <div className="popup-mask" onClick={onClose}>
      <div className="popup-card" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <strong>Agent 面板</strong>
          <span>离线后需求：🍖{summary.energy} ⚡{summary.quota} 💬{summary.social}</span>
          <select
            value={selectedAgent?.id ?? ''}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{ minWidth: 120 }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="popup-tabs">
          <button className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>📋 基本信息</button>
          <button className={tab === 'core' ? 'active' : ''} onClick={() => setTab('core')}>核心文件</button>
          <button className={tab === 'model' ? 'active' : ''} onClick={() => setTab('model')}>⚙️ 模型配置</button>
          <button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>🛠️ 技能系统</button>
          <button className={tab === 'gateway' ? 'active' : ''} onClick={() => setTab('gateway')}>🌐 网关配置</button>
        </div>
        <div className="popup-body">
          {tab === 'basic' && selectedAgent && (
            <div className="popup-grid">
              <div>Agent: {selectedAgent.name} ({selectedAgent.role})</div>
              <div>状态: {selectedAgent.status}</div>
              <div>城主等级：Lv.{cityLordLevel}</div>
              <div>城主积分：{cityLordPoints}</div>
              <div>当前任务：{selectedTask ? `${selectedTask.taskType} (${selectedTask.progress.toFixed(0)}%)` : '无'}</div>
              <div>匹配度：{selectedAgent.roleMatch.toFixed(0)}%</div>
              <div>饱食度：{selectedAgent.energy.toFixed(0)}</div>
              <div>配额：{selectedAgent.quota.toFixed(0)}</div>
              <div>社交需求：{selectedAgent.socialNeed.toFixed(0)}</div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button>分配任务</button>
                <button>进入房间</button>
                <button>开始对话</button>
                <button>设置</button>
              </div>
            </div>
          )}
          {tab === 'core' && (
            <div className="popup-list">
              <div>`frontend/src/store/gameState.ts`</div>
              <div>`frontend/src/services/gameEngine.ts`</div>
              <div>`backend/main.py`</div>
            </div>
          )}
          {tab === 'model' && (
            <div className="popup-list">
              <div>Provider: Hermes Agent Runtime</div>
              <div>模式: WebUI/BFF 流式代理</div>
              <div>默认模型: MiniMax-M2.7-highspeed</div>
              <div>参数: temperature 0.7 / maxTokens 4096 / topP 0.9</div>
              <div>统计: 今日请求次数(示例) 12 / 平均响应 1.3s</div>
            </div>
          )}
          {tab === 'skills' && selectedAgent && (
            <div className="popup-list">
              <div>Agent 技能树</div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                <span>⚡ 效率型</span>
                <progress max={3} value={Math.max(1, Math.round(selectedAgent.roleMatch / 35))} />
                <span>🎯 精准型</span>
                <progress max={3} value={Math.max(1, Math.round(selectedAgent.energy / 35))} />
                <span>💬 社交型</span>
                <progress max={3} value={Math.max(1, Math.round(selectedAgent.socialNeed / 35))} />
              </div>
              <div style={{ marginTop: 8 }}>关系图（简版）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {agents.filter((a) => a.id !== selectedAgent.id).map((a) => (
                  <span key={a.id} className="avatar-chip">{selectedAgent.name} ↔ {a.name}</span>
                ))}
              </div>
            </div>
          )}
          {tab === 'gateway' && (
            <div className="popup-list">
              <div>Hermes Gateway: 已关闭（当前走非-gateway模式）</div>
              <div>MCP Server: 可配置（待接入UI编辑）</div>
              <div>ComfyUI: 192.168.1.3:3000</div>
              <div>外部 API: 通过 Hermes runtime provider 解析</div>
              <div>Webhook: 预留配置入口</div>
              <div>休息室等级: Lv.{restRoomLevel} / 机房等级: Lv.{serverRoomLevel}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
