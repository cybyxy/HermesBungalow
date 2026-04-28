import { useState, useEffect } from 'react';
import * as Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { DialogBox } from './ui/DialogBox';
import { Sidebar, DocumentWall, ToolShelf, Showcase } from './ui/Sidebar';
import { useGameState } from './store/gameState';

// 模块级守卫 — 防止 React StrictMode 重复触发欢迎消息
let _welcomeShown = false;

// 崽崽数字小屋主布局
export function App() {
  const [activeTab, setActiveTab] = useState('home');
  const addMessage = useGameState((s) => s.addMessage);

  // 初始化Phaser游戏
  useEffect(() => {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 640,
      height: 360,
      backgroundColor: '#1a1a2e',
      parent: 'game-container',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [GameScene],
    };

    const game = new Phaser.Game(config);

    return () => game.destroy(true);
  }, []);

  // 监听崽崽点击事件
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

  // 监听加咖啡事件
  useEffect(() => {
    const handleCoffee = () => {
      addMessage({
        id: Date.now().toString(),
        sender: 'caicai',
        text: '哇！谢谢老板的咖啡！☕\n精神百倍！继续干活！',
        timestamp: new Date(),
      });
    };

    window.addEventListener('add-coffee', handleCoffee);
    return () => window.removeEventListener('add-coffee', handleCoffee);
  }, [addMessage]);

  // 监听崽崽欢迎消息 (迎宾动画完成后)
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

  // Tab切换处理 — 非home时显示对应覆盖层
  const showDocs = activeTab === 'docs';
  const showTools = activeTab === 'tools';
  const showShowcase = activeTab === 'showcase';

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="bg-gradient-to-r from-purple-900/80 to-indigo-900/80 border-b-4 border-pink-600 px-5 py-2 flex items-center justify-between shrink-0">
        <h1 className="text-[10px] text-yellow-400 font-bold">🏠 崽崽的数字小屋 v1.3</h1>
        <div className="flex gap-4 text-[8px] text-gray-400">
          <span><span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>GATEWAY ONLINE</span>
          <span>状态: 在线</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left: Phaser Game Canvas — 响应式自适应 */}
        <div id="game-container" className="flex-1 bg-gray-900 min-w-0" />

        {/* Right: Dialog Panel — 响应式：30%桌面 / 40%平板 / 45%手机 / 固定min-width */}
        <div className="hidden sm:block w-[40%] lg:w-[30%] xl:w-[30%] shrink-0">
          <DialogBox />
        </div>
        {/* 手机端底部固定对话条 */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
          <DialogBox />
        </div>

        {/* Sidebar Navigation — 绝对定位浮在上面 */}
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Overlays */}
        {showDocs && <DocumentWall onClose={() => setActiveTab('home')} />}
        {showTools && <ToolShelf onClose={() => setActiveTab('home')} />}
        {showShowcase && <Showcase onClose={() => setActiveTab('home')} />}
      </main>

      {/* Bottom Bar */}
      <footer className="bg-gray-900 border-t-4 border-indigo-900 px-5 py-1 flex justify-between text-[8px] text-gray-500 shrink-0">
        <span>引擎: Phaser.js + React | 崽崽状态机: IDLE → TALKING</span>
        <span>Hermes Gateway API Server © 2026</span>
      </footer>
    </div>
  );
}

export default App;
