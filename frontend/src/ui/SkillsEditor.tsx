import { useEffect, useState } from 'react';
import type { Agent } from '../types/game';
import * as gameApi from '../services/gameApi';
import { colors, studioGlass } from './theme';

interface SkillInfo {
  name: string;
  description: string;
  category: string;
}

export function SkillsEditor(props: { agent: Agent; onUpdated: () => void }) {
  const { agent } = props;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [grouped, setGrouped] = useState<Record<string, SkillInfo[]>>({});

  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const data = await gameApi.getAgentProfileFiles(agent.id);
        if (!cancelled) {
          const list: SkillInfo[] = (data as Record<string, unknown>).skills as SkillInfo[] ?? [];
          setSkills(list);
          const grp: Record<string, SkillInfo[]> = {};
          for (const s of list) {
            const cat = s.category || '其他';
            if (!grp[cat]) grp[cat] = [];
            grp[cat].push(s);
          }
          setGrouped(grp);
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agent?.id]);

  if (busy) {
    return <div style={{ color: '#888', fontSize: 11, padding: 8 }}>加载技能列表…</div>;
  }

  if (skills.length === 0) {
    return <div style={{ color: '#666', fontSize: 11, padding: 8 }}>未找到已安装的技能。</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <div style={{ color: colors.gold, fontSize: 10, marginBottom: 4, fontWeight: 'bold' }}>{cat}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {items.map((s) => (
              <div
                key={`${cat}/${s.name}`}
                style={{
                  ...studioGlass.inset,
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: `1px solid ${colors.border}`,
                }}
              >
                <span style={{ color: '#ddd' }}>{s.name}</span>
                {s.description && (
                  <span style={{ color: '#666', fontSize: 9, marginLeft: 8 }}>{s.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
