import { useState, useEffect } from 'react';
import * as Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { DialogBox } from './ui/DialogBox';
import { TimeAwareBackground } from './ui/TimeAwareBackground';
import { ClockDisplay } from './ui/ClockDisplay';
import { useGameState } from './store/gameState';

// 模块级守卫 — 防止 React StrictMode 重复触发欢迎消息
let _welcomeShown = false;

// 崽崽数字小屋主布局
export function App() {
  const addMessage = useGameState((s) => s.addMessage);
  const addCoffee = useGameState((s) => s.addCoffee);
  const isTyping = useGameState((s) => s.isTyping);
  const [activePanel, setActivePanel] = useState<'skills' | 'model' | 'channel' | null>(null);
  const [interactionPopups, setInteractionPopups] = useState<Array<{ id: number; text: string }>>([]);
  const [skillsPanel, setSkillsPanel] = useState<{
    source: string;
    total: number;
    skills: Array<{
      name: string;
      category: string;
      source: string;
      trust: string;
      status: string;
      description: string;
      version: string;
      author: string;
      license: string;
      skill_md_path: string;
    }>;
  } | null>(null);
  const [modelConfig, setModelConfig] = useState<{
    provider: string;
    api_mode: string;
    base_url: string;
    model: string;
    api_key_masked: string;
    config_path?: string;
  } | null>(null);
  const [hermesOverview, setHermesOverview] = useState<{
    cli_ok: boolean;
    cli_version: string;
    memory_provider: string;
    config_path: string;
    skills_count: number;
    model_name: string;
  } | null>(null);
  const [currentModelName, setCurrentModelName] = useState<string>('');
  const [healthCheck, setHealthCheck] = useState<{
    ok: boolean;
    checks: Record<string, { ok: boolean; message: string }>;
  } | null>(null);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [isEditingModelConfig, setIsEditingModelConfig] = useState(false);
  const [isSavingModelConfig, setIsSavingModelConfig] = useState(false);
  const [modelConfigSaveNotice, setModelConfigSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [modelConfigForm, setModelConfigForm] = useState({
    provider: '',
    api_mode: '',
    base_url: '',
    model: '',
    api_key: '',
  });
  const [channelConfig, setChannelConfig] = useState<{
    telegram: { bot_token: string; chat_id: string };
    discord: { bot_token: string; channel_id: string };
    config_path?: string;
  } | null>(null);
  const [isEditingChannelConfig, setIsEditingChannelConfig] = useState(false);
  const [isSavingChannelConfig, setIsSavingChannelConfig] = useState(false);
  const [channelConfigSaveNotice, setChannelConfigSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [channelConfigForm, setChannelConfigForm] = useState({
    telegram_bot_token: '',
    telegram_chat_id: '',
    discord_bot_token: '',
    discord_channel_id: '',
  });

  const pushInteractionPopup = (text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setInteractionPopups((prev) => [...prev.slice(-4), { id, text }]);
    window.setTimeout(() => {
      setInteractionPopups((prev) => prev.filter((p) => p.id !== id));
    }, 4200);
  };

  // 初始化Phaser游戏
  useEffect(() => {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 640,
      height: 260,
      backgroundColor: '#1a1a2e',
      parent: 'game-container',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
      },
      scene: [GameScene],
    };

    const game = new Phaser.Game(config);
    return () => game.destroy(true);
  }, []);

  useEffect(() => {
    const loadOverview = async () => {
      if (useGameState.getState().isTyping) return;
      try {
        const resp = await fetch('/api/hermes/overview');
        if (!resp.ok) return;
        const data = await resp.json();
        setHermesOverview({
          cli_ok: Boolean(data?.cli_ok),
          cli_version: data?.cli_version || '',
          memory_provider: data?.memory_provider || 'unknown',
          config_path: data?.config_path || '',
          skills_count: Number(data?.skills_count || 0),
          model_name: data?.model_name || '',
        });
      } catch {
        // ignore
      }
    };
    const loadCurrentModel = async () => {
      if (useGameState.getState().isTyping) return;
      try {
        const resp = await fetch('/api/hermes/current-model');
        if (!resp.ok) return;
        const data = await resp.json();
        setCurrentModelName(data?.model || '');
      } catch {
        // ignore
      }
    };
    loadOverview();
    loadCurrentModel();
    const timer = window.setInterval(loadOverview, 30000);
    const modelTimer = window.setInterval(loadCurrentModel, 30000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(modelTimer);
    };
  }, [isTyping]);

  useEffect(() => {
    const runHealthCheck = async (silent = true, includeChat = false) => {
      if (useGameState.getState().isTyping) return;
      if (!silent) setHealthCheckLoading(true);
      try {
        const resp = await fetch(`/api/hermes/health-check?include_chat=${includeChat ? 1 : 0}`);
        if (!resp.ok) return;
        setHealthCheck(await resp.json());
      } catch {
        // ignore
      } finally {
        if (!silent) setHealthCheckLoading(false);
      }
    };
    // 启动与后台轮询都使用无 chat 的轻量检查，避免污染 Hermes 会话历史
    runHealthCheck(true, false);
    const timer = window.setInterval(() => runHealthCheck(true, false), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClick = () => {
      addMessage({
        id: Date.now().toString(),
        sender: 'caicai',
        text: '*崽崽歪了歪头*\n有什么可以帮你的吗？💖',
        timestamp: new Date(),
      });
    };
    window.addEventListener('caicai-click', handleClick);
    return () => window.removeEventListener('caicai-click', handleClick);
  }, [addMessage]);

  useEffect(() => {
    const actionLabel: Record<string, string> = {
      type_on_keyboard: '崽崽开始在办公桌前工作',
      search_documents: '崽崽正在翻阅文档',
      drink_coffee: '崽崽正在喝咖啡补充能量',
      wave_hand: '崽崽向你挥手',
      nod_head: '崽崽点了点头',
      shake_head: '崽崽摇了摇头',
      spin: '崽崽开心地转了个圈',
    };

    const onCoffee = () => pushInteractionPopup('物品互动：你给崽崽加了一杯咖啡');
    const onClick = () => pushInteractionPopup('人物互动：你点击了崽崽');
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent).detail as { value?: string };
      if (!detail?.value) return;
      pushInteractionPopup(`人物动作：${actionLabel[detail.value] || detail.value}`);
    };
    const onReply = (e: Event) => {
      const detail = (e as CustomEvent).detail as { reply?: string };
      const text = (detail?.reply || '').trim();
      if (!text) return;
      pushInteractionPopup(`模型回复：${text.slice(0, 38)}${text.length > 38 ? '…' : ''}`);
    };
    const onBookshelfClick = async () => {
      try {
        setActivePanel('skills');
        const resp = await fetch('/api/hermes/skills');
        if (!resp.ok) return;
        const data = await resp.json();
        setSkillsPanel({
          source: data?.source || 'unknown',
          total: Number(data?.total || 0),
          skills: Array.isArray(data?.skills) ? data.skills : [],
        });
      } catch {
        // 静默失败
      }
    };
    const onPrinterClick = async () => {
      try {
        setActivePanel('model');
        const resp = await fetch('/api/hermes/model-config');
        if (!resp.ok) return;
        const data = await resp.json();
        setModelConfig({
          provider: data?.provider || '',
          api_mode: data?.api_mode || '',
          base_url: data?.base_url || '',
          model: data?.model || '',
          api_key_masked: data?.api_key_masked || '',
          config_path: data?.config_path || '',
        });
        setModelConfigForm({
          provider: data?.provider || '',
          api_mode: data?.api_mode || '',
          base_url: data?.base_url || '',
          model: data?.model || '',
          api_key: '',
        });
      } catch {
        // 忽略
      }
    };
    const onPhoneClick = async () => {
      try {
        setActivePanel('channel');
        const resp = await fetch('/api/hermes/channel-config');
        if (!resp.ok) return;
        const data = await resp.json();
        const next = {
          telegram: {
            bot_token: data?.telegram?.bot_token || '',
            chat_id: data?.telegram?.chat_id || '',
          },
          discord: {
            bot_token: data?.discord?.bot_token || '',
            channel_id: data?.discord?.channel_id || '',
          },
          config_path: data?.config_path || '',
        };
        setChannelConfig(next);
        setChannelConfigForm({
          telegram_bot_token: next.telegram.bot_token,
          telegram_chat_id: next.telegram.chat_id,
          discord_bot_token: next.discord.bot_token,
          discord_channel_id: next.discord.channel_id,
        });
      } catch {
        // ignore
      }
    };

    window.addEventListener('add-coffee', onCoffee);
    window.addEventListener('caicai-click', onClick);
    window.addEventListener('caicai-action', onAction);
    window.addEventListener('caicai-chat-reply', onReply);
    window.addEventListener('bookshelf-click', onBookshelfClick);
    window.addEventListener('printer-click', onPrinterClick);
    window.addEventListener('phone-click', onPhoneClick);
    return () => {
      window.removeEventListener('add-coffee', onCoffee);
      window.removeEventListener('caicai-click', onClick);
      window.removeEventListener('caicai-action', onAction);
      window.removeEventListener('caicai-chat-reply', onReply);
      window.removeEventListener('bookshelf-click', onBookshelfClick);
      window.removeEventListener('printer-click', onPrinterClick);
      window.removeEventListener('phone-click', onPhoneClick);
    };
  }, []);

  useEffect(() => {
    const handleCoffee = () => {
      addCoffee();
      addMessage({
        id: Date.now().toString(),
        sender: 'caicai',
        text: '哇！谢谢老板的咖啡！☕\n精神百倍！继续干活！',
        timestamp: new Date(),
      });
    };
    window.addEventListener('add-coffee', handleCoffee);
    return () => window.removeEventListener('add-coffee', handleCoffee);
  }, [addMessage, addCoffee]);

  useEffect(() => {
    const handleWelcome = (e: Event) => {
      if (_welcomeShown) return;
      _welcomeShown = true;
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        addMessage({
          id: 'welcome',
          sender: 'caicai',
          text: detail.message,
          timestamp: new Date(),
        });
      }
    };
    window.addEventListener('caicai-welcome', handleWelcome);
    return () => window.removeEventListener('caicai-welcome', handleWelcome);
  }, [addMessage]);

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* 全局日夜渐变背景（含星空粒子+扫描线+噪点） */}
      <TimeAwareBackground />

      {/* 右上角时钟 */}
      <ClockDisplay />

      <main className="h-full flex overflow-hidden relative z-10">
        {/* 左侧：上弹出交互区 + 下图形化区域 */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* 上部：交互信息区 */}
          <section
            className="h-[30%] w-full relative overflow-hidden shrink-0 flex flex-col"
            style={{
              background: 'linear-gradient(180deg, rgba(19,19,42,0.95) 0%, rgba(13,13,26,0.98) 100%)',
              borderBottom: '1px solid rgba(139,92,246,0.2)',
            }}
          >
            {/* 顶部装饰线 */}
            <div className="h-[2px] bg-gradient-to-r from-transparent via-violet-500/40 to-transparent shrink-0" />

            <div className="flex-1 min-h-0 overflow-auto px-5 py-3">
              {/* 交互弹出标签 */}
              {interactionPopups.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {interactionPopups.map((p) => (
                    <span
                      key={p.id}
                      className="text-[11px] px-3 py-1.5 rounded-full border backdrop-blur-md animate-fade-in"
                      style={{
                        background: 'rgba(139,92,246,0.15)',
                        borderColor: 'rgba(139,92,246,0.4)',
                        color: '#c4b5fd',
                        boxShadow: '0 0 12px rgba(139,92,246,0.2)',
                      }}
                    >
                      {p.text}
                    </span>
                  ))}
                </div>
              )}

              {/* ===== Skills 面板 ===== */}
              {activePanel === 'skills' && skillsPanel && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(8,131,149,0.15) 0%, rgba(13,47,56,0.3) 100%)',
                    border: '1px solid rgba(20,184,166,0.3)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(20,184,166,0.1)',
                  }}
                >
                  <div
                    className="px-4 py-2.5 flex items-center justify-between"
                    style={{ background: 'rgba(20,184,166,0.1)', borderBottom: '1px solid rgba(20,184,166,0.2)' }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-cyan-300">Hermes Skills</span>
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(20,184,166,0.2)', color: '#5eead4', border: '1px solid rgba(20,184,166,0.3)' }}
                      >
                        {skillsPanel.total}
                      </span>
                    </div>
                    <span className="text-[11px] text-cyan-400/60">来源：{skillsPanel.source}</span>
                  </div>
                  <div className="max-h-[200px] overflow-auto p-3">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr style={{ color: 'rgba(20,184,166,0.7)', borderBottom: '1px solid rgba(20,184,166,0.2)' }}>
                          {['Category', 'Name', 'Source', 'Trust', 'Status', 'Description', 'Ver', 'Author'].map((h) => (
                            <th key={h} className="text-left px-2 py-1.5 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {skillsPanel.skills.map((skill, idx) => (
                          <tr
                            key={`${skill.category}-${skill.name}-${idx}`}
                            className="align-top transition-colors hover:bg-cyan-900/10"
                            style={{ borderBottom: '1px solid rgba(20,184,166,0.08)' }}
                          >
                            <td className="px-2 py-1.5 text-yellow-400/90">{skill.category || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-200">{skill.name || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-400">{skill.source || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-400">{skill.trust || '-'}</td>
                            <td className="px-2 py-1.5">
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: skill.status === 'active' ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.15)',
                                  color: skill.status === 'active' ? '#4ade80' : '#94a3b8',
                                }}
                              >
                                {skill.status || '-'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-slate-400 max-w-[200px] truncate">{skill.description || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-400">{skill.version || '-'}</td>
                            <td className="px-2 py-1.5 text-slate-400">{skill.author || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ===== Model Config 面板 ===== */}
              {activePanel === 'model' && modelConfig && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(131,56,115,0.15) 0%, rgba(58,15,65,0.3) 100%)',
                    border: '1px solid rgba(236,72,153,0.3)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    className="px-4 py-2.5 flex items-center justify-between"
                    style={{ background: 'rgba(236,72,153,0.1)', borderBottom: '1px solid rgba(236,72,153,0.2)' }}
                  >
                    <span className="text-sm font-bold text-pink-300">Hermes 模型配置</span>
                    <button
                      type="button"
                      onClick={() => setIsEditingModelConfig((v) => !v)}
                      className="text-[11px] px-3 py-1 rounded-lg border transition-all hover:opacity-90"
                      style={{
                        background: isEditingModelConfig ? 'rgba(239,68,68,0.2)' : 'rgba(236,72,153,0.15)',
                        borderColor: isEditingModelConfig ? 'rgba(239,68,68,0.4)' : 'rgba(236,72,153,0.4)',
                        color: isEditingModelConfig ? '#fca5a5' : '#f9a8d4',
                      }}
                    >
                      {isEditingModelConfig ? '取消' : '编辑'}
                    </button>
                  </div>
                  <div className="p-4">
                    {!isEditingModelConfig ? (
                      <div className="grid grid-cols-2 gap-3 text-[12px]">
                        {[
                          { label: 'Provider', value: modelConfig.provider || '-' },
                          { label: 'API Mode', value: modelConfig.api_mode || '-' },
                          { label: 'Model', value: modelConfig.model || '-' },
                          { label: 'Base URL', value: modelConfig.base_url || '-' },
                          { label: 'API Key', value: modelConfig.api_key_masked || '-' },
                          { label: 'Config', value: modelConfig.config_path || '-' },
                        ].map((item) => (
                          <div key={item.label} className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-pink-400/60 uppercase tracking-wider">{item.label}</span>
                            <span className="text-slate-200 font-mono text-[11px] truncate">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {[
                          { key: 'provider', placeholder: 'provider', value: modelConfigForm.provider },
                          { key: 'api_mode', placeholder: 'api_mode', value: modelConfigForm.api_mode },
                          { key: 'model', placeholder: 'model', value: modelConfigForm.model },
                          { key: 'base_url', placeholder: 'base_url', value: modelConfigForm.base_url },
                          { key: 'api_key', placeholder: 'api_key（留空则不修改）', value: modelConfigForm.api_key },
                        ].map((field) => (
                          <input
                            key={field.key}
                            className="w-full rounded-lg px-3 py-2 text-[12px] border outline-none transition-all focus:ring-2"
                            style={{
                              background: 'rgba(15,15,40,0.8)',
                              borderColor: 'rgba(236,72,153,0.3)',
                              color: '#e2e8f0',
                            }}
                            placeholder={field.placeholder}
                            value={field.value}
                            onChange={(e) => setModelConfigForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          />
                        ))}
                        <button
                          type="button"
                          disabled={isSavingModelConfig}
                          onClick={async () => {
                            setIsSavingModelConfig(true);
                            setModelConfigSaveNotice(null);
                            try {
                              const resp = await fetch('/api/hermes/model-config', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(modelConfigForm),
                              });
                              if (!resp.ok) {
                                setModelConfigSaveNotice({ ok: false, text: '保存失败：接口返回异常' });
                                return;
                              }
                              const saveRes = await resp.json();
                              if (!saveRes?.ok) {
                                const msg = Array.isArray(saveRes?.errors) && saveRes.errors.length > 0
                                  ? `保存失败：${saveRes.errors[0].field} - ${saveRes.errors[0].message}`
                                  : '保存失败：未知错误';
                                setModelConfigSaveNotice({ ok: false, text: msg });
                                return;
                              }
                              const latest = await fetch('/api/hermes/model-config');
                              if (!latest.ok) {
                                setModelConfigSaveNotice({ ok: false, text: '保存成功但刷新配置失败' });
                                return;
                              }
                              const data = await latest.json();
                              setModelConfig({
                                provider: data?.provider || '',
                                api_mode: data?.api_mode || '',
                                base_url: data?.base_url || '',
                                model: data?.model || '',
                                api_key_masked: data?.api_key_masked || '',
                                config_path: data?.config_path || '',
                              });
                              setModelConfigForm((f) => ({ ...f, api_key: '' }));
                              setIsEditingModelConfig(false);
                              setModelConfigSaveNotice({ ok: true, text: '保存成功，已写入 Hermes 配置文件' });
                            } catch {
                              setModelConfigSaveNotice({ ok: false, text: '保存失败：网络或权限异常' });
                            } finally {
                              setIsSavingModelConfig(false);
                            }
                          }}
                          className="w-full mt-2 text-[12px] px-4 py-2 rounded-lg border font-medium transition-all disabled:opacity-50"
                          style={{
                            background: 'linear-gradient(135deg, rgba(236,72,153,0.3), rgba(167,139,250,0.3))',
                            borderColor: 'rgba(236,72,153,0.5)',
                            color: '#f9a8d4',
                          }}
                        >
                          {isSavingModelConfig ? '保存中...' : '保存并写入配置文件'}
                        </button>
                        {modelConfigSaveNotice && (
                          <div
                            className="text-[11px] px-3 py-2 rounded-lg border"
                            style={{
                              background: modelConfigSaveNotice.ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                              borderColor: modelConfigSaveNotice.ok ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
                              color: modelConfigSaveNotice.ok ? '#4ade80' : '#f87171',
                            }}
                          >
                            {modelConfigSaveNotice.text}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ===== Channel 面板 ===== */}
              {activePanel === 'channel' && channelConfig && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(109,40,217,0.15) 0%, rgba(55,15,110,0.3) 100%)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    className="px-4 py-2.5 flex items-center justify-between"
                    style={{ background: 'rgba(139,92,246,0.1)', borderBottom: '1px solid rgba(139,92,246,0.2)' }}
                  >
                    <span className="text-sm font-bold text-violet-300">Hermes Channel 配置</span>
                    <button
                      type="button"
                      onClick={() => setIsEditingChannelConfig((v) => !v)}
                      className="text-[11px] px-3 py-1 rounded-lg border transition-all hover:opacity-90"
                      style={{
                        background: isEditingChannelConfig ? 'rgba(239,68,68,0.2)' : 'rgba(139,92,246,0.15)',
                        borderColor: isEditingChannelConfig ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.4)',
                        color: isEditingChannelConfig ? '#fca5a5' : '#d8b4fe',
                      }}
                    >
                      {isEditingChannelConfig ? '取消' : '编辑'}
                    </button>
                  </div>
                  <div className="p-4">
                    {!isEditingChannelConfig ? (
                      <div className="space-y-4">
                        {[
                          { title: 'Telegram', items: channelConfig.telegram },
                          { title: 'Discord', items: channelConfig.discord },
                        ].map((section) => (
                          <div key={section.title}>
                            <div className="text-[12px] font-semibold text-violet-200 mb-2">{section.title}</div>
                            <div className="grid grid-cols-2 gap-3 text-[11px]">
                              {Object.entries(section.items).map(([k, v]) => (
                                <div key={k} className="flex flex-col gap-0.5">
                                  <span className="text-[10px] text-violet-400/60 uppercase">{k}</span>
                                  <span className="text-slate-200 font-mono truncate">{v || '-'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <div className="text-[10px] text-violet-400/50 pt-2 border-t border-violet-500/10">
                          Config: {channelConfig.config_path || '-'}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {[
                          { key: 'telegram_bot_token', placeholder: 'telegram bot token', value: channelConfigForm.telegram_bot_token },
                          { key: 'telegram_chat_id', placeholder: 'telegram chat id', value: channelConfigForm.telegram_chat_id },
                          { key: 'discord_bot_token', placeholder: 'discord bot token', value: channelConfigForm.discord_bot_token },
                          { key: 'discord_channel_id', placeholder: 'discord channel id', value: channelConfigForm.discord_channel_id },
                        ].map((field) => (
                          <input
                            key={field.key}
                            className="w-full rounded-lg px-3 py-2 text-[12px] border outline-none transition-all"
                            style={{
                              background: 'rgba(15,15,40,0.8)',
                              borderColor: 'rgba(139,92,246,0.3)',
                              color: '#e2e8f0',
                            }}
                            placeholder={field.placeholder}
                            value={field.value}
                            onChange={(e) => setChannelConfigForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          />
                        ))}
                        <button
                          type="button"
                          disabled={isSavingChannelConfig}
                          onClick={async () => {
                            setIsSavingChannelConfig(true);
                            setChannelConfigSaveNotice(null);
                            try {
                              const resp = await fetch('/api/hermes/channel-config', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(channelConfigForm),
                              });
                              if (!resp.ok) {
                                setChannelConfigSaveNotice({ ok: false, text: '保存失败：接口返回异常' });
                                return;
                              }
                              const saveRes = await resp.json();
                              if (!saveRes?.ok) {
                                const msg = Array.isArray(saveRes?.errors) && saveRes.errors.length > 0
                                  ? `保存失败：${saveRes.errors[0].field} - ${saveRes.errors[0].message}`
                                  : '保存失败：未知错误';
                                setChannelConfigSaveNotice({ ok: false, text: msg });
                                return;
                              }
                              const latest = await fetch('/api/hermes/channel-config');
                              if (!latest.ok) {
                                setChannelConfigSaveNotice({ ok: false, text: '保存成功但刷新失败' });
                                return;
                              }
                              const data = await latest.json();
                              setChannelConfig({
                                telegram: { bot_token: data?.telegram?.bot_token || '', chat_id: data?.telegram?.chat_id || '' },
                                discord: { bot_token: data?.discord?.bot_token || '', channel_id: data?.discord?.channel_id || '' },
                                config_path: data?.config_path || '',
                              });
                              setIsEditingChannelConfig(false);
                              setChannelConfigSaveNotice({ ok: true, text: '保存成功，已写入 Hermes channel 配置' });
                            } catch {
                              setChannelConfigSaveNotice({ ok: false, text: '保存失败：网络或权限异常' });
                            } finally {
                              setIsSavingChannelConfig(false);
                            }
                          }}
                          className="w-full mt-2 text-[12px] px-4 py-2 rounded-lg border font-medium transition-all disabled:opacity-50"
                          style={{
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(167,139,250,0.3))',
                            borderColor: 'rgba(139,92,246,0.5)',
                            color: '#d8b4fe',
                          }}
                        >
                          {isSavingChannelConfig ? '保存中...' : '保存 Channel 配置'}
                        </button>
                        {channelConfigSaveNotice && (
                          <div
                            className="text-[11px] px-3 py-2 rounded-lg border"
                            style={{
                              background: channelConfigSaveNotice.ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                              borderColor: channelConfigSaveNotice.ok ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
                              color: channelConfigSaveNotice.ok ? '#4ade80' : '#f87171',
                            }}
                          >
                            {channelConfigSaveNotice.text}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 下部：图形化游戏区域 */}
          <div
            id="game-container"
            className="h-[70%] min-w-0 flex items-end relative"
            style={{
              background: 'linear-gradient(180deg, rgba(13,13,26,0.99) 0%, rgba(19,19,42,0.98) 100%)',
              borderTop: '1px solid rgba(139,92,246,0.15)',
            }}
          >
            {/* 底部装饰渐变 */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
          </div>
        </div>

        {/* 右侧：对话面板 */}
        <div
          className="hidden sm:block w-[40%] lg:w-[30%] xl:w-[30%] shrink-0 self-start h-full"
          style={{ borderLeft: '1px solid rgba(139,92,246,0.2)' }}
        >
          <DialogBox
            healthOk={healthCheckLoading ? null : Boolean(healthCheck?.ok)}
            hermesVersion={hermesOverview?.cli_version}
            modelName={currentModelName || hermesOverview?.model_name}
            serviceStatus={{
              chat: healthCheck?.checks?.chat?.ok ?? null,
              skills: healthCheck?.checks?.skills?.ok ?? null,
              config: healthCheck?.checks?.model_config?.ok ?? null,
            }}
          />
        </div>

        {/* 手机端底部固定对话条 */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
          <DialogBox
            healthOk={healthCheckLoading ? null : Boolean(healthCheck?.ok)}
            hermesVersion={hermesOverview?.cli_version}
            modelName={currentModelName || hermesOverview?.model_name}
            serviceStatus={{
              chat: healthCheck?.checks?.chat?.ok ?? null,
              skills: healthCheck?.checks?.skills?.ok ?? null,
              config: healthCheck?.checks?.model_config?.ok ?? null,
            }}
          />
        </div>
      </main>

      <style>{`
        #game-container canvas {
          width: 100% !important;
          height: 100% !important;
          display: block;
        }
      `}</style>
    </div>
  );
}

export default App;
