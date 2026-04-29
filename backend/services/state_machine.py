# 崽崽状态机管理
from enum import Enum
import asyncio

class CaicaiState(str, Enum):
    IDLE = "IDLE"
    THINKING = "THINKING"
    WORKING = "WORKING"
    TALKING = "TALKING"
    SEARCHING = "SEARCHING"

class StateMachine:
    def __init__(self):
        self.current_state: CaicaiState = CaicaiState.IDLE
        self.state_history: list[CaicaiState] = [CaicaiState.IDLE]

    @property
    def state(self) -> CaicaiState:
        return self.current_state

    def transition(self, new_state: CaicaiState) -> None:
        """状态转换 — 带合法性检查"""
        valid_transitions = {
            CaicaiState.IDLE: [CaicaiState.THINKING, CaicaiState.WORKING, CaicaiState.TALKING],
            CaicaiState.THINKING: [CaicaiState.WORKING, CaicaiState.SEARCHING, CaicaiState.TALKING, CaicaiState.IDLE],
            CaicaiState.WORKING: [CaicaiState.TALKING, CaicaiState.IDLE],
            CaicaiState.TALKING: [CaicaiState.THINKING, CaicaiState.WORKING, CaicaiState.SEARCHING, CaicaiState.IDLE],
            CaicaiState.SEARCHING: [CaicaiState.TALKING, CaicaiState.IDLE],
        }

        if new_state not in valid_transitions.get(self.current_state, []):
            # 强制转换（容错）
            print(f"[StateMachine] ⚠️ 非法状态转换: {self.current_state} → {new_state}, 强制切换")

        self.current_state = new_state
        self.state_history.append(new_state)
        print(f"[StateMachine] 🔄 {self.current_state.value}")

    def idle_after(self, seconds: int = 3) -> None:
        """定时回到IDLE状态"""
        async def _idle():
            await asyncio.sleep(seconds)
            self.transition(CaicaiState.IDLE)
        asyncio.create_task(_idle())

# 全局状态机实例
state_machine = StateMachine()
