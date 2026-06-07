import { useState, useEffect, useRef } from 'react';
import * as gameApi from '../services/gameApi';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { postLordCreateTask } from '../services/chatApi';
import { appendOrchestratedInference } from '../chat/orchestrationUi';
import { colors } from './theme';

interface NewTaskPanelProps {
  onClose: () => void;
}

export function NewTaskPanel({ onClose }: NewTaskPanelProps) {
  const [name, setName] = useState('新任务');
  const [desc, setDesc] = useState('');
  const [userSkillExcerpt, setUserSkillExcerpt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; content: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busyStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const loadState = useTaskStore((s) => s.loadState);

  const removeUploadedFile = (fname: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== fname));
    setUserSkillExcerpt((prev) => {
      const marker = `\n\n---\n\n【上传文档：${fname}】\n`;
      const idx = prev.indexOf(marker);
      if (idx === -1) return prev;
      const end = prev.indexOf('\n\n---\n\n', idx + marker.length);
      if (end === -1) return prev.slice(0, idx);
      return prev.slice(0, idx) + prev.slice(end);
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        setUploadedFiles((prev) => [...prev, { name: f.name, content: text }]);
        setUserSkillExcerpt((prev) => {
          const sep = prev.trim() ? '\n\n---\n\n' : '';
          return prev + sep + `【上传文档：${f.name}】\n${text.slice(0, 30000)}`;
        });
      };
      reader.readAsText(f);
    }
    e.target.value = '';
  };

  const onCreateTask = async () => {
    setBusy(true);
    setToast(null);
    busyStartRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - busyStartRef.current) / 1000));
    }, 1000);
    try {
      const result = await postLordCreateTask({
        name: name.trim() || '新任务',
        description: desc.trim(),
        required_profession: '',
        difficulty: 2,
        reward: 100,
        user_skill_excerpt: userSkillExcerpt.trim() || undefined,
      });
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      // Push orchestration conversation to RightPanel
      const snapshot = useTaskStore.getState().snapshot;
      const lordAgent = snapshot?.agents.find(a =>
        a.profession === '城主' || a.profile === 'default' || a.profile === '崽崽'
      );
      if (lordAgent) {
        appendOrchestratedInference(snapshot, lordAgent.id, result);
        if ((result as any).dispatch) {
          appendOrchestratedInference(snapshot, lordAgent.id, (result as any).dispatch);
        }
      }
      await loadState();
      if (!result.ok) {
        setToast(result.error || '城主处理失败');
        return;
      }
      // 检查是否成功创建了任务链
      const fresh = useTaskStore.getState().snapshot;
      const hasNewTasks = (fresh?.tasks || []).length > (snapshot?.tasks || []).length;
      if (hasNewTasks || (result as any).primary?.reply) {
        onClose();
      } else {
        setToast('城主已收到请求，请在右侧面板查看回复');
      }
    } catch (e) {
      setToast((e as Error).message);
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setBusy(false);
  };

  const input: React.CSSProperties = {
    width: '100%', padding: 8, background: '#0a0a15', color: '#fff',
    border: `1px solid ${colors.border}`, borderRadius: 4, boxSizing: 'border-box',
    fontSize: 12, fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>名称</label>
        <input value={name} onChange={e => setName(e.target.value)} style={input} />
      </div>
      <div>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>任务描述</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="描述任务内容（职业由主 Agent 自动分析确认）"
          rows={3} style={{ ...input, resize: 'vertical' }} />
      </div>
      <div>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>
          上传项目文档（可选，支持 .md .txt）
        </label>
        <input type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" multiple
          onChange={handleFileUpload} style={{ color: '#aaa', fontSize: 11, marginBottom: 8 }} />
        {uploadedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {uploadedFiles.map((f) => (
              <span key={f.name} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 3,
                background: '#1a3a2a', color: '#8fbc8f', fontSize: 10,
              }}>
                📄 {f.name}
                <button type="button" onClick={() => removeUploadedFile(f.name)}
                  style={{ border: 'none', background: 'transparent', color: '#f66', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>
          补充说明（可选）
        </label>
        <textarea value={userSkillExcerpt} onChange={e => setUserSkillExcerpt(e.target.value)}
          placeholder="可粘贴额外的分析要点或 SKILL 摘录；上传文档内容会自动拼接至此。留空则由主 Agent 自行分析。"
          rows={3} style={{ ...input, resize: 'vertical', fontSize: 11 }} />
      </div>
      {busy && (
        <div style={{ color: '#9aa', fontSize: 10, textAlign: 'center' }}>
          城主正在分析需求、与团队成员沟通并创建任务链，请耐心等待（通常 30~90 秒）
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}
          style={{ padding: '6px 16px', background: 'transparent', color: busy ? '#555' : colors.text, border: `1px solid ${busy ? '#333' : colors.border}`, borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12 }}>取消</button>
        <button onClick={() => void onCreateTask()} disabled={busy}
          style={{ padding: '6px 20px', background: busy ? '#333' : colors.gold, color: busy ? '#888' : '#000', border: 'none', borderRadius: 4, cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600 }}>
          {busy ? `创建中… ${elapsed}s` : '创建'}
        </button>
      </div>
      {toast && (
        <div style={{ color: '#f66', fontSize: 11, padding: '4px 8px', background: 'rgba(255,80,80,0.1)', borderRadius: 4 }}>{toast}</div>
      )}
    </div>
  );
}
