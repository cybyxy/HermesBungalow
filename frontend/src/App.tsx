import { useState } from 'react';
import { useGameLoop } from './hooks/useGameLoop';
import { BottomMenu } from './ui/BottomMenu';
import { AgentPopup } from './ui/AgentPopup';
import { CareersPopup } from './ui/CareersPopup';
import { TopBar } from './ui/TopBar';
import { ModelUsagePanel } from './ui/ModelUsagePanel';
import { ActivitySpace } from './ui/ActivitySpace';
import { ActivityFeed } from './ui/ActivityFeed';
import { SessionInput } from './ui/SessionInput';

export default function App() {
  useGameLoop();
  const [activeMenu, setActiveMenu] = useState<null | 'agent' | 'careers' | 'archive' | 'system'>(null);

  return (
    <div className="app">
      <TopBar />
      <ModelUsagePanel />
      <ActivitySpace />
      <aside className="right-panel panel">
        <ActivityFeed />
        <div style={{ marginTop: 8 }}>
          <SessionInput />
        </div>
      </aside>

      <footer className="bottom-bar panel">
        <BottomMenu active={activeMenu} onSelect={setActiveMenu} />
      </footer>

      {activeMenu === 'agent' && <AgentPopup onClose={() => setActiveMenu(null)} />}
      {activeMenu === 'careers' && <CareersPopup onClose={() => setActiveMenu(null)} />}
    </div>
  );
}
