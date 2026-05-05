import { runOrchestratedAndFlushUi } from '../chat/studioChatActions';
import { buildTaskOrchestrationUserMessage, firstLocalAgentId } from '../chat/taskOrchestrationPrompt';
import * as gameApi from '../services/gameApi';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { isPeerVisitorAgent } from './buildingLayout';
import { Modal } from './Modal';
import { TaskDefinitionForm } from './TaskDefinitionForm';

/** 居中非模态新建任务：仅「创建」或标题栏 × 关闭；点遮罩 / Esc 不关闭；再次打开时表单由 resetKey 重置。 */
export function NewTaskModal() {
  const open = useUiStore((s) => s.newTaskModalOpen);
  const closeNewTaskModal = useUiStore((s) => s.closeNewTaskModal);
  const resetKey = useUiStore((s) => s.newTaskFormResetKey);
  const setSelectedTask = useUiStore((s) => s.setSelectedTask);
  const loadState = useGameStore((s) => s.loadState);

  return (
    <Modal
      open={open}
      title="新建任务"
      onClose={closeNewTaskModal}
      zIndex={1260}
      variant="overlay"
      nonBlocking
      dismissible={false}
      draggable
    >
      <TaskDefinitionForm
        resetKey={resetKey}
        submitLabel="创建"
        onSubmit={async (fv) => {
          const snapshot = useGameStore.getState().snapshot;
          const selectedAgentId = useUiStore.getState().selectedAgentId;
          const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;
          let primaryAgentId: string | undefined;
          if (selectedAgentId) {
            if (selectedAgent && isPeerVisitorAgent(selectedAgent)) {
              useUiStore.getState().appendInference({
                variant: 'status',
                headline: '新建任务',
                body: '当前选中为串门访客，无法作为编排入口；将使用后端建议的本机 Agent 发起推理。',
                agentId: selectedAgentId,
              });
            } else {
              primaryAgentId = selectedAgentId;
            }
          }

          const res = await gameApi.postCreateTask({
            name: fv.name,
            catalog: fv.catalog.trim() || undefined,
            description: fv.description,
            due_at: fv.due_at || undefined,
            estimated_hours: fv.estimated_hours,
            deliverables: fv.deliverables,
            acceptance_criteria: fv.acceptance_criteria,
            primary_agent_id: primaryAgentId,
          });
          closeNewTaskModal();
          if (res.task?.id != null) setSelectedTask(res.task.id);
          await loadState();

          const snap = useGameStore.getState().snapshot;
          const preview =
            (res.orchestration_user_preview ?? '').trim() ||
            buildTaskOrchestrationUserMessage(res.task);
          const suggested = (res.suggested_primary_agent_id ?? '').trim();
          const orchId =
            (primaryAgentId?.trim() ||
              suggested ||
              firstLocalAgentId(snap) ||
              '').trim() || '';

          const loadSilent = () => void useGameStore.getState().loadState({ silent: true });

          if (!orchId || !preview.trim()) {
            if (res.ok) {
              useUiStore.getState().appendInference({
                variant: 'status',
                headline: '新建任务',
                body: '任务已创建；当前没有可用的本机 Agent 作为编排入口，未发起推理。',
                agentId: selectedAgentId,
              });
            }
            return;
          }

          const userIdx = useUiStore.getState().inferenceLog.length;
          useUiStore.getState().appendInference({
            variant: 'user',
            headline: '你 · 新建任务',
            body: preview,
            agentId: orchId,
          });
          try {
            await runOrchestratedAndFlushUi(snap, orchId, preview, undefined, loadSilent);
          } catch (e) {
            useUiStore.getState().appendInference({
              variant: 'error',
              headline: '系统',
              body: e instanceof Error ? e.message : String(e),
              agentId: orchId,
            });
          } finally {
            useUiStore.getState().finalizeInferenceRound(userIdx);
          }
        }}
      />
    </Modal>
  );
}
