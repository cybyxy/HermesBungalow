# 语义 → 事件映射引擎
import re
from ..models.prd_model import GatewayEvent

class EventMapper:
    """
    将LLM回复中的语义线索转换为结构化的GatewayEvent。

    规则：
    - "让我想想"、"嗯..." → expression:thinking + action:sit_down
    - "好的！没问题！" → expression:happy + action:wave_hand
    - "我帮你查一下文档" → expression:confused→thinking + action:search_documents + object_reaction:drawer_open
    - "咖啡续命了" → object_reaction:coffee_steam_up + expression:happy
    """

    def map(self, reply: str) -> list[GatewayEvent]:
        events = []
        lower = reply.lower()

        # 思考/疑惑
        if any(kw in lower for kw in ['让我想想', '嗯...', '考虑一下', '分析', '拆解']):
            events.append(GatewayEvent(type='expression', value='thinking'))
            events.append(GatewayEvent(type='action', value='type_on_keyboard'))

        # 开心/确认
        if any(kw in lower for kw in ['好的！', '没问题', '收到', '可以', '当然']):
            events.append(GatewayEvent(type='expression', value='happy'))

        # 搜索文档
        if any(kw in lower for kw in ['查一下', '翻一下', '找一下', '看看文档', 'PRD']):
            events.append(GatewayEvent(type='action', value='search_documents'))
            events.append(GatewayEvent(type='object_reaction', value='open', target='drawer'))

        # 咖啡相关
        if any(kw in lower for kw in ['咖啡', '续命', '喝杯']):
            events.append(GatewayEvent(type='object_reaction', value='coffee_steam_up'))
            events.append(GatewayEvent(type='expression', value='happy'))

        # 惊讶/意外
        if any(kw in lower for kw in ['哇', '天哪', '没想到', '原来']):
            events.append(GatewayEvent(type='expression', value='surprised'))

        # 紧张/尴尬
        if any(kw in lower for kw in ['不好意思', '抱歉', '尴尬', '流汗']):
            events.append(GatewayEvent(type='expression', value='sweat'))

        # 默认：如果没有任何匹配，保持开心表情
        if not events:
            events.append(GatewayEvent(type='expression', value='happy'))

        return events

# 全局事件映射器实例
event_mapper = EventMapper()
