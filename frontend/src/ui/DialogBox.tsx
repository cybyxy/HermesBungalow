import { useState, useRef, useEffect, useCallback } from 'react';
import { useGameState, type ChatMessage, type ImageData } from '../store/gameState';
import { connectWS, disconnectWS, sendChatMessage } from '../services/ws';
import { ChatImagePreview } from './ChatImagePreview';

// 连接状态指示器配置
const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  open:         { dot: 'bg-green-400',   label: '在线' },
  connecting:   { dot: 'bg-blue-400 animate-pulse', label: '连接中...' },
  reconnecting: { dot: 'bg-yellow-400 animate-pulse', label: '重连中...' },
  disconnected: { dot: 'bg-red-400',     label: '已断开' },
};

// 图片大小限制：2MB
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
// 图片压缩阈值：500KB — 超过则压缩
const COMPRESS_THRESHOLD = 500 * 1024;
// 压缩后最大尺寸
const MAX_DIMENSION = 1920;
// 压缩质量
const COMPRESS_QUALITY = 0.85;

// 待发送图片项
interface PendingImage {
  image: ImageData;
  fileName: string;
}

// 对话框组件 — 崽崽说话气泡 + 聊天输入
export function DialogBox() {
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const messages = useGameState((s) => s.messages);
  const isTyping = useGameState((s) => s.isTyping);
  const addMessage = useGameState((s) => s.addMessage);
  const setIsTyping = useGameState((s) => s.setIsTyping);
  const setExpression = useGameState((s) => s.setExpression);
  const addCoffee = useGameState((s) => s.addCoffee);
  const wsStatus = useGameState((s) => s.wsStatus);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ========================
  // 图片压缩
  // ========================
  const compressImage = useCallback(async (dataUrl: string, mimeType: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // 等比缩放
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

  // ========================
  // 图片文件处理 — 转 base64 + 获取尺寸 + 压缩
  // ========================
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
          // 超过压缩阈值则压缩
          if (file.size > COMPRESS_THRESHOLD) {
            console.log(`[Image] 图片 ${file.name} (${(file.size / 1024).toFixed(0)}KB) > ${COMPRESS_THRESHOLD / 1024}KB，执行压缩`);
            finalDataUrl = await compressImage(dataUrl, file.type);
          }
          resolve({
            image: {
              data_url: finalDataUrl,
              mime_type: file.type,
              width: img.width,
              height: img.height,
            },
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

  // ========================
  // 拖拽上传
  // ========================
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

  // ========================
  // 文件选择器
  // ========================
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

  // ========================
  // 粘贴板处理 — 支持多图
  // ========================
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length === 0) return;

    e.preventDefault();

    const files = imageItems
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null);

    await addImagesFromFiles(files);
  };

  // ========================
  // 移除单张图片
  // ========================
  const handleRemoveImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  // ========================
  // 发送消息
  // ========================
  // 发送锁 — 防止 React re-render 或快速点击导致重复发送
  const isSendingRef = useRef(false);

  const handleSend = async (prefilledText?: string) => {
    const textToSend = prefilledText ?? inputText.trim();
    if (!textToSend && pendingImages.length === 0) return;
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    try {
      if (wsStatus !== 'open') {
        console.warn('[DialogBox] WS not connected, cannot send');
        return;
      }

      const imagesToSend = pendingImages.map(p => p.image);

      // 用户消息
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'user',
        text: textToSend,
        timestamp: new Date(),
        images: imagesToSend.length > 0 ? imagesToSend : undefined,
      };
      addMessage(userMsg);

      // 通过 WS 发送消息（支持多图）
      sendChatMessage(textToSend, imagesToSend);

      setInputText('');
      setPendingImages([]);
      setIsTyping(true);
    } finally {
      isSendingRef.current = false;
    }
  };

  const quickActions = [
    { label: '📋 查看PRD', action: () => handleSend('查看PRD') },
    { label: '🚀 了解项目', action: () => handleSend('了解项目') },
    { label: '☕ 加咖啡', action: () => {
      addCoffee();
      handleSend('加杯咖啡');
    }},
  ];

  const showWelcome = messages.length === 0;

  return (
    <div
      className={`h-full bg-gray-900/95 border-l-4 border-indigo-900 flex flex-col relative ${isDragOver ? 'ring-2 ring-pink-500 ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 z-20 bg-pink-900/30 flex items-center justify-center pointer-events-none">
          <div className="text-pink-400 font-bold text-sm">📋 拖拽图片到这里</div>
        </div>
      )}

      {/* 崽崽信息卡 */}
      <div className="p-4 bg-gradient-to-b from-purple-900/50 to-transparent border-b-2 border-indigo-900">
        <div className="flex items-center gap-3 mb-3">
          <img
            src="/assets/sprites/expression1.png"
            alt="崽崽"
            className="w-14 h-14 rounded-lg border-2 border-pink-500 object-contain bg-gray-800"
          />
          <div>
            <h3 className="text-xs text-yellow-400 font-bold">崽崽 💖</h3>
            <p className="text-[10px] text-gray-400">软件需求分析师 | 在线</p>
          </div>

          <div className={`ml-auto flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-800/60 border border-gray-700`}>
            <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[wsStatus]?.dot || 'bg-red-400'}`}></span>
            <span className="text-[9px] text-gray-300">{STATUS_CONFIG[wsStatus]?.label || '已断开'}</span>
          </div>
        </div>

        {/* 表情切换 */}
        <div className="flex gap-1 flex-wrap">
          {['happy', 'thinking', 'sweat', 'cry'].map((expr) => (
            <button
              key={expr}
              onClick={() => setExpression(expr as any)}
              className="text-[8px] px-2 py-1 bg-indigo-900/50 text-gray-400 border border-indigo-700 rounded hover:bg-pink-600 hover:text-white transition-colors"
            >
              {expr === 'happy' ? '😀开心' : expr === 'thinking' ? '🤔思考' : expr === 'sweat' ? '💧流汗' : '😭哭泣'}
            </button>
          ))}
        </div>
      </div>

      {/* 聊天区域 */}
      <div ref={chatAreaRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {showWelcome && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">👋</div>
            <p className="text-xs text-yellow-400 font-bold mb-1">你好！我是崽崽</p>
            <p className="text-[10px] text-gray-400 mb-1">软件需求分析师</p>
            <p className="text-[10px] text-gray-500">有什么可以帮你的吗？</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
            <img
              src="/assets/sprites/expression1.png"
              alt="avatar"
              className="w-6 h-6 rounded object-contain flex-shrink-0"
            />
            <div>
              {/* 多图消息气泡渲染 */}
              {msg.images && msg.images.length > 0 && (
                <div className={`flex flex-wrap gap-1 mb-1 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                  {msg.images.map((img, i) => (
                    <img
                      key={i}
                      src={img.data_url}
                      alt={`图片${i + 1}`}
                      className={`max-w-full max-h-40 rounded-lg object-contain border ${
                        msg.sender === 'user'
                          ? 'border-pink-500/50'
                          : 'border-indigo-700/50'
                      }`}
                    />
                  ))}
                </div>
              )}
              {/* 兼容单图 */}
              {msg.image && !msg.images && (
                <img
                  src={msg.image.data_url}
                  alt="图片消息"
                  className={`max-w-full max-h-48 rounded-lg mb-1 object-contain border ${
                    msg.sender === 'user'
                      ? 'border-pink-500/50'
                      : 'border-indigo-700/50'
                  }`}
                />
              )}

              {msg.text && (
                <div
                  className={`text-[10px] leading-relaxed p-2 rounded-lg max-w-[85%] ${
                    msg.sender === 'caicai'
                      ? 'bg-indigo-900/60 text-gray-100 rounded-tl-none'
                      : 'bg-pink-600 text-white rounded-tr-none'
                  }`}
                >
                  {msg.text.split('\n').map((line, i) => (
                    <span key={i}>{line}<br /></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 打字指示器 */}
        {isTyping && (
          <div className="flex gap-2">
            <img src="/assets/sprites/expression1.png" alt="avatar" className="w-6 h-6 rounded object-contain flex-shrink-0" />
            <div className="text-[10px] text-gray-400 p-3 bg-indigo-900/30 rounded-lg">
              <span>崽崽正在思考</span>
              <span className="inline-flex gap-1 ml-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 快捷操作 */}
      <div className="flex gap-1 p-2 flex-wrap">
        {quickActions.map((qa) => (
          <button
            key={qa.label}
            onClick={qa.action}
            disabled={wsStatus !== 'open'}
            className="text-[8px] px-3 py-2 bg-indigo-900/50 text-gray-400 border border-indigo-700 rounded hover:bg-pink-600 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {qa.label}
          </button>
        ))}
      </div>

      {/* 多图预览区域 */}
      {pendingImages.length > 0 && (
        <ChatImagePreview
          images={pendingImages}
          onRemove={handleRemoveImage}
        />
      )}

      {/* 输入框 + 图片选择按钮 */}
      <div className="flex gap-2 p-3 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* 图片选择按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={wsStatus !== 'open'}
          className="px-2 py-2 bg-indigo-900/50 text-gray-400 border border-indigo-700 rounded hover:bg-pink-600 hover:text-white transition-colors disabled:opacity-40 flex-shrink-0"
          title="选择图片（也可直接拖拽或 Ctrl+V 粘贴）"
        >
          🖼️
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={wsStatus !== 'open' ? '连接中...' : '跟崽崽说点什么...（支持拖拽/粘贴图片）'}
          disabled={wsStatus !== 'open'}
          className="flex-1 text-[10px] px-3 py-2 bg-indigo-900/50 border-2 border-indigo-700 text-gray-100 rounded focus:border-pink-500 outline-none placeholder:text-gray-600 disabled:opacity-40"
        />
        <button
          onClick={() => handleSend()}
          disabled={wsStatus !== 'open' || (!inputText.trim() && pendingImages.length === 0)}
          className="px-4 py-2 bg-pink-600 text-white rounded hover:bg-pink-500 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
