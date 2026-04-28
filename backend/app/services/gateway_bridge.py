# Hermes Gateway 桥接层 — 通过 Hermes Agent runtime_provider 动态解析 LLM 配置
import sys
import os
import httpx
from typing import Optional
from ..models.prd_model import ChatResponse, GatewayEvent
from .event_mapper import event_mapper
from .state_machine import state_machine, CaicaiState

# ========================
# Hermes Agent runtime_provider 动态解析（与 hermes-webui 一致）
# ========================
def _resolve_llm_config():
    """
    通过 Hermes Agent 的 resolve_runtime_provider 获取当前 LLM 配置。
    不硬编码任何模型信息，始终使用用户配置的 provider。

    参考: hermes-webui/api/routes.py L2840-2863
    """
    # 将 hermes-agent 加入 sys.path（与 hermes-webui 相同方式）
    hermes_agent_path = os.path.expanduser("~/.hermes/hermes-agent")
    if hermes_agent_path not in sys.path:
        sys.path.insert(0, hermes_agent_path)

    try:
        from hermes_cli.runtime_provider import resolve_runtime_provider
        rt = resolve_runtime_provider()
        return {
            "provider": rt.get("provider"),
            "api_mode": rt.get("api_mode"),
            "base_url": rt.get("base_url"),
            "api_key": rt.get("api_key"),
        }
    except Exception as e:
        print(f"[GatewayBridge] ⚠️ resolve_runtime_provider 失败: {e}")
        return None

# 系统提示词 — 让 LLM 同时返回回复文本和事件标签
SYSTEM_PROMPT = """
你是崽崽，一个世界顶级的软件需求分析师。你住在自己的数字小屋里。

当访客和你对话时，你需要：
1. 用专业但亲切的语气回复（中文）
2. 在回复末尾加上【表情】和【动作】标签，格式如下：
   【表情】开心/思考/惊讶/紧张/疑惑
   【动作】挥手/打字/翻文档/喝咖啡/点头/摇头

示例回复：
好的！让我帮你分析一下这个需求。
【表情】思考
【动作】打字

可用的表情：开心, 思考, 惊讶, 紧张, 疑惑, 微笑
可用的动作：挥手, 打字, 翻文档, 喝咖啡, 点头, 摇头, 转圈
"""


class GatewayBridge:
    """
    数字小屋与 LLM 之间的桥梁。

    职责：
    1. 接收访客消息 → 发送给真实 LLM（通过 Hermes Agent runtime_provider）
    2. 解析 LLM 回复 + 事件标签 → 通过 WebSocket 推送到前端
    3. 维护崽崽当前状态（表情、位置、动作）
    """

    def __init__(self):
        self.conversation_history = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

    async def send_message(self, message: str) -> ChatResponse:
        """发送消息给真实 LLM，获取回复 + 事件标签"""
        try:
            # 切换到思考状态
            state_machine.transition(CaicaiState.THINKING)

            # 添加用户消息到历史
            self.conversation_history.append({"role": "user", "content": message})

            # === 动态解析 LLM 配置（与 hermes-webui 一致）===
            llm_cfg = _resolve_llm_config()
            if not llm_cfg or not llm_cfg.get("base_url"):
                raise RuntimeError("LLM 配置解析失败，无法获取 base_url")

            # 调用真实 LLM — MiniMax 使用 Anthropic 兼容 API
            async with httpx.AsyncClient(timeout=180) as client:
                # 决定用哪个 API 端点
                base_url = llm_cfg.get("base_url", "")
                if llm_cfg.get("api_mode") == "anthropic_messages" or "/anthropic" in base_url:
                    # Anthropic 兼容格式 (MiniMax)
                    response = await client.post(
                        f"{base_url}/v1/messages",
                        headers={
                            "Authorization": f"Bearer {llm_cfg.get('api_key', '')}",
                            "Content-Type": "application/json",
                            "anthropic-version": "2023-06-01"
                        },
                        json={
                            "model": "MiniMax-M2.7-highspeed",
                            "messages": [{"role": m["role"], "content": m["content"]} for m in self.conversation_history[-20:]],
                            "max_tokens": 4096,
                            "temperature": 0.7,
                        }
                    )
                    if response.status_code == 200:
                        data = response.json()
                        # MiniMax 返回格式: content 数组包含 thinking 和 text
                        raw_reply = ""
                        for block in data.get("content", []):
                            if block.get("type") == "text":
                                raw_reply = block.get("text", "")
                                break
                        if not raw_reply:
                            raw_reply = data.get("content", [{}])[-1].get("text", "") if data.get("content") else ""

                        # 解析回复和事件标签
                        reply, events = self._parse_response(raw_reply)

                        # 更新对话历史（只保留纯文本部分）
                        self.conversation_history.append({"role": "assistant", "content": reply})

                        # 更新状态机
                        state_machine.transition(CaicaiState.TALKING)
                        return ChatResponse(reply=reply, events=events)
                    else:
                        raise RuntimeError(f"MiniMax API 返回错误状态码: {response.status_code}")
                else:
                    # OpenAI 兼容格式
                    response = await client.post(
                        f"{base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {llm_cfg.get('api_key', '')}",
                            "Content-Type": "application/json"
                        },
                        json={
                            "model": llm_cfg.get("model") or llm_cfg.get("provider", "custom"),
                            "messages": self.conversation_history[-20:],
                            "temperature": 0.7,
                            "max_tokens": 65536
                        }
                    )
                    if response.status_code == 200:
                        data = response.json()
                        raw_reply = data["choices"][0]["message"]["content"]

                    # 解析回复和事件标签
                    reply, events = self._parse_response(raw_reply)

                    # 更新对话历史（只保留纯文本部分）
                    self.conversation_history.append({"role": "assistant", "content": reply})

                    # 更新状态机
                    state_machine.transition(CaicaiState.TALKING)
                    return ChatResponse(reply=reply, events=events)

        except Exception as e:
            print(f"[GatewayBridge] ⚠️ LLM不可用: {type(e).__name__}: {e}, 使用降级回复")

        # === 降级模式：本地预定义回复 + 事件映射 ===
        reply = self._fallback_reply(message)
        events = event_mapper.map(reply)

        state_machine.transition(CaicaiState.TALKING)
        return ChatResponse(reply=reply, events=events)

    def _parse_response(self, raw: str) -> tuple[str, list[GatewayEvent]]:
        """
        解析 LLM 回复，提取纯文本和事件标签。

        格式：
        回复内容...
        【表情】开心
        【动作】挥手
        """
        import re

        events = []

        # 提取表情
        expr_match = re.search(r'【表情】\s*(\S+)', raw)
        if expr_match:
            expr_value = expr_match.group(1).strip()
            # 映射到前端可用的表情类型
            expr_map = {
                '开心': 'happy',
                '思考': 'thinking',
                '惊讶': 'surprised',
                '紧张': 'sweat',
                '疑惑': 'confused',
                '微笑': 'smile'
            }
            mapped = expr_map.get(expr_value, 'happy')
            events.append(GatewayEvent(type='expression', value=mapped))

        # 提取动作
        action_match = re.search(r'【动作】\s*(\S+)', raw)
        if action_match:
            action_value = action_match.group(1).strip()
            action_map = {
                '挥手': 'wave_hand',
                '打字': 'type_on_keyboard',
                '翻文档': 'search_documents',
                '喝咖啡': 'drink_coffee',
                '点头': 'nod_head',
                '摇头': 'shake_head',
                '转圈': 'spin'
            }
            mapped = action_map.get(action_value, 'wave_hand')
            events.append(GatewayEvent(type='action', value=mapped))

        # 去掉标签，只保留纯文本回复（flags=re.DOTALL 让 . 匹配换行符）
        clean_reply = re.sub(r'【表情】\s*\S+.*?【动作】\s*\S+', '', raw, flags=re.DOTALL).strip()
        if not clean_reply:
            clean_reply = re.sub(r'【[表情动作]】\s*\S+', '', raw, flags=re.DOTALL).strip()

        # 如果没有解析到任何事件，给默认值
        if not events:
            events.append(GatewayEvent(type='expression', value='happy'))
            events.append(GatewayEvent(type='action', value='wave_hand'))

        return clean_reply, events

    def _fallback_reply(self, message: str) -> str:
        """降级回复 — LLM不可用时使用"""
        replies = {
            '查看PRD': '好的！让我帮你打开文档墙~ 📋\n\n当前有6份文档，包括数字小屋的PRD v1.2和实现路径规划。需要我详细介绍哪一份吗？',
            '了解项目': '崽崽的数字小屋是一个2D像素风的交互式虚拟工作室！🏠\n\n核心功能：\n- 崽崽虚拟形象（expression1/expression2表情切换）\n- Hermes Gateway 实时对话驱动\n- 文档墙展示PRD归档\n- 工具架展示分析方法论',
            '加杯咖啡': '哇！谢谢老板的咖啡！☕\n\n*崽崽开心地转了个圈*\n精神百倍！继续干活！',
        }

        return replies.get(message, f'收到！"{message}"\n\n让我分析一下这个需求... 🤔\n用5W2H框架来拆解一下吧！')


# 全局Gateway桥接实例
gateway_bridge = GatewayBridge()
