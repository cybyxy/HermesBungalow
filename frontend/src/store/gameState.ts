import { create } from 'zustand';

// 崽崽表情枚举
export type Expression = 'happy' | 'thinking' | 'confused' | 'surprised' | 'tired' | 'sweat' | 'cry' | 'eating';

// WebSocket 连接状态
export type WSStatus = 'disconnected' | 'connecting' | 'open' | 'reconnecting';

// 崽崽状态机
export type CaicaiState = 'IDLE' | 'THINKING' | 'WORKING' | 'TALKING' | 'SEARCHING';

// Gateway 事件类型
export interface GatewayEvent {
  type: 'expression' | 'action' | 'object_reaction' | 'environment_change';
  value: string;
  duration?: number;
  target?: string;
}

// 图片数据（与 ws.ts ImageData 一致，放这里避免循环依赖）
export interface ImageData {
  data_url: string;
  mime_type: string;
  width: number;
  height: number;
}

// 聊天消息 — 支持单图/多图 + 流式
export interface ChatMessage {
  id: string;
  sender: 'caicai' | 'user';
  text: string;
  timestamp: Date;
  image?: ImageData;       // 兼容单图
  images?: ImageData[];    // 多图
  events?: GatewayEvent[];
  _streaming?: boolean;     // 流式进行中（内部标记）
  _thinking?: boolean;      // 思考气泡（临时消息）
}

// PRD 文档
export interface PRDDoc {
  id: string;
  title: string;
  version: string;
  date: string;
  content: string;
}

interface GameState {
  // WebSocket 连接状态
  wsStatus: WSStatus;

  // 崽崽状态
  caicaiState: CaicaiState;
  expression: Expression;

  // 聊天
  messages: ChatMessage[];
  isTyping: boolean;
  sessionId: string | null;
  thinkingTrace: string;
  userAvatar: string;

  // PRD文档
  prdDocs: PRDDoc[];

  // 咖啡能量
  coffeeEnergy: number; // 0-100

  // 动作
  setWsStatus: (status: WSStatus) => void;
  setCaicaiState: (state: CaicaiState) => void;
  setExpression: (expr: Expression) => void;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
  setIsTyping: (typing: boolean) => void;
  setSessionId: (sessionId: string | null) => void;
  appendThinkingTrace: (text: string) => void;
  clearThinkingTrace: () => void;
  setUserAvatar: (avatar: string) => void;
  setCoffeeEnergy: (energy: number) => void;
  handleGatewayEvents: (events: GatewayEvent[]) => void;
  addCoffee: () => void;
}

const DEFAULT_USER_AVATAR = '/assets/sprites/expression1.png';
const USER_AVATAR_STORAGE_KEY = 'hb_user_avatar';
const SESSION_ID_STORAGE_KEY = 'hb_session_id';

const getInitialUserAvatar = (): string => {
  try {
    const saved = window.localStorage.getItem(USER_AVATAR_STORAGE_KEY);
    if (saved && saved.trim()) return saved;
  } catch {
    // ignore
  }
  return DEFAULT_USER_AVATAR;
};

const getInitialSessionId = (): string | null => {
  try {
    const saved = window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // ignore
  }
  return null;
};

export const useGameState = create<GameState>((set, get) => ({
  wsStatus: 'disconnected',
  caicaiState: 'IDLE',
  expression: 'happy',
  messages: [],
  isTyping: false,
  sessionId: getInitialSessionId(),
  thinkingTrace: '',
  userAvatar: getInitialUserAvatar(),
  prdDocs: [],
  coffeeEnergy: 80,

  setWsStatus: (status) => {
    console.log(`[WS] Status → ${status}`);
    set({ wsStatus: status });
  },

  setCaicaiState: (state) => set({ caicaiState: state }),

  setExpression: (expr) => {
    // expression1 = happy/thinking/surprised, expression2 = sweat/cry/eating/confused/tired
    const exprMap: Record<Expression, string> = {
      happy: 'expression1', thinking: 'expression1', surprised: 'expression1',
      confused: 'expression2', tired: 'expression2', sweat: 'expression2', cry: 'expression2', eating: 'expression2',
    };
    console.log(`[Caicai] 切换到表情: ${expr} (${exprMap[expr]}.png)`);
    set({ expression: expr });
    // 通知 Phaser 场景显示表情气泡
    window.dispatchEvent(new CustomEvent('caicai-expression-change', {
      detail: { type: expr },
    }));
  },

  addMessage: (msg) => {
    const { messages } = get();
    set({ messages: [...messages, msg], isTyping: false });
  },
  setMessages: (messages) => set({ messages, isTyping: false }),

  clearMessages: () => set({ messages: [] }),

  setIsTyping: (typing) => set({ isTyping: typing }),
  setSessionId: (sessionId) => {
    set({ sessionId });
    try {
      if (sessionId && sessionId.trim()) {
        window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
      } else {
        window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  },
  appendThinkingTrace: (text) => set((state) => ({ thinkingTrace: `${state.thinkingTrace}${text}\n` })),
  clearThinkingTrace: () => set({ thinkingTrace: '' }),
  setUserAvatar: (avatar) => {
    set({ userAvatar: avatar || DEFAULT_USER_AVATAR });
    try {
      if (avatar && avatar.trim()) {
        window.localStorage.setItem(USER_AVATAR_STORAGE_KEY, avatar);
      } else {
        window.localStorage.removeItem(USER_AVATAR_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  },
  setCoffeeEnergy: (energy) => {
    const normalized = Math.max(0, Math.min(100, energy));
    set({ coffeeEnergy: normalized });
  },

  handleGatewayEvents: (events) => {
    for (const event of events) {
      switch (event.type) {
        case 'expression':
          get().setExpression(event.value as Expression);
          break;
        case 'action':
          if (event.value === 'search_documents') {
            set({ caicaiState: 'SEARCHING' });
          } else if (event.value === 'type_on_keyboard') {
            set({ caicaiState: 'WORKING' });
          }
          break;
        case 'object_reaction':
          // 物件反应（咖啡杯蒸汽、抽屉开关等）
          console.log(`[Object] ${event.value} on ${event.target}`);
          break;
        case 'environment_change':
          console.log(`[Environment] ${event.value}`);
          break;
      }
    }
  },

  addCoffee: () => {
    set({ coffeeEnergy: 100 });
    // 加咖啡后崽崽开心转圈
    get().setExpression('happy');
  },
}));
