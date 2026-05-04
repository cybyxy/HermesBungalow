export type CollabApproachOpts = { chainFromCurrent?: boolean };

export type CollabWalkApproachImpl = (
  fromAgentId: string,
  peerAgentId: string,
  opts?: CollabApproachOpts,
) => Promise<boolean>;

export type CollabWalkReturnImpl = (fromAgentId: string) => Promise<boolean>;

export type CollabWalkClearImpl = (fromAgentId: string) => void;

let approachImpl: CollabWalkApproachImpl | null = null;
let returnImpl: CollabWalkReturnImpl | null = null;
let clearImpl: CollabWalkClearImpl | null = null;

/** Phaser 挂载后注册；卸载时三个参数均传 `null`。 */
export function registerStudioCollabWalk(
  approach: CollabWalkApproachImpl | null,
  returnWalk: CollabWalkReturnImpl | null,
  clearOverride: CollabWalkClearImpl | null,
): void {
  approachImpl = approach;
  returnImpl = returnWalk;
  clearImpl = clearOverride;
}

/** 一对一转交前：发起人先走到同伴邻格（仅办公室 Tiled 站位时有效）。多目标（如 @所有人 展开）时不调用。 */
export async function runApproachWalkBeforePeerInvoke(
  fromAgentId: string,
  peerAgentId: string,
  opts?: CollabApproachOpts,
): Promise<void> {
  if (!approachImpl) return;
  try {
    await approachImpl(fromAgentId, peerAgentId, opts);
  } catch {
    /* 寻路/动画失败不阻断协作推理 */
  }
}

/** 一对一转交：本批 `@同伴` 对话结束后发起人走回出生点。多目标批处理时不调用。 */
export async function runCollabWalkReturnToSpawn(fromAgentId: string): Promise<void> {
  if (!returnImpl) return;
  try {
    await returnImpl(fromAgentId);
  } catch {
    /* ignore */
  }
}

export function clearCollabWalkFootOverride(fromAgentId: string): void {
  clearImpl?.(fromAgentId);
}
