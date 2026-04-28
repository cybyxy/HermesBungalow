#!/usr/bin/env python3
"""端到端链路测试：前端 WebSocket → 后端 GatewayBridge → LLM → 事件推送"""
import asyncio
import websockets
import json

async def test_chat_link():
    uri = "ws://localhost:8000/ws/caicai"
    print(f"🔗 连接 WebSocket: {uri}")

    async with websockets.connect(uri) as ws:
        # 接收初始状态
        init = await asyncio.wait_for(ws.recv(), timeout=5)
        print(f"📥 初始状态: {init}")

        # 发送测试消息（注意字段名是 message）
        msg = json.dumps({"type": "chat", "message": "你好，介绍一下你自己"})
        print(f"📤 发送消息: {msg}")
        await ws.send(msg)

        # 接收回复（可能有多个事件帧）
        events_received = []
        reply_text = None

        for _ in range(10):  # 最多收10帧
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=180)
                data = json.loads(raw)
                print(f"📥 收到事件: {data}")
                events_received.append(data)

                if data.get("type") == "chat_reply":
                    reply_text = data.get("reply", "")
                    break
            except asyncio.TimeoutError:
                print("⏰ 超时，停止接收")
                break

        # 验证结果
        print("\n" + "="*50)
        print("✅ 链路测试完成！")
        print(f"   - 收到 {len(events_received)} 个事件帧")
        print(f"   - LLM 回复: {reply_text[:80]}..." if reply_text else "   - ⚠️ 未收到回复")

        # 检查是否有表情/动作事件（嵌套在 chat_reply.events 里）
        has_expr = False
        for e in events_received:
            if "events" in e and isinstance(e["events"], list):
                for ev in e["events"]:
                    if ev.get("type") in ("expression", "action"):
                        has_expr = True
                        break
        if has_expr:
            print(f"   - ✅ LLM 成功返回了表情/动作事件")
        else:
            print(f"   - ⚠️ 未检测到表情/动作事件（可能走了降级模式）")

if __name__ == "__main__":
    asyncio.run(test_chat_link())
