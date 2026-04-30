import { useGameLoop } from './hooks/useGameLoop';
import { useGameState } from './store/gameState';
import { DialogBox } from './ui/DialogBox';
import { BottomMenu } from './ui/BottomMenu';
import { AgentPopup } from './ui/AgentPopup';
import { CareersPopup } from './ui/CareersPopup';
import { useEffect, useState } from 'react';

function formatAgentStatus(status: string) {
  if (status === 'working') return '工作中';
  if (status === 'slacking') return '怠工';
  if (status === 'social') return '社交';
  if (status === 'offline') return '离线';
  return '待机';
}

const TASK_TYPES = [
  { value: 'design', label: '设计' },
  { value: 'code', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'analyze', label: '分析' },
  { value: 'review', label: '评审' },
] as const;

export default function App() {
  useGameLoop();
  const [activeMenu, setActiveMenu] = useState<null | 'agent' | 'careers' | 'archive' | 'system'>(null);
  const [selectedAgent, setSelectedAgent] = useState('designer');
  const [selectedTaskType, setSelectedTaskType] = useState<(typeof TASK_TYPES)[number]['value']>('design');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'task' | 'event' | 'skill' | 'upgrade'>('all');
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  const [importedTimeline, setImportedTimeline] = useState<Array<{ timestamp: number; action: string; detail: string }> | null>(null);
  const [importPreview, setImportPreview] = useState<{
    targetTaskId: string;
    entries: Array<{ timestamp: number; action: string; detail: string }>;
    report: {
      total: number;
      valid: number;
      invalid: number;
      sameTimestamp: number;
      sameAction: number;
      invalidSamples: string[];
    };
    diff: {
      newItems: Array<{ timestamp: number; action: string; detail: string }>;
      conflictItems: Array<{ timestamp: number; action: string; detail: string }>;
      dedupDropItems: Array<{ timestamp: number; action: string; detail: string }>;
    };
  } | null>(null);
  const [importRange, setImportRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [importDedupStrategy, setImportDedupStrategy] = useState<'none' | 'timestamp' | 'action'>('none');
  const [highlightImportedKeys, setHighlightImportedKeys] = useState<Set<string>>(new Set());
  const [selectedImportKeys, setSelectedImportKeys] = useState<Set<string>>(new Set());
  const [expandedDiffSection, setExpandedDiffSection] = useState<'new' | 'conflict' | 'dedup' | null>('new');
  const [importActionKeyword, setImportActionKeyword] = useState('');
  const IMPORT_SELECTION_TEMPLATE_KEY = 'hb_import_selection_templates_v1';
  const [importTemplateName, setImportTemplateName] = useState('default');
  const [importTemplateSaveAsName, setImportTemplateSaveAsName] = useState('');
  const [importTemplateRenameTo, setImportTemplateRenameTo] = useState('');
  const [templateImportStrategy, setTemplateImportStrategy] = useState<'overwrite' | 'only_new' | 'rename_conflict'>('overwrite');
  const [templateGroup, setTemplateGroup] = useState<'personal' | 'team' | 'experiment'>('personal');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateSortBy, setTemplateSortBy] = useState<'savedAt' | 'name' | 'count'>('savedAt');
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [templatePage, setTemplatePage] = useState(1);
  const [templatePageSize, setTemplatePageSize] = useState(8);
  const [batchTargetGroup, setBatchTargetGroup] = useState<'personal' | 'team' | 'experiment'>('team');
  const [templateBatchNotice, setTemplateBatchNotice] = useState('');
  const [templateBatchReport, setTemplateBatchReport] = useState<null | {
    success: number;
    skipped: number;
    byReason: Record<'locked' | 'not_found' | 'conflict', number>;
  }>(null);
  const [pendingBatchAction, setPendingBatchAction] = useState<null | 'delete' | 'unlock' | 'lock' | 'group'>(null);
  const [batchExecutionMode, setBatchExecutionMode] = useState<'safe_continue' | 'fail_fast'>('safe_continue');
  const [lastBatchSnapshot, setLastBatchSnapshot] = useState<null | {
    templates: Record<string, {
      selectedKeys: string[];
      dedupStrategy: 'none' | 'timestamp' | 'action';
      range: { from: string; to: string };
      savedAt: number;
      locked?: boolean;
      group?: 'personal' | 'team' | 'experiment';
    }>;
    notice: string;
  }>(null);
  const TEMPLATE_VIEW_STATE_KEY = 'hb_template_view_state_v1';
  const [importTemplates, setImportTemplates] = useState<Record<string, {
    selectedKeys: string[];
    dedupStrategy: 'none' | 'timestamp' | 'action';
    range: { from: string; to: string };
    savedAt: number;
    locked?: boolean;
    group?: 'personal' | 'team' | 'experiment';
  }>>({});
  const [taskLogFilterId, setTaskLogFilterId] = useState('');
  const agents = useGameState((s) => s.agents);
  const events = useGameState((s) => s.events);
  const weekCompleted = useGameState((s) => s.weekCompleted);
  const weekTarget = useGameState((s) => s.weekTarget);
  const cityLordPoints = useGameState((s) => s.cityLordPoints);
  const cityLordLevel = useGameState((s) => s.cityLordLevel);
  const restRoomLevel = useGameState((s) => s.restRoomLevel);
  const serverRoomLevel = useGameState((s) => s.serverRoomLevel);
  const assignTask = useGameState((s) => s.assignTask);
  const resolveEvent = useGameState((s) => s.resolveEvent);
  const upgradeFacility = useGameState((s) => s.upgradeFacility);
  const castCityLordSkill = useGameState((s) => s.castCityLordSkill);
  const setSelectedTaskTypeInStore = useGameState((s) => s.setSelectedTaskType);
  const achievements = useGameState((s) => s.achievements);
  const latestResolution = useGameState((s) => s.latestResolution);
  const activityLog = useGameState((s) => s.activityLog);
  const eventResultFeed = useGameState((s) => s.eventResultFeed);
  const undoLastEventResolution = useGameState((s) => s.undoLastEventResolution);
  const redoLastEventResolution = useGameState((s) => s.redoLastEventResolution);
  const canUndoEvent = useGameState((s) => s.eventUndoStack.length > 0);
  const canRedoEvent = useGameState((s) => s.eventRedoStack.length > 0);
  const cityLordSkillCooldowns = useGameState((s) => s.cityLordSkillCooldowns);
  const taskLifecycleLog = useGameState((s) => s.taskLifecycleLog);
  const tasks = useGameState((s) => s.tasks);
  const levelUpFeed = useGameState((s) => s.levelUpFeed);
  const cancelTask = useGameState((s) => s.cancelTask);
  const retryTask = useGameState((s) => s.retryTask);
  const changeTaskPriority = useGameState((s) => s.changeTaskPriority);
  const reorderTask = useGameState((s) => s.reorderTask);
  const reassignTask = useGameState((s) => s.reassignTask);
  const applyImportedTimeline = useGameState((s) => s.applyImportedTimeline);

  const taskDetail = tasks.find((t) => t.id === taskDetailId) || null;

  const exportTaskTimeline = (taskId: string) => {
    const timeline = taskLifecycleLog[taskId] ?? [];
    const payload = {
      taskId,
      exportedAt: new Date().toISOString(),
      timeline,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-timeline-${taskId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTaskTimeline = async (targetTaskId: string, file: File) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const timeline = Array.isArray(parsed?.timeline) ? parsed.timeline : [];
      const invalidSamples: string[] = [];
      const validEntries = timeline
        .filter((x: unknown) => {
          const ok = typeof (x as { timestamp?: unknown })?.timestamp === 'number' && typeof (x as { action?: unknown })?.action === 'string';
          if (!ok && invalidSamples.length < 5) invalidSamples.push(JSON.stringify(x));
          return ok;
        })
        .map((x: { timestamp: number; action: string; detail?: string }) => ({
          timestamp: x.timestamp,
          action: String(x.action),
          detail: String(x.detail ?? ''),
        }));
      const invalid = Math.max(0, timeline.length - validEntries.length);
      const fromTs = importRange.from ? new Date(importRange.from).getTime() : Number.NEGATIVE_INFINITY;
      const toTs = importRange.to ? new Date(importRange.to).getTime() : Number.POSITIVE_INFINITY;
      const cleaned = validEntries.filter((e: { timestamp: number }) => e.timestamp >= fromTs && e.timestamp <= toTs);
      const existing = taskLifecycleLog[targetTaskId] ?? [];
      const existingByTs = new Set(existing.map((e: { timestamp: number }) => e.timestamp));
      const existingByAction = new Set(existing.map((e: { action: string }) => e.action));
      const sameTimestamp = cleaned.filter((e: { timestamp: number }) => existingByTs.has(e.timestamp)).length;
      const sameAction = cleaned.filter((e: { action: string }) => existingByAction.has(e.action)).length;
      const newItems = cleaned.filter((e: { timestamp: number; action: string }) => !existingByTs.has(e.timestamp) && !existingByAction.has(e.action));
      const conflictItems = cleaned.filter((e: { timestamp: number; action: string }) => existingByTs.has(e.timestamp) || existingByAction.has(e.action));
      const dedupDropItems = cleaned.filter((e: { timestamp: number; action: string }) =>
        importDedupStrategy === 'timestamp'
          ? existingByTs.has(e.timestamp)
          : importDedupStrategy === 'action'
          ? existingByAction.has(e.action)
          : false
      );
      setImportedTimeline(cleaned);
      setSelectedImportKeys(new Set(cleaned.map((e: { timestamp: number; action: string }) => `${e.timestamp}-${e.action}`)));
      setImportPreview({
        targetTaskId,
        entries: cleaned,
        report: {
          total: timeline.length,
          valid: cleaned.length,
          invalid,
          sameTimestamp,
          sameAction,
          invalidSamples,
        },
        diff: {
          newItems,
          conflictItems,
          dedupDropItems,
        },
      });
    } catch {
      setImportedTimeline([]);
      setSelectedImportKeys(new Set());
      setImportPreview({
        targetTaskId,
        entries: [],
        report: { total: 0, valid: 0, invalid: 0, sameTimestamp: 0, sameAction: 0, invalidSamples: [] },
        diff: { newItems: [], conflictItems: [], dedupDropItems: [] },
      });
    }
  };

  const toggleImportSelection = (entry: { timestamp: number; action: string }) => {
    const key = `${entry.timestamp}-${entry.action}`;
    setSelectedImportKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickKeysFromEntries = (entries: Array<{ timestamp: number; action: string }>) =>
    new Set(entries.map((e) => `${e.timestamp}-${e.action}`));

  const applyKeywordFilterKeys = (entries: Array<{ timestamp: number; action: string; detail: string }>, keyword: string) => {
    const k = keyword.trim().toLowerCase();
    if (!k) return pickKeysFromEntries(entries);
    return pickKeysFromEntries(entries.filter((e) => e.action.toLowerCase().includes(k) || e.detail.toLowerCase().includes(k)));
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IMPORT_SELECTION_TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setImportTemplates(parsed);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TEMPLATE_VIEW_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.templatePage === 'number') setTemplatePage(parsed.templatePage);
      if (typeof parsed?.templatePageSize === 'number') setTemplatePageSize(parsed.templatePageSize);
      if (typeof parsed?.templateSearch === 'string') setTemplateSearch(parsed.templateSearch);
      if (parsed?.templateSortBy === 'savedAt' || parsed?.templateSortBy === 'name' || parsed?.templateSortBy === 'count') {
        setTemplateSortBy(parsed.templateSortBy);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TEMPLATE_VIEW_STATE_KEY,
        JSON.stringify({ templatePage, templatePageSize, templateSearch, templateSortBy })
      );
    } catch {
      // ignore
    }
  }, [templatePage, templatePageSize, templateSearch, templateSortBy]);

  const invertSelection = (entries: Array<{ timestamp: number; action: string }>) => {
    const allKeys = entries.map((e) => `${e.timestamp}-${e.action}`);
    setSelectedImportKeys((prev) => {
      const next = new Set<string>();
      for (const k of allKeys) {
        if (!prev.has(k)) next.add(k);
      }
      return next;
    });
  };

  const saveSelectionTemplate = () => {
    try {
      const name = importTemplateName.trim() || 'default';
      if (importTemplates[name]?.locked) return;
      const next = {
        ...importTemplates,
        [name]: {
          selectedKeys: Array.from(selectedImportKeys),
          dedupStrategy: importDedupStrategy,
          range: importRange,
          savedAt: Date.now(),
          locked: importTemplates[name]?.locked ?? false,
          group: templateGroup,
        },
      };
      setImportTemplates(next);
      window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const restoreSelectionTemplate = (entries: Array<{ timestamp: number; action: string }>) => {
    try {
      const name = importTemplateName.trim() || 'default';
      const parsed = importTemplates[name];
      if (!parsed) return;
      const allowed = new Set(entries.map((e) => `${e.timestamp}-${e.action}`));
      const selected = Array.isArray(parsed?.selectedKeys) ? parsed.selectedKeys.filter((k: string) => allowed.has(k)) : [];
      setSelectedImportKeys(new Set(selected));
      setImportDedupStrategy(parsed.dedupStrategy ?? 'none');
      setImportRange(parsed.range ?? { from: '', to: '' });
    } catch {
      // ignore
    }
  };

  const deleteSelectionTemplate = () => {
    try {
      const name = importTemplateName.trim() || 'default';
      if (!importTemplates[name]) return;
      if (importTemplates[name]?.locked) return;
      const next = { ...importTemplates };
      delete next[name];
      setImportTemplates(next);
      window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const saveAsSelectionTemplate = () => {
    const newName = importTemplateSaveAsName.trim();
    if (!newName) return;
    try {
      const next = {
        ...importTemplates,
        [newName]: {
          selectedKeys: Array.from(selectedImportKeys),
          dedupStrategy: importDedupStrategy,
          range: importRange,
          savedAt: Date.now(),
          locked: false,
          group: templateGroup,
        },
      };
      setImportTemplates(next);
      setImportTemplateName(newName);
      setImportTemplateSaveAsName('');
      window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const exportTemplates = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: importTemplates,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-selection-templates.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTemplatesFromFile = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const templates = parsed?.templates;
      if (!templates || typeof templates !== 'object') return;
      const sanitized: typeof importTemplates = {};
      for (const [name, value] of Object.entries(templates)) {
        const v = value as {
          selectedKeys?: unknown;
          dedupStrategy?: unknown;
          range?: { from?: unknown; to?: unknown };
          savedAt?: unknown;
          group?: unknown;
        };
        sanitized[name] = {
          selectedKeys: Array.isArray(v.selectedKeys) ? v.selectedKeys.filter((x): x is string => typeof x === 'string') : [],
          dedupStrategy: v.dedupStrategy === 'timestamp' || v.dedupStrategy === 'action' ? v.dedupStrategy : 'none',
          range: {
            from: typeof v.range?.from === 'string' ? v.range.from : '',
            to: typeof v.range?.to === 'string' ? v.range.to : '',
          },
          savedAt: typeof v.savedAt === 'number' ? v.savedAt : Date.now(),
          group: v.group === 'team' || v.group === 'experiment' ? v.group : 'personal',
        };
      }
      const next = { ...importTemplates };
      for (const [name, tpl] of Object.entries(sanitized)) {
        if (!next[name]) {
          next[name] = tpl;
          continue;
        }
        if (templateImportStrategy === 'only_new') {
          continue;
        }
        if (templateImportStrategy === 'overwrite') {
          if (next[name].locked) continue;
          next[name] = { ...tpl, locked: next[name].locked ?? tpl.locked ?? false };
          continue;
        }
        let i = 1;
        let candidate = `${name}_${i}`;
        while (next[candidate]) {
          i += 1;
          candidate = `${name}_${i}`;
        }
        next[candidate] = { ...tpl, locked: false };
      }
      setImportTemplates(next);
      window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const renameSelectionTemplate = () => {
    const from = importTemplateName.trim();
    const to = importTemplateRenameTo.trim();
    if (!from || !to || from === to) return;
    const src = importTemplates[from];
    if (!src || src.locked || importTemplates[to]) return;
    const next = { ...importTemplates };
    delete next[from];
    next[to] = { ...src, savedAt: Date.now() };
    setImportTemplates(next);
    setImportTemplateName(to);
    setImportTemplateRenameTo('');
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const toggleTemplateLock = () => {
    const name = importTemplateName.trim();
    if (!name || !importTemplates[name]) return;
    const next = {
      ...importTemplates,
      [name]: {
        ...importTemplates[name],
        locked: !importTemplates[name].locked,
      },
    };
    setImportTemplates(next);
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const visibleTemplateNames = Object.entries(importTemplates)
    .filter(([name, tpl]) => {
      const q = templateSearch.trim().toLowerCase();
      if (!q) return true;
      return name.toLowerCase().includes(q) || (tpl.group ?? 'personal').includes(q);
    })
    .sort(([aName, aTpl], [bName, bTpl]) => {
      if (templateSortBy === 'name') return aName.localeCompare(bName);
      if (templateSortBy === 'count') return (bTpl.selectedKeys.length - aTpl.selectedKeys.length) || aName.localeCompare(bName);
      return (bTpl.savedAt - aTpl.savedAt) || aName.localeCompare(bName);
    })
    .map(([name]) => name);
  const totalTemplatePages = Math.max(1, Math.ceil(visibleTemplateNames.length / Math.max(1, templatePageSize)));
  const clampedTemplatePage = Math.min(templatePage, totalTemplatePages);
  const pagedTemplateNames = visibleTemplateNames.slice((clampedTemplatePage - 1) * templatePageSize, clampedTemplatePage * templatePageSize);

  const toggleTemplateSelection = (name: string) => {
    setSelectedTemplates((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const batchDeleteTemplates = () => {
    setLastBatchSnapshot({ templates: importTemplates, notice: templateBatchNotice });
    const next = { ...importTemplates };
    let success = 0;
    let skippedLocked = 0;
    let skippedNotFound = 0;
    let skippedConflict = 0;
    for (const name of selectedTemplates) {
      if (!next[name]) {
        skippedNotFound += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      if (next[name].locked) {
        skippedLocked += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      delete next[name];
      success += 1;
    }
    setImportTemplates(next);
    setSelectedTemplates(new Set());
    setTemplateBatchNotice(`批量删除完成：成功 ${success}，跳过(锁定) ${skippedLocked}。`);
    setTemplateBatchReport({
      success,
      skipped: skippedLocked + skippedNotFound + skippedConflict,
      byReason: { locked: skippedLocked, not_found: skippedNotFound, conflict: skippedConflict },
    });
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const batchUnlockTemplates = () => {
    setLastBatchSnapshot({ templates: importTemplates, notice: templateBatchNotice });
    const next = { ...importTemplates };
    let success = 0;
    let skippedNotFound = 0;
    let skippedConflict = 0;
    for (const name of selectedTemplates) {
      if (!next[name]) {
        skippedNotFound += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      // conflict: already unlocked
      if (!next[name].locked) {
        skippedConflict += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      next[name] = { ...next[name], locked: false };
      success += 1;
    }
    setImportTemplates(next);
    setTemplateBatchNotice(`批量解锁完成：成功 ${success}。`);
    setTemplateBatchReport({
      success,
      skipped: skippedNotFound + skippedConflict,
      byReason: { locked: 0, not_found: skippedNotFound, conflict: skippedConflict },
    });
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const batchLockTemplates = () => {
    setLastBatchSnapshot({ templates: importTemplates, notice: templateBatchNotice });
    const next = { ...importTemplates };
    let success = 0;
    let skippedNotFound = 0;
    let skippedConflict = 0;
    for (const name of selectedTemplates) {
      if (!next[name]) {
        skippedNotFound += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      // conflict: already locked
      if (next[name].locked) {
        skippedConflict += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      next[name] = { ...next[name], locked: true };
      success += 1;
    }
    setImportTemplates(next);
    setTemplateBatchNotice(`批量加锁完成：成功 ${success}。`);
    setTemplateBatchReport({
      success,
      skipped: skippedNotFound + skippedConflict,
      byReason: { locked: 0, not_found: skippedNotFound, conflict: skippedConflict },
    });
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const batchChangeGroup = () => {
    setLastBatchSnapshot({ templates: importTemplates, notice: templateBatchNotice });
    const next = { ...importTemplates };
    let success = 0;
    let skippedNotFound = 0;
    let skippedConflict = 0;
    for (const name of selectedTemplates) {
      if (!next[name]) {
        skippedNotFound += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      // conflict: same target group
      if ((next[name].group ?? 'personal') === batchTargetGroup) {
        skippedConflict += 1;
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      next[name] = { ...next[name], group: batchTargetGroup };
      success += 1;
    }
    setImportTemplates(next);
    setTemplateBatchNotice(`批量改分组完成：成功 ${success}，目标分组=${batchTargetGroup}。`);
    setTemplateBatchReport({
      success,
      skipped: skippedNotFound + skippedConflict,
      byReason: { locked: 0, not_found: skippedNotFound, conflict: skippedConflict },
    });
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(next));
  };

  const undoLastBatchOperation = () => {
    if (!lastBatchSnapshot) return;
    setImportTemplates(lastBatchSnapshot.templates);
    setTemplateBatchNotice(`已撤销上一批量操作。之前提示：${lastBatchSnapshot.notice}`);
    window.localStorage.setItem(IMPORT_SELECTION_TEMPLATE_KEY, JSON.stringify(lastBatchSnapshot.templates));
    setLastBatchSnapshot(null);
  };

  const computeBatchImpact = () => {
    const selected = Array.from(selectedTemplates);
    const willSucceed: string[] = [];
    const willSkip: string[] = [];
    const skipByReason: Record<'locked' | 'not_found' | 'conflict', string[]> = {
      locked: [],
      not_found: [],
      conflict: [],
    };
    for (const name of selected) {
      const tpl = importTemplates[name];
      if (!tpl) {
        willSkip.push(name);
        skipByReason.not_found.push(name);
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      if (pendingBatchAction === 'delete' && tpl.locked) {
        willSkip.push(name);
        skipByReason.locked.push(name);
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      if (pendingBatchAction === 'unlock' && !tpl.locked) {
        willSkip.push(name);
        skipByReason.conflict.push(name);
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      if (pendingBatchAction === 'lock' && tpl.locked) {
        willSkip.push(name);
        skipByReason.conflict.push(name);
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      if (pendingBatchAction === 'group' && (tpl.group ?? 'personal') === batchTargetGroup) {
        willSkip.push(name);
        skipByReason.conflict.push(name);
        if (batchExecutionMode === 'fail_fast') break;
        continue;
      }
      willSucceed.push(name);
    }
    return { willSucceed, willSkip, skipByReason };
  };

  const batchExportTemplates = () => {
    const picked: Record<string, typeof importTemplates[string]> = {};
    for (const name of selectedTemplates) {
      if (importTemplates[name]) picked[name] = importTemplates[name];
    }
    const payload = { version: 1, exportedAt: new Date().toISOString(), templates: picked };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-selection-templates-batch.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyRecentRange = (hours: number) => {
    const to = new Date();
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setImportRange({ from: fmt(from), to: fmt(to) });
  };

  const agentLoad = (agentId: string) => {
    const scoped = tasks.filter((t) => t.agentId === agentId);
    const total = Math.max(1, scoped.length);
    const running = scoped.filter((t) => t.status === 'in_progress').length;
    const queued = scoped.filter((t) => t.status === 'queued').length;
    const failed = scoped.filter((t) => t.status === 'failed').length;
    return {
      runningPct: (running / total) * 100,
      queuedPct: (queued / total) * 100,
      failedPct: (failed / total) * 100,
    };
  };

  const impactPreview = (type: string) => {
    const avgEnergy = agents.reduce((acc, a) => acc + a.energy, 0) / Math.max(1, agents.length);
    const avgSocial = agents.reduce((acc, a) => acc + a.socialNeed, 0) / Math.max(1, agents.length);
    const pressure = avgEnergy < 45 || avgSocial < 45 ? 1 : 0;
    const basePoints = 20 + pressure * 10;
    const baseWeek = 1 + (pressure ? 1 : 0);
    if (type === 'challenge') {
      return {
        pointsAccept: `+${basePoints}`,
        weekAccept: `+${baseWeek}`,
        needsAccept: '能量/社交压力下降',
        pointsIgnore: '+0',
        weekIgnore: '+0',
        needsIgnore: '可能错过恢复窗口',
      };
    }
    if (type === 'opportunity') {
      return {
        pointsAccept: `+${Math.max(10, basePoints - 5)}`,
        weekAccept: `+${Math.max(1, baseWeek - 0)}`,
        needsAccept: '协作带来状态提升',
        pointsIgnore: '+0',
        weekIgnore: '+0',
        needsIgnore: '无直接变化',
      };
    }
    return {
      pointsAccept: '+0',
      weekAccept: '+0',
      needsAccept: '仅信息提示',
      pointsIgnore: '+0',
      weekIgnore: '+0',
      needsIgnore: '仅信息提示',
    };
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="title">崽崽数字小屋</div>
        <div>积分 {cityLordPoints}</div>
        <div>城主 Lv.{cityLordLevel}</div>
        <div>周目标 {weekCompleted}/{weekTarget}</div>
      </header>

      <aside className="left-panel panel">
        <div className="panel-title">Agent 状态</div>
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-row"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const sourceId = e.dataTransfer.getData('text/task-id');
              if (sourceId) reassignTask(sourceId, agent.id);
            }}
          >
            <strong>{agent.name}</strong>
            <span>{agent.role}</span>
            <span>{formatAgentStatus(agent.status)}</span>
            <span>饱食 {agent.energy.toFixed(0)}</span>
            <span>配额 {agent.quota.toFixed(0)}</span>
            <span>社交 {agent.socialNeed.toFixed(0)}</span>
            <span>匹配 {agent.roleMatch.toFixed(0)}%</span>
            {(() => {
              const currentTask = tasks.find((t) => t.agentId === agent.id && (t.status === 'queued' || t.status === 'in_progress'));
              const queueCount = tasks.filter((t) => t.agentId === agent.id && t.status === 'queued').length;
              return currentTask
                ? <span>任务 {currentTask.taskType} ETA {currentTask.etaSec}s / 排队 {queueCount}</span>
                : <span>任务 - / 排队 {queueCount}</span>;
            })()}
            {(() => {
              const load = agentLoad(agent.id);
              return (
                <div className="agent-load-bar" title="执行中/排队/失败">
                  <span className="run" style={{ width: `${load.runningPct}%` }} />
                  <span className="queue" style={{ width: `${load.queuedPct}%` }} />
                  <span className="fail" style={{ width: `${load.failedPct}%` }} />
                </div>
              );
            })()}
          </div>
        ))}
        <div className="panel-title" style={{ marginTop: 12 }}>任务分配</div>
        <div className="assign-box">
          <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={selectedTaskType} onChange={(e) => setSelectedTaskType(e.target.value as any)}>
            {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button onClick={() => { setSelectedTaskTypeInStore(selectedTaskType); assignTask(selectedAgent, selectedTaskType); }}>
            分配任务
          </button>
        </div>
        <div className="panel-title" style={{ marginTop: 12 }}>任务队列</div>
        <div className="task-list">
          {tasks.length === 0 ? <div className="muted">暂无任务</div> : tasks.slice(0, 8).map((t) => (
            <div
              key={t.id}
              className={`task-item ${t.status}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const sourceId = e.dataTransfer.getData('text/task-id');
                if (sourceId) reorderTask(sourceId, t.id);
              }}
            >
              <div>
                {t.agentId} / {t.taskType} / {t.status} / P{t.priority} / ETA {t.etaSec}s
                <button className="inline-detail-btn" onClick={() => setTaskDetailId(t.id)}>详情</button>
              </div>
              {t.status === 'done' && <div>质量分: {t.qualityScore}</div>}
              <div className="progress-bar"><span style={{ width: `${t.progress}%` }} /></div>
              <div className="task-actions">
                <button onClick={() => changeTaskPriority(t.id, 'up')}>优先级↑</button>
                <button onClick={() => changeTaskPriority(t.id, 'down')}>优先级↓</button>
                <button disabled={!(t.status === 'queued' || t.status === 'in_progress')} onClick={() => cancelTask(t.id)}>取消</button>
                <button disabled={!(t.status === 'cancelled' || t.status === 'failed')} onClick={() => retryTask(t.id)}>重试</button>
                <button onClick={() => setTaskLogFilterId(t.id.slice(0, 8))}>筛该任务日志</button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-title" style={{ marginTop: 12 }}>设施升级</div>
        <div className="assign-box">
          <div>休息室 Lv.{restRoomLevel}</div>
          <button onClick={() => upgradeFacility('rest')}>升级休息室</button>
          <div>机房 Lv.{serverRoomLevel}</div>
          <button onClick={() => upgradeFacility('server')}>升级机房</button>
        </div>
        <div className="panel-title" style={{ marginTop: 12 }}>城主技能</div>
        <div className="assign-box">
          <button disabled={cityLordSkillCooldowns.motivate > 0} onClick={() => castCityLordSkill('motivate')}>
            激励演说 (-50) {cityLordSkillCooldowns.motivate > 0 ? `(CD ${cityLordSkillCooldowns.motivate}s)` : ''}
          </button>
          <button disabled={cityLordSkillCooldowns.dispatch > 0} onClick={() => castCityLordSkill('dispatch')}>
            资源调度 (-80) {cityLordSkillCooldowns.dispatch > 0 ? `(CD ${cityLordSkillCooldowns.dispatch}s)` : ''}
          </button>
        </div>
      </aside>

      <main className="center panel">
        <div className="panel-title">活动空间（原型第一版）</div>
        <div className="rooms-grid">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="room-tile">{i < 9 ? `办公室${i + 1}` : ['休息室', '机房', '资料室', '会议室'][i - 9]}</div>
          ))}
        </div>
      </main>

      <aside className="right-panel panel">
        <div className="panel-title">活动提示</div>
        <div className="week-progress">
          <div>周目标进度</div>
          <div className="progress-bar"><span style={{ width: `${Math.min(100, (weekCompleted / Math.max(1, weekTarget)) * 100)}%` }} /></div>
          <small>{weekCompleted}/{weekTarget}</small>
        </div>
        <div className="event-list">
          {events.length === 0 ? <div className="muted">暂无事件</div> : events.map((e) => (
            <div key={e.id} className={`event-item ${e.type}`}>
              <div>{e.title}</div>
              <small>{e.detail}</small>
              {e.expireAt && <small>剩余 {Math.max(0, Math.ceil((e.expireAt - Date.now()) / 1000))}s</small>}
              <div className="event-actions">
                <button onClick={() => setExpandedEventId((v) => (v === e.id ? null : e.id))}>
                  {expandedEventId === e.id ? '收起详情' : '展开详情'}
                </button>
              </div>
              {expandedEventId === e.id && (
                <div className="event-detail">
                  {(() => {
                    const p = impactPreview(e.type);
                    return (
                      <div className="impact-grid">
                        <div>接受后积分: {p.pointsAccept}</div>
                        <div>接受后周进度: {p.weekAccept}</div>
                        <div>接受后需求影响: {p.needsAccept}</div>
                        <div>忽略后积分: {p.pointsIgnore}</div>
                        <div>忽略后周进度: {p.weekIgnore}</div>
                        <div>忽略后需求影响: {p.needsIgnore}</div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {(e.type === 'challenge' || e.type === 'opportunity') && (
                <div className="event-actions">
                  <button onClick={() => resolveEvent(e.id, true)}>接受</button>
                  <button onClick={() => resolveEvent(e.id, false)}>忽略</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="panel-title" style={{ marginTop: 10 }}>成就</div>
        <div className="achievement-list">
          {achievements.map((a) => (
            <div key={a.id} className={`achievement-item ${a.unlocked ? 'on' : ''}`}>
              {a.unlocked ? '✅' : '⬜'} {a.name}
            </div>
          ))}
        </div>
        {latestResolution && <div className="resolution">{latestResolution}</div>}
        <div className="panel-title" style={{ marginTop: 10 }}>事件回放</div>
        <div className="event-undo-row">
          <button disabled={!canUndoEvent} onClick={() => undoLastEventResolution()}>
            撤销最近一次事件处理
          </button>
          <button disabled={!canRedoEvent} onClick={() => redoLastEventResolution()}>
            重做最近一次事件处理
          </button>
        </div>
        <div className="log-list">
          {eventResultFeed.length === 0 ? <div className="muted">暂无回放</div> : eventResultFeed.slice(0, 5).map((item) => (
            <div key={item.id} className="log-item">{item.text}</div>
          ))}
        </div>
        <div className="panel-title" style={{ marginTop: 10 }}>成长提示</div>
        <div className="log-list">
          {levelUpFeed.length === 0 ? <div className="muted">暂无升级提示</div> : levelUpFeed.slice(0, 5).map((item) => (
            <div key={item.id} className="log-item">{item.text}</div>
          ))}
        </div>
        <div className="panel-title" style={{ marginTop: 10 }}>活动日志</div>
        <div className="task-log-filter-row">
          <input
            value={taskLogFilterId}
            onChange={(e) => setTaskLogFilterId(e.target.value.trim())}
            placeholder="输入任务短ID过滤日志"
          />
          <button onClick={() => setTaskLogFilterId('')}>清除</button>
        </div>
        <div className="log-filters">
          {(['all', 'task', 'event', 'skill', 'upgrade'] as const).map((k) => (
            <button key={k} className={logFilter === k ? 'active' : ''} onClick={() => setLogFilter(k)}>{k}</button>
          ))}
        </div>
        <div className="log-list">
          {activityLog.length === 0 ? <div className="muted">暂无日志</div> : activityLog
            .filter((line) => logFilter === 'all' || line.type === logFilter)
            .filter((line) => !taskLogFilterId || line.message.includes(taskLogFilterId))
            .slice(0, 8)
            .map((line, idx) => (
            <div key={`${line.message}-${idx}`} className="log-item">[{line.type}] {line.message}</div>
          ))}
        </div>
      </aside>

      <footer className="bottom-bar panel">
        <BottomMenu active={activeMenu} onSelect={setActiveMenu} />
      </footer>

      <DialogBox />

      {activeMenu === 'agent' && <AgentPopup onClose={() => setActiveMenu(null)} />}
      {activeMenu === 'careers' && <CareersPopup onClose={() => setActiveMenu(null)} />}
      {taskDetail && (
        <div className="popup-mask" onClick={() => setTaskDetailId(null)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-head">
              <strong>任务详情</strong>
              <button onClick={() => setTaskDetailId(null)}>✕</button>
            </div>
            <div className="popup-body">
              <div>任务ID: {taskDetail.id}</div>
              <div>Agent: {taskDetail.agentId}</div>
              <div>类型: {taskDetail.taskType}</div>
              <div>状态: {taskDetail.status}</div>
              <div>进度: {taskDetail.progress.toFixed(0)}%</div>
              <div>优先级: P{taskDetail.priority}</div>
              <div>奖励积分(基础): {taskDetail.rewardPoints}</div>
              <div>奖励周进度: {taskDetail.rewardWeek}</div>
              <div>质量分: {taskDetail.qualityScore}</div>
              {taskDetail.qualityBreakdown && (
                <div className="task-quality">
                  <div>质量构成:</div>
                  <div>roleMatch({taskDetail.qualityBreakdown.roleMatchWeight}) = {taskDetail.qualityBreakdown.roleMatchPart}</div>
                  <div>energy({taskDetail.qualityBreakdown.energyWeight}) = {taskDetail.qualityBreakdown.energyPart}</div>
                </div>
              )}
              <div className="task-quality">
                <div>任务操作:</div>
                <div className="task-actions">
                  <button onClick={() => changeTaskPriority(taskDetail.id, 'up')}>优先级↑</button>
                  <button onClick={() => changeTaskPriority(taskDetail.id, 'down')}>优先级↓</button>
                  <button onClick={() => exportTaskTimeline(taskDetail.id)}>导出时间线 JSON</button>
                  <label className="inline-detail-btn" style={{ display: 'inline-block' }}>
                    导入时间线 JSON
                    <input
                      type="file"
                      accept="application/json"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void importTaskTimeline(taskDetail.id, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {agents.map((a) => (
                    <button key={`move-${a.id}`} onClick={() => reassignTask(taskDetail.id, a.id)}>
                      转派到 {a.name}
                    </button>
                  ))}
                </div>
                <div className="task-actions" style={{ marginTop: 6 }}>
                  <input
                    type="datetime-local"
                    value={importRange.from}
                    onChange={(e) => setImportRange((r) => ({ ...r, from: e.target.value }))}
                    title="导入起始时间"
                  />
                  <input
                    type="datetime-local"
                    value={importRange.to}
                    onChange={(e) => setImportRange((r) => ({ ...r, to: e.target.value }))}
                    title="导入结束时间"
                  />
                  <button onClick={() => setImportRange({ from: '', to: '' })}>清空时间范围</button>
                  <button onClick={() => applyRecentRange(1)}>最近1h</button>
                  <button onClick={() => applyRecentRange(24)}>最近24h</button>
                  <button onClick={() => applyRecentRange(24 * 7)}>最近7d</button>
                </div>
              </div>
              <div className="task-quality">
                <div>相关日志:</div>
                {activityLog
                  .filter((l) => l.type === 'task' && (l.message.includes(taskDetail.id.slice(0, 8)) || l.message.includes(taskDetail.agentId)))
                  .slice(0, 5)
                  .map((l, idx) => <div key={`${l.timestamp}-${idx}`}>{l.message}</div>)}
              </div>
              <div className="task-quality">
                <div>生命周期时间线:</div>
                {(taskLifecycleLog[taskDetail.id] ?? []).slice().sort((a, b) => a.timestamp - b.timestamp).map((entry, idx) => (
                  <div
                    key={`${entry.timestamp}-${idx}`}
                    style={highlightImportedKeys.has(`${entry.timestamp}-${entry.action}`) ? { background: 'rgba(200,160,96,0.2)' } : undefined}
                  >
                    [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.action} - {entry.detail}
                  </div>
                ))}
              </div>
              {importedTimeline && (
                <div className="task-quality">
                  <div>导入回放时间线:</div>
                  {importedTimeline.length === 0 && <div>导入失败或为空</div>}
                  {importedTimeline.slice().sort((a, b) => a.timestamp - b.timestamp).map((entry, idx) => (
                    <div key={`imp-${entry.timestamp}-${idx}`}>
                      [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.action} - {entry.detail}
                    </div>
                  ))}
                  {importPreview && importPreview.targetTaskId === taskDetail.id && (
                    <div className="task-actions" style={{ marginTop: 8 }}>
                      <div style={{ width: '100%', fontSize: 12, marginBottom: 6 }}>
                        校验报告: total={importPreview.report.total}, valid={importPreview.report.valid}, invalid={importPreview.report.invalid},
                        同时间戳冲突={importPreview.report.sameTimestamp}, 同动作冲突={importPreview.report.sameAction}
                      </div>
                      {importPreview.report.invalidSamples.length > 0 && (
                        <div style={{ width: '100%', fontSize: 12, marginBottom: 6 }}>
                          无效示例:
                          {importPreview.report.invalidSamples.map((s, i) => (
                            <div key={`invalid-${i}`}>{s}</div>
                          ))}
                        </div>
                      )}
                      <div style={{ width: '100%', fontSize: 12, marginBottom: 6 }}>
                        差异视图:
                        <div>新增: {importPreview.diff.newItems.length}</div>
                        <div>冲突: {importPreview.diff.conflictItems.length}</div>
                        <div>将被去重: {importPreview.diff.dedupDropItems.length}</div>
                      </div>
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <button onClick={() => setExpandedDiffSection(expandedDiffSection === 'new' ? null : 'new')}>展开新增</button>
                        <button onClick={() => setExpandedDiffSection(expandedDiffSection === 'conflict' ? null : 'conflict')}>展开冲突</button>
                        <button onClick={() => setExpandedDiffSection(expandedDiffSection === 'dedup' ? null : 'dedup')}>展开去重</button>
                      </div>
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <button onClick={() => setSelectedImportKeys(pickKeysFromEntries(importPreview.entries))}>全选</button>
                        <button onClick={() => setSelectedImportKeys(new Set())}>全不选</button>
                        <button onClick={() => invertSelection(importPreview.entries)}>反选</button>
                        <button onClick={() => setSelectedImportKeys(pickKeysFromEntries(importPreview.diff.newItems))}>仅选新增</button>
                        <button onClick={() => setSelectedImportKeys(pickKeysFromEntries(importPreview.diff.conflictItems))}>仅选冲突</button>
                        <button onClick={saveSelectionTemplate}>保存勾选模板</button>
                        <button onClick={() => restoreSelectionTemplate(importPreview.entries)}>恢复勾选模板</button>
                        <button onClick={deleteSelectionTemplate}>删除模板</button>
                        <button onClick={toggleTemplateLock}>
                          {importTemplateName && importTemplates[importTemplateName]?.locked ? '解锁模板' : '锁定模板'}
                        </button>
                        <button onClick={exportTemplates}>导出模板JSON</button>
                        <label className="inline-detail-btn" style={{ display: 'inline-block' }}>
                          导入模板JSON
                          <input
                            type="file"
                            accept="application/json"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void importTemplatesFromFile(f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <select value={templateGroup} onChange={(e) => setTemplateGroup(e.target.value as 'personal' | 'team' | 'experiment')}>
                          <option value="personal">个人</option>
                          <option value="team">团队</option>
                          <option value="experiment">实验</option>
                        </select>
                        <input
                          value={importTemplateName}
                          onChange={(e) => setImportTemplateName(e.target.value)}
                          placeholder="模板名"
                        />
                        <select
                          value={importTemplateName}
                          onChange={(e) => setImportTemplateName(e.target.value)}
                        >
                          <option value="">选择模板</option>
                          {visibleTemplateNames.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                        <input
                          value={importTemplateSaveAsName}
                          onChange={(e) => setImportTemplateSaveAsName(e.target.value)}
                          placeholder="另存为模板名"
                        />
                        <button onClick={saveAsSelectionTemplate}>另存为</button>
                        <input
                          value={importTemplateRenameTo}
                          onChange={(e) => setImportTemplateRenameTo(e.target.value)}
                          placeholder="重命名为"
                        />
                        <button onClick={renameSelectionTemplate}>重命名</button>
                      </div>
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <input
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          placeholder="搜索模板名/分组"
                        />
                        <select value={templateSortBy} onChange={(e) => setTemplateSortBy(e.target.value as 'savedAt' | 'name' | 'count')}>
                          <option value="savedAt">按时间</option>
                          <option value="name">按名称</option>
                          <option value="count">按条目数</option>
                        </select>
                      </div>
                      <div className="task-quality" style={{ width: '100%', fontSize: 12, maxHeight: 140, overflow: 'auto' }}>
                        <div>模板列表（可批量勾选）</div>
                        {pagedTemplateNames.map((name) => (
                          <label key={`tpl-${name}`} style={{ display: 'flex', gap: 6 }}>
                            <input type="checkbox" checked={selectedTemplates.has(name)} onChange={() => toggleTemplateSelection(name)} />
                            <span>{name} [{importTemplates[name]?.group ?? 'personal'}] ({importTemplates[name]?.selectedKeys.length ?? 0})</span>
                          </label>
                        ))}
                        <div className="task-actions" style={{ marginTop: 6 }}>
                          <button onClick={() => setTemplatePage(Math.max(1, clampedTemplatePage - 1))}>上一页</button>
                          <span style={{ fontSize: 12 }}>第 {clampedTemplatePage}/{totalTemplatePages} 页</span>
                          <button onClick={() => setTemplatePage(Math.min(totalTemplatePages, clampedTemplatePage + 1))}>下一页</button>
                          <select value={templatePageSize} onChange={(e) => setTemplatePageSize(Math.max(1, Number(e.target.value) || 8))}>
                            <option value={5}>5/页</option>
                            <option value={8}>8/页</option>
                            <option value={12}>12/页</option>
                          </select>
                        </div>
                        <div className="task-actions" style={{ marginTop: 6 }}>
                          <button onClick={batchExportTemplates} disabled={selectedTemplates.size === 0}>批量导出</button>
                          <button onClick={() => setPendingBatchAction('delete')} disabled={selectedTemplates.size === 0}>批量删除</button>
                          <button onClick={() => setPendingBatchAction('unlock')} disabled={selectedTemplates.size === 0}>批量解锁</button>
                          <button onClick={() => setPendingBatchAction('lock')} disabled={selectedTemplates.size === 0}>批量加锁</button>
                        </div>
                        <div className="task-actions" style={{ marginTop: 6 }}>
                          <select value={batchTargetGroup} onChange={(e) => setBatchTargetGroup(e.target.value as 'personal' | 'team' | 'experiment')}>
                            <option value="personal">个人</option>
                            <option value="team">团队</option>
                            <option value="experiment">实验</option>
                          </select>
                          <button onClick={() => setPendingBatchAction('group')} disabled={selectedTemplates.size === 0}>批量改分组</button>
                        </div>
                        {templateBatchNotice && <div style={{ marginTop: 6, fontSize: 12 }}>{templateBatchNotice}</div>}
                        {templateBatchReport && (
                          <div className="task-quality" style={{ marginTop: 6, fontSize: 12 }}>
                            <div>批量执行报表</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                <tr><td>成功</td><td>{templateBatchReport.success}</td></tr>
                                <tr><td>跳过</td><td>{templateBatchReport.skipped}</td></tr>
                                <tr><td>locked</td><td>{templateBatchReport.byReason.locked}</td></tr>
                                <tr><td>not_found</td><td>{templateBatchReport.byReason.not_found}</td></tr>
                                <tr><td>conflict</td><td>{templateBatchReport.byReason.conflict}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="task-actions" style={{ marginTop: 6 }}>
                          <button onClick={undoLastBatchOperation} disabled={!lastBatchSnapshot}>撤销上一次批量操作</button>
                        </div>
                      </div>
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <span style={{ fontSize: 12 }}>导入模板冲突策略</span>
                        <select
                          value={templateImportStrategy}
                          onChange={(e) => setTemplateImportStrategy(e.target.value as 'overwrite' | 'only_new' | 'rename_conflict')}
                        >
                          <option value="overwrite">覆盖同名</option>
                          <option value="only_new">仅新增</option>
                          <option value="rename_conflict">重命名冲突</option>
                        </select>
                      </div>
                      {importTemplateName && importTemplates[importTemplateName] && (
                        <div className="task-quality" style={{ width: '100%', fontSize: 12 }}>
                          <div>模板预览: {importTemplateName}</div>
                          <div>保存时间: {new Date(importTemplates[importTemplateName].savedAt).toLocaleString()}</div>
                          <div>条目数: {importTemplates[importTemplateName].selectedKeys.length}</div>
                          <div>去重策略: {importTemplates[importTemplateName].dedupStrategy}</div>
                          <div>时间范围: {importTemplates[importTemplateName].range.from || '-'} ~ {importTemplates[importTemplateName].range.to || '-'}</div>
                          <div>分组: {importTemplates[importTemplateName].group ?? 'personal'}</div>
                          <div>锁定状态: {importTemplates[importTemplateName].locked ? '只读锁定' : '可编辑'}</div>
                        </div>
                      )}
                      {!importTemplateName && (
                        <div className="task-quality" style={{ width: '100%', fontSize: 12 }}>
                          请选择模板查看预览。
                        </div>
                      )}
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <input
                          value={importActionKeyword}
                          onChange={(e) => setImportActionKeyword(e.target.value)}
                          placeholder="按动作/详情关键字筛选并批量勾选"
                        />
                        <button onClick={() => setSelectedImportKeys(applyKeywordFilterKeys(importPreview.entries, importActionKeyword))}>
                          关键字批量勾选
                        </button>
                      </div>
                      {expandedDiffSection && (
                        <div className="task-quality" style={{ width: '100%', maxHeight: 180, overflow: 'auto' }}>
                          {(expandedDiffSection === 'new'
                            ? importPreview.diff.newItems
                            : expandedDiffSection === 'conflict'
                            ? importPreview.diff.conflictItems
                            : importPreview.diff.dedupDropItems
                          ).slice(0, 50).map((item, idx) => {
                            const key = `${item.timestamp}-${item.action}`;
                            return (
                              <label key={`${key}-${idx}`} style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={selectedImportKeys.has(key)}
                                  onChange={() => toggleImportSelection(item)}
                                />
                                <span>[{new Date(item.timestamp).toLocaleTimeString()}] {item.action} - {item.detail}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="task-actions" style={{ width: '100%', marginBottom: 6 }}>
                        <span style={{ fontSize: 12 }}>去重策略</span>
                        <select value={importDedupStrategy} onChange={(e) => setImportDedupStrategy(e.target.value as 'none' | 'timestamp' | 'action')}>
                          <option value="none">全量保留</option>
                          <option value="timestamp">按时间戳去重</option>
                          <option value="action">按动作去重</option>
                        </select>
                      </div>
                      <button
                        disabled={importPreview.entries.length === 0}
                        onClick={() => {
                          const picked = importPreview.entries.filter((e) => selectedImportKeys.has(`${e.timestamp}-${e.action}`));
                          applyImportedTimeline(taskDetail.id, picked, 'replace', importDedupStrategy);
                          setHighlightImportedKeys(new Set(picked.map((e) => `${e.timestamp}-${e.action}`)));
                          setImportPreview(null);
                        }}
                      >
                        覆盖当前时间线（选中项）
                      </button>
                      <button
                        disabled={importPreview.entries.length === 0}
                        onClick={() => {
                          const picked = importPreview.entries.filter((e) => selectedImportKeys.has(`${e.timestamp}-${e.action}`));
                          applyImportedTimeline(taskDetail.id, picked, 'merge', importDedupStrategy);
                          setHighlightImportedKeys(new Set(picked.map((e) => `${e.timestamp}-${e.action}`)));
                          setImportPreview(null);
                        }}
                      >
                        合并到当前时间线（选中项）
                      </button>
                      <button
                        disabled={importPreview.diff.newItems.length === 0}
                        onClick={() => {
                          applyImportedTimeline(taskDetail.id, importPreview.diff.newItems, 'merge', 'none');
                          setHighlightImportedKeys(new Set(importPreview.diff.newItems.map((e) => `${e.timestamp}-${e.action}`)));
                          setImportPreview(null);
                        }}
                      >
                        仅导入新增条目
                      </button>
                      <button onClick={() => setImportPreview(null)}>取消导入</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingBatchAction && (
        <div className="popup-mask" onClick={() => setPendingBatchAction(null)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-head">
              <strong>批量操作确认</strong>
              <button onClick={() => setPendingBatchAction(null)}>✕</button>
            </div>
            <div className="popup-body">
              {(() => {
                const impact = computeBatchImpact();
                return (
                  <div className="task-quality" style={{ marginBottom: 8 }}>
                    <div>执行预览：将成功 {impact.willSucceed.length} 项，将跳过 {impact.willSkip.length} 项。</div>
                    {impact.willSucceed.length > 0 && <div>成功名单：{impact.willSucceed.join(', ')}</div>}
                    {impact.willSkip.length > 0 && <div>跳过名单：{impact.willSkip.join(', ')}</div>}
                    <div>跳过原因分组：</div>
                    <div>- locked: {impact.skipByReason.locked.length > 0 ? impact.skipByReason.locked.join(', ') : '-'}</div>
                    <div>- not_found: {impact.skipByReason.not_found.length > 0 ? impact.skipByReason.not_found.join(', ') : '-'}</div>
                    <div>- conflict: {impact.skipByReason.conflict.length > 0 ? impact.skipByReason.conflict.join(', ') : '-'}</div>
                  </div>
                );
              })()}
              <div className="task-actions" style={{ marginBottom: 8 }}>
                <span>执行模式</span>
                <select
                  value={batchExecutionMode}
                  onChange={(e) => setBatchExecutionMode(e.target.value as 'safe_continue' | 'fail_fast')}
                >
                  <option value="safe_continue">仅执行可成功项（遇错继续）</option>
                  <option value="fail_fast">失败即中断</option>
                </select>
              </div>
              <div>将对 {selectedTemplates.size} 个模板执行：
                {pendingBatchAction === 'delete' ? '批量删除' :
                 pendingBatchAction === 'unlock' ? '批量解锁' :
                 pendingBatchAction === 'lock' ? '批量加锁' : `批量改分组(${batchTargetGroup})`}
              </div>
              <div className="task-actions" style={{ marginTop: 10 }}>
                <button onClick={() => {
                  if (pendingBatchAction === 'delete') batchDeleteTemplates();
                  if (pendingBatchAction === 'unlock') batchUnlockTemplates();
                  if (pendingBatchAction === 'lock') batchLockTemplates();
                  if (pendingBatchAction === 'group') batchChangeGroup();
                  setPendingBatchAction(null);
                }}>
                  确认执行
                </button>
                <button onClick={() => setPendingBatchAction(null)}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
