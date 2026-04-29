import { useState, useRef, useEffect, useCallback } from 'react';
import { useGameState, type ChatMessage, type ImageData } from '../store/gameState';
import { connectWS, disconnectWS, sendChatMessage, stopChatMessage } from '../services/ws';
import { ChatImagePreview } from './ChatImagePreview';

interface HermesSession {
  id: string;        // frontend alias for session_id
  preview: string;
  created_at: string;
  last_active: string;
  source: string;
}

// Normalize: prefer session_id, fall back to id
function getSessionId(s: HermesSession): string {
  return (s as any).session_id || s.id;
}

// 连接状态指示器配置
const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  open:         { dot: 'bg-emerald-400',   label: '在线' },
  connecting:   { dot: 'bg-amber-400 animate-pulse', label: '连接中...' },
  reconnecting: { dot: 'bg-amber-400 animate-pulse', label: '重连中...' },
  disconnected: { dot: 'bg-red-400',     label: '已断开' },
};

const CAICAI_STATE_LABEL: Record<string, string> = {
  IDLE: '待机',
  THINKING: '思考中',
  WORKING: '工作中',
  TALKING: '对话中',
  SEARCHING: '查找中',
};

// 图片大小限制：2MB
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
// 图片压缩阈值：500KB — 超过则压缩
const COMPRESS_THRESHOLD = 500 * 1024;
// 压缩后最大尺寸
const MAX_DIMENSION = 1920;
// 压缩质量
const COMPRESS_QUALITY = 0.85;
const AVATAR_MAX_DIMENSION = 256;
const AVATAR_COMPRESS_QUALITY = 0.8;
// 能量衰减：正常 8 小时耗尽，工作中为 3 倍
const ENERGY_DRAIN_PER_SEC_IDLE = 100 / (8 * 60 * 60); // 8h from 100 -> 0
const ENERGY_DRAIN_MULTIPLIER_WORKING = 3;

// 待发送图片项
interface PendingImage {
  image: ImageData;
  fileName: string;
}

// 对话框组件 — 崽崽说话气泡 + 聊天输入
interface DialogBoxProps {
  healthOk?: boolean | null;
  hermesVersion?: string;
  modelName?: string;
  serviceStatus?: {
    chat: boolean | null;
    skills: boolean | null;
    config: boolean | null;
  };
}

export function DialogBox({
  healthOk: _healthOk = null,
  hermesVersion,
  modelName,
  serviceStatus = { chat: null, skills: null, config: null },
}: DialogBoxProps) {
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/hermes/sessions');
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const switchToSession = useCallback(async (sid: string) => {
    const store = useGameState.getState();
    store.setSessionId(sid);
    store.clearMessages();
    store.clearThinkingTrace();
    store.setIsTyping(false);
    setSessionsDrawerOpen(false);
    try {
      const resp = await fetch(`/api/hermes/session-history?session_id=${encodeURIComponent(sid)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const rows = Array.isArray(data?.messages) ? data.messages : [];
      const history: ChatMessage[] = rows
        .filter((m: any) => typeof m?.text === 'string' && m.text.trim())
        .map((m: any, idx: number) => ({
          id: String(m.id || `${sid}-${idx}`),
          sender: m.sender === 'user' ? 'user' : 'caicai',
          text: String(m.text || ''),
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
          _streaming: false,
        }));
      store.setMessages(history);
    } catch {
      // ignore
    } finally {
      // 确保切换历史会话后 WS 恢复可用，避免输入框卡在“连接中”
      disconnectWS();
      setTimeout(() => connectWS(), 100);
    }
  }, []);

  const startNewSession = useCallback(() => {
    const store = useGameState.getState();
    store.setSessionId(null);
    store.clearMessages();
    setSessionsDrawerOpen(false);
    disconnectWS();
    setTimeout(() => connectWS(), 100);
  }, []);

  const copySessionId = useCallback(() => {
    const currentSid = useGameState.getState().sessionId;
    if (currentSid) {
      navigator.clipboard.writeText(currentSid).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  }, []);

  const messages = useGameState((s) => s.messages);
  const isTyping = useGameState((s) => s.isTyping);
  const addMessage = useGameState((s) => s.addMessage);
  const clearMessages = useGameState((s) => s.clearMessages);
  const coffeeEnergy = useGameState((s) => s.coffeeEnergy);
  const setIsTyping = useGameState((s) => s.setIsTyping);
  const setExpression = useGameState((s) => s.setExpression);
  const addCoffee = useGameState((s) => s.addCoffee);
  const wsStatus = useGameState((s) => s.wsStatus);
  const caicaiState = useGameState((s) => s.caicaiState);
  const sessionId = useGameState((s) => s.sessionId);
  const userAvatar = useGameState((s) => s.userAvatar);
  const setUserAvatar = useGameState((s) => s.setUserAvatar);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasExhaustedNotifiedRef = useRef(false);
  const energySyncTimerRef = useRef<number | null>(null);

  // 组件挂载时自动连接 WS，卸载时断开
  useEffect(() => {
    connectWS();
    return () => { disconnectWS(); };
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const scheduleEnergySync = useCallback((energy: number) => {
    if (energySyncTimerRef.current) {
      window.clearTimeout(energySyncTimerRef.current);
    }
    energySyncTimerRef.current = window.setTimeout(async () => {
      try {
        await fetch('/api/hermes/energy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ energy }),
        });
      } catch {
        // ignore
      }
    }, 400);
  }, []);

  // 从后端恢复能量值（服务重启后仍可保留）
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await fetch('/api/hermes/energy');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!mounted) return;
        const energy = Number(data?.energy ?? 80);
        useGameState.getState().setCoffeeEnergy(energy);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
      if (energySyncTimerRef.current) {
        window.clearTimeout(energySyncTimerRef.current);
      }
    };
  }, []);

  // ===== 咖啡能量自动衰减 =====
  useEffect(() => {
    const timer = window.setInterval(() => {
      const state = useGameState.getState();
      const currentEnergy = state.coffeeEnergy;
      const working = state.caicaiState === 'WORKING';
      const decay = working
        ? ENERGY_DRAIN_PER_SEC_IDLE * ENERGY_DRAIN_MULTIPLIER_WORKING
        : ENERGY_DRAIN_PER_SEC_IDLE;
      const next = Math.max(0, currentEnergy - decay);

      if (Math.abs(next - currentEnergy) > 0.001) {
        state.setCoffeeEnergy(next);
        scheduleEnergySync(next);
      }

      // 能量耗尽：暂停当前工作，等待加咖啡
      if (next <= 0) {
        if (!hasExhaustedNotifiedRef.current) {
          hasExhaustedNotifiedRef.current = true;
          if (state.isTyping) {
            stopChatMessage();
            state.setIsTyping(false);
          }
          if (state.caicaiState === 'WORKING') {
            state.setCaicaiState('IDLE');
          }
          state.addMessage({
            id: `energy-empty-${Date.now()}`,
            sender: 'caicai',
            text: '⚠️ 崽崽能量耗尽，先暂停工作啦～请点击“加咖啡”补充能量。',
            timestamp: new Date(),
          });
        }
      } else if (next > 5) {
        // 喝咖啡恢复后解除“已提醒”锁
        hasExhaustedNotifiedRef.current = false;
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // ===== 图片压缩 =====
  const compressImage = useCallback(async (dataUrl: string, mimeType: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType, COMPRESS_QUALITY));
      };
      img.src = dataUrl;
    });
  }, []);

  // ===== 图片文件处理 =====
  const processImageFile = async (file: File): Promise<PendingImage> => {
    if (!file.type.startsWith('image/')) {
      throw new Error('仅支持图片格式');
    }
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请选小于2MB的图片`);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = async () => {
          let finalDataUrl = dataUrl;
          if (file.size > COMPRESS_THRESHOLD) {
            finalDataUrl = await compressImage(dataUrl, file.type);
          }
          resolve({
            image: { data_url: finalDataUrl, mime_type: file.type, width: img.width, height: img.height },
            fileName: file.name,
          });
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  };

  // ===== 拖拽上传 =====
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    await addImagesFromFiles(files);
  };

  // ===== 文件选择器 =====
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await addImagesFromFiles(files);
    e.target.value = '';
  };

  const addImagesFromFiles = async (files: File[]) => {
    const newImages: PendingImage[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const result = await processImageFile(file);
        newImages.push(result);
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    if (newImages.length > 0) {
      setPendingImages(prev => [...prev, ...newImages]);
    }
    if (errors.length > 0) {
      alert(`部分图片处理失败：\n${errors.join('\n')}`);
    }
  };

  const handleUserAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件作为头像');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert('头像图片不能超过 2MB');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = String(evt.target?.result || '');
      if (!dataUrl) return;
      // 头像自动压缩：限制到 256px，降低存储占用和渲染开销
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION) {
          const ratio = Math.min(AVATAR_MAX_DIMENSION / width, AVATAR_MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setUserAvatar(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL(file.type || 'image/png', AVATAR_COMPRESS_QUALITY);
        setUserAvatar(compressed);
      };
      img.onerror = () => setUserAvatar(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ===== 粘贴板处理 =====
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map(item => item.getAsFile()).filter((f): f is File => f !== null);
    await addImagesFromFiles(files);
  };

  // ===== 移除单张图片 =====
  const handleRemoveImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  // ===== 发送消息 =====
  const isSendingRef = useRef(false);
  const handleSend = async (prefilledText?: string) => {
    const textToSend = prefilledText ?? inputText.trim();
    if (!textToSend && pendingImages.length === 0) return;
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    try {
      if (wsStatus !== 'open') return;
      const imagesToSend = pendingImages.map(p => p.image);
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'user',
        text: textToSend,
        timestamp: new Date(),
        images: imagesToSend.length > 0 ? imagesToSend : undefined,
      };
      addMessage(userMsg);
      sendChatMessage(textToSend, imagesToSend);
      setInputText('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      setPendingImages([]);
      setIsTyping(true);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleStop = () => {
    if (!isTyping) return;
    stopChatMessage();
    setIsTyping(false);
  };

  const adjustInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const quickActions = [
    { label: '📋 查看PRD', action: () => handleSend('查看PRD') },
    { label: '🚀 了解项目', action: () => handleSend('了解项目') },
    { label: '☕ 加咖啡', action: () => { addCoffee(); handleSend('加杯咖啡'); }},
  ];

  const showWelcome = messages.length === 0;
  const hasThinkingBubble = messages.some((m) => Boolean(m._thinking));

  // 服务状态指示器
  const serviceDotClass = (status: boolean | null) => {
    if (status === true) return 'bg-emerald-400';
    if (status === false) return 'bg-red-400';
    return 'bg-slate-500';
  };

  return (
    <div
      className="h-full flex flex-col relative"
      style={{
        background: 'linear-gradient(180deg, rgba(13,13,26,0.97) 0%, rgba(19,19,42,0.98) 100%)',
        borderLeft: '1px solid rgba(139,92,246,0.25)',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(244,114,182,0.15)', backdropFilter: 'blur(4px)', border: '2px dashed rgba(244,114,182,0.5)', borderRadius: '12px', margin: '8px' }}>
          <div className="text-pink-300 font-bold text-sm flex items-center gap-2">
            <span className="text-lg">🖼️</span> 拖拽图片到这里
          </div>
        </div>
      )}

      {/* ===== 崽崽信息卡 ===== */}
      <div
        className="px-5 pt-4 pb-3 shrink-0"
        style={{
          background: 'linear-gradient(180deg, rgba(88,28,135,0.25) 0%, transparent 100%)',
          borderBottom: '1px solid rgba(139,92,246,0.2)',
        }}
      >
        <input
          ref={userAvatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleUserAvatarSelect}
          className="hidden"
        />
        <div className="flex items-center gap-4">
          {/* 头像 */}
          <div className="relative shrink-0">
            <img
              src={userAvatar}
              alt="崽崽"
              className="w-14 h-14 rounded-2xl border-2 object-contain"
              style={{
                borderColor: 'rgba(244,114,182,0.5)',
                boxShadow: '0 0 20px rgba(244,114,182,0.2), 0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
            {/* 在线状态环 */}
            <div
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px]"
              style={{
                background: 'rgba(13,13,26,0.9)',
                borderColor: 'rgba(139,92,246,0.3)',
              }}
            >
              <div className={`w-2 h-2 rounded-full ${STATUS_CONFIG[wsStatus]?.dot || 'bg-red-400'}`} />
            </div>
          </div>

          {/* 文字信息 */}
          <div className="flex-1 min-w-0">
            {/* 咖啡能量条 */}
            <div className="mb-1.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px]" style={{ color: 'rgba(167,139,250,0.6)' }}>☕</span>
                <span className="text-[9px]" style={{ color: 'rgba(167,139,250,0.5)' }}>能量</span>
                <span className="text-[9px] font-mono" style={{ color: 'rgba(167,139,250,0.7)' }}>{coffeeEnergy.toFixed(1)}%</span>
              </div>
              <div
                className="w-full h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${coffeeEnergy}%`,
                    background: coffeeEnergy > 60
                      ? 'linear-gradient(90deg, #4ade80, #86efac)'
                      : coffeeEnergy > 30
                      ? 'linear-gradient(90deg, #fbbf24, #fcd34d)'
                      : 'linear-gradient(90deg, #f87171, #fca5a5)',
                    boxShadow: coffeeEnergy > 60
                      ? '0 0 6px rgba(74,222,128,0.5)'
                      : coffeeEnergy > 30
                      ? '0 0 6px rgba(251,191,36,0.5)'
                      : '0 0 6px rgba(248,113,113,0.5)',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold" style={{ color: '#f9a8d4' }}>
                崽崽 💖
              </h3>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: 'rgba(139,92,246,0.2)',
                  color: '#c4b5fd',
                  border: '1px solid rgba(139,92,246,0.3)',
                }}
              >
                {CAICAI_STATE_LABEL[caicaiState] || caicaiState}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">软件需求分析师</p>
            {sessionId && (
              <div className="mt-0.5 flex items-center gap-1">
                <span className="text-[9px] text-slate-500">SID:</span>
                <button
                  onClick={copySessionId}
                  className="text-[9px] font-mono text-slate-400 hover:text-slate-200 transition-colors"
                  title="点击复制 session ID"
                >
                  {copied ? '✅ 已复制' : sessionId.slice(0, 12) + '…'}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => userAvatarInputRef.current?.click()}
              className="mt-1 text-[10px] px-2 py-0.5 rounded-lg border"
              style={{
                background: 'rgba(139,92,246,0.12)',
                borderColor: 'rgba(139,92,246,0.25)',
                color: '#c4b5fd',
              }}
            >
              修改我的头像
            </button>
          </div>

          {/* 服务状态标签组 */}
          <div
            className="flex items-center gap-3 px-3 py-1.5 rounded-xl shrink-0"
            style={{
              background: 'rgba(19,19,42,0.8)',
              border: '1px solid rgba(139,92,246,0.2)',
            }}
          >
            {[
              { key: 'chat', label: 'Chat' },
              { key: 'skills', label: 'Skills' },
              { key: 'config', label: 'Config' },
            ].map(({ key, label }) => {
              const status = serviceStatus[key as keyof typeof serviceStatus];
              return (
                <div key={key} className="flex items-center gap-1.5 text-[9px] text-slate-300" title={label}>
                  <div className={`w-1.5 h-1.5 rounded-full ${serviceDotClass(status)}`}
                    style={{ boxShadow: status === true ? '0 0 4px rgba(74,222,128,0.6)' : 'none' }} />
                  <span className="hidden sm:inline">{label}</span>
                </div>
              );
            })}
          </div>

          {/* 会话管理按钮 */}
          <button
            onClick={() => { fetchSessions(); setSessionsDrawerOpen(true); }}
            className="px-3 py-1.5 rounded-xl text-[9px] shrink-0 transition-all hover:scale-105 active:scale-95"
            style={{
              background: sessionsDrawerOpen ? 'rgba(139,92,246,0.3)' : 'rgba(19,19,42,0.8)',
              border: `1px solid ${sessionsDrawerOpen ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.2)'}`,
              color: sessionsDrawerOpen ? '#c4b5fd' : '#94a3b8',
            }}
            title="会话历史"
          >
            📋 会话
          </button>
        </div>

        {/* 表情切换 */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {[
            { key: 'happy', label: '😀 开心', color: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.3)', text: '#86efac' },
            { key: 'thinking', label: '🤔 思考', color: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.3)', text: '#fcd34d' },
            { key: 'sweat', label: '💧 流汗', color: 'rgba(103,232,249,0.15)', border: 'rgba(103,232,249,0.3)', text: '#a5f3fc' },
            { key: 'cry', label: '😭 哭泣', color: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.3)', text: '#fca5a5' },
          ].map((expr) => (
            <button
              key={expr.key}
              onClick={() => setExpression(expr.key as any)}
              className="text-[10px] px-3 py-1.5 rounded-lg border transition-all hover:scale-105 active:scale-95"
              style={{
                background: expr.color,
                borderColor: expr.border,
                color: expr.text,
              }}
            >
              {expr.label}
            </button>
          ))}
        </div>

        {sessionId && (
          <div className="mt-2 text-[9px] text-slate-600 font-mono truncate">
            Session: {sessionId}
          </div>
        )}

        {/* Hermes 版本 + 当前模型 — 始终展示，占位待填充 */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div
            className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg"
            style={{
              background: 'rgba(139,92,246,0.12)',
              border: '1px solid rgba(139,92,246,0.25)',
              color: '#a78bfa',
            }}
          >
            <span>🦉</span>
            <span className="font-mono">Hermes Agent {hermesVersion || 'v--'}</span>
          </div>
          <div
            className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg"
            style={{
              background: 'rgba(236,72,153,0.12)',
              border: '1px solid rgba(236,72,153,0.25)',
              color: '#f9a8d4',
            }}
          >
            <span>🤖</span>
            <span className="font-mono truncate max-w-[200px]">{modelName || '--'}</span>
          </div>
        </div>
      </div>

      {/* ===== 聊天区域 ===== */}
      <div
        ref={chatAreaRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {/* 聊天头部：清空按钮 */}
        <div className="flex justify-end mb-1">
          {messages.length > 0 && (
            <button
              onClick={() => clearMessages()}
              className="text-[9px] px-2 py-1 rounded-md border transition-all hover:scale-105 active:scale-95"
              style={{
                background: 'rgba(248,113,113,0.1)',
                borderColor: 'rgba(248,113,113,0.25)',
                color: 'rgba(248,113,113,0.7)',
              }}
              title="清空对话"
            >
              🗑️ 清空
            </button>
          )}
        </div>

        {showWelcome && (
          <div className="text-center py-10 animate-fade-in">
            <div className="text-5xl mb-4">👋</div>
            <p className="text-sm font-bold mb-1" style={{ color: '#f9a8d4' }}>你好！我是崽崽</p>
            <p className="text-[11px] text-slate-400 mb-1">软件需求分析师</p>
            <p className="text-[11px] text-slate-500">有什么可以帮你的吗？</p>
            {/* 欢迎提示快捷操作 */}
            <div className="flex gap-2 justify-center mt-4 flex-wrap">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  onClick={qa.action}
                  disabled={wsStatus !== 'open'}
                  className="text-[10px] px-3 py-2 rounded-lg border transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: 'rgba(139,92,246,0.1)',
                    borderColor: 'rgba(139,92,246,0.3)',
                    color: '#c4b5fd',
                  }}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isCaicai = msg.sender === 'caicai';
          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}
            >
              {/* 头像 */}
              {!isUser && (
                <img
                  src={userAvatar}
                  alt="崽崽"
                  className="w-7 h-7 rounded-lg object-contain flex-shrink-0 mt-0.5"
                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                />
              )}

              <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
                {/* 多图消息 */}
                {msg.images && msg.images.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${isUser ? 'justify-end' : ''}`}>
                    {msg.images.map((img, i) => (
                      <img
                        key={i}
                        src={img.data_url}
                        alt={`图片${i + 1}`}
                        className="max-w-[180px] max-h-40 rounded-xl object-contain border"
                        style={{
                          borderColor: isUser ? 'rgba(244,114,182,0.4)' : 'rgba(139,92,246,0.3)',
                          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* 文字气泡 */}
                {msg.text && (
                  <div
                    className="text-[12px] leading-relaxed px-4 py-2.5"
                    style={{
                      background: isUser
                        ? 'linear-gradient(135deg, rgba(236,72,153,0.35) 0%, rgba(167,139,250,0.35) 100%)'
                        : msg._thinking
                        ? 'rgba(30,41,59,0.8)'
                        : 'rgba(139,92,246,0.12)',
                      border: `1px solid ${isUser ? 'rgba(236,72,153,0.55)' : 'rgba(139,92,246,0.25)'}`,
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      color: isUser ? '#fce7f3' : isCaicai ? '#e2e8f0' : '#cbd5e1',
                      fontStyle: msg._thinking ? 'italic' : 'normal',
                      boxShadow: isUser
                        ? '0 4px 16px rgba(236,72,153,0.25), 0 2px 8px rgba(0,0,0,0.25)'
                        : '0 2px 8px rgba(0,0,0,0.2)',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.text.split('\n').map((line, i) => (
                      <span key={i}>{line}<br /></span>
                    ))}
                  </div>
                )}
              </div>

              {/* 用户头像 */}
              {isUser && (
                <img
                  src={userAvatar}
                  alt="我的头像"
                  className="w-7 h-7 rounded-lg object-cover flex-shrink-0 mt-0.5"
                  style={{
                    border: '1px solid rgba(236,72,153,0.4)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    background: 'rgba(19,19,42,0.8)',
                  }}
                />
              )}
            </div>
          );
        })}

        {/* 打字指示器 */}
        {isTyping && !hasThinkingBubble && (
          <div className="flex gap-2.5 animate-fade-in">
            <img
              src={userAvatar}
              alt="崽崽"
              className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
            />
            <div
              className="px-4 py-3 rounded-2xl rounded-tl-none"
              style={{
                background: 'rgba(139,92,246,0.1)',
                border: '1px solid rgba(139,92,246,0.2)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-300">崽崽正在思考</span>
                <div className="flex items-center gap-0.5 ml-1">
                  {[0, 150, 300].map((delay) => (
                    <div
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: '#a78bfa',
                        animation: `bounce 1.2s ease-in-out ${delay}ms infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== 快捷操作 ===== */}
      <div
        className="px-4 py-2 flex gap-2 flex-wrap shrink-0"
        style={{ borderTop: '1px solid rgba(139,92,246,0.12)' }}
      >
        {quickActions.map((qa) => (
          <button
            key={qa.label}
            onClick={qa.action}
            disabled={wsStatus !== 'open'}
            className="text-[10px] px-3 py-1.5 rounded-lg border transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(139,92,246,0.08)',
              borderColor: 'rgba(139,92,246,0.25)',
              color: '#a78bfa',
            }}
          >
            {qa.label}
          </button>
        ))}
      </div>

      {/* ===== 多图预览 ===== */}
      {pendingImages.length > 0 && (
        <ChatImagePreview images={pendingImages} onRemove={handleRemoveImage} />
      )}

      {/* ===== 输入区域 ===== */}
      <div
        className="p-4 pt-2 shrink-0"
        style={{ borderTop: '1px solid rgba(139,92,246,0.15)' }}
      >
        <div
          className="flex gap-2 items-end rounded-2xl px-1 py-1.5"
          style={{
            background: 'rgba(19,19,42,0.9)',
            border: '1px solid rgba(139,92,246,0.25)',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
          }}
        >
          {/* 图片选择 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={wsStatus !== 'open'}
            className="p-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-40 shrink-0"
            style={{
              background: 'rgba(139,92,246,0.12)',
              border: '1px solid rgba(139,92,246,0.2)',
              color: '#a78bfa',
            }}
            title="选择图片（也可直接拖拽或 Ctrl+V 粘贴）"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>

          {/* 输入框 */}
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={handlePaste}
            onInput={adjustInputHeight}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={wsStatus !== 'open' ? '连接中...' : '跟崽崽说点什么...'}
            disabled={wsStatus !== 'open'}
            rows={1}
            className="flex-1 text-[12px] px-3 py-2 bg-transparent text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-40 rounded-lg resize-none overflow-y-auto"
            style={{ minWidth: 0, maxHeight: 180 }}
          />

          {/* 发送/停止按钮 */}
          <button
            onClick={() => isTyping ? handleStop() : handleSend()}
            disabled={wsStatus !== 'open' || (!isTyping && !inputText.trim() && pendingImages.length === 0)}
            className="p-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            style={{
              background: isTyping
                ? 'rgba(100,116,139,0.3)'
                : 'linear-gradient(135deg, rgba(236,72,153,0.4), rgba(167,139,250,0.4))',
              border: `1px solid ${isTyping ? 'rgba(100,116,139,0.4)' : 'rgba(244,114,182,0.4)'}`,
              color: isTyping ? '#94a3b8' : '#fce7f3',
              boxShadow: !isTyping ? '0 0 16px rgba(244,114,182,0.2)' : 'none',
            }}
            title={isTyping ? '停止当前推理' : '发送消息'}
          >
            {isTyping ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>

        {/* 提示文字 */}
        <div className="text-[9px] text-slate-600 mt-1.5 px-1 text-center">
          {wsStatus === 'open' ? '支持拖拽图片 · Ctrl+V 粘贴 · Enter 发送' : '正在连接崽崽...'}
        </div>
      </div>

      {/* ===== 会话列表抽屉 ===== */}
      {sessionsDrawerOpen && (
        <div
          className="absolute inset-0 z-50 flex"
          onClick={(e) => { if (e.target === e.currentTarget) setSessionsDrawerOpen(false); }}
        >
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* 抽屉 */}
          <div
            className="relative ml-auto w-72 h-full flex flex-col"
            style={{
              background: 'linear-gradient(180deg, rgba(20,15,40,0.98) 0%, rgba(10,8,25,0.98) 100%)',
              borderLeft: '1px solid rgba(139,92,246,0.3)',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
            }}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: '1px solid rgba(139,92,246,0.2)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: '#c4b5fd' }}>📋</span>
                <span className="text-sm font-bold" style={{ color: '#e9d5ff' }}>会话历史</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startNewSession}
                  className="text-[10px] px-2.5 py-1 rounded-lg border transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: 'rgba(139,92,246,0.2)',
                    borderColor: 'rgba(139,92,246,0.4)',
                    color: '#c4b5fd',
                  }}
                >
                  + 新会话
                </button>
                <button
                  onClick={() => setSessionsDrawerOpen(false)}
                  className="text-slate-400 hover:text-white transition-colors text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-slate-500 text-xs">加载中...</div>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-2xl mb-2">💬</div>
                  <div className="text-slate-500 text-xs">暂无会话记录</div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sessions.map((s) => {
                    const sid = getSessionId(s);
                    const isCurrentSession = sid === sessionId;
                    return (
                      <button
                        key={sid}
                        onClick={() => isCurrentSession ? setSessionsDrawerOpen(false) : switchToSession(sid)}
                        className="w-full text-left px-3 py-2.5 rounded-xl border transition-all hover:scale-[1.02] active:scale-[0.98]"
                        style={{
                          background: isCurrentSession ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.08)',
                          borderColor: isCurrentSession ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.15)',
                        }}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] font-mono" style={{ color: isCurrentSession ? '#c4b5fd' : '#94a3b8' }}>
                            {sid.slice(0, 16)}…
                          </span>
                          {isCurrentSession && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(139,92,246,0.4)', color: '#e9d5ff' }}>
                              当前
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {s.preview || '（空会话）'}
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">
                          {s.last_active || s.created_at}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
