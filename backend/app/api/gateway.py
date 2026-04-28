# Hermes Gateway桥接层路由 + WebSocket
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import FastAPI
import json
import asyncio

router = APIRouter(prefix="/api", tags=["Gateway"])

# WebSocket连接管理
active_connections: list[WebSocket] = []


@router.post("/chat")
async def chat(message: dict):
    """对话接口 — 访客发消息 → LLM回复 + 事件标签"""
    from ..services.gateway_bridge import gateway_bridge

    response = await gateway_bridge.send_message(message.get("message", ""))
    return {
        "reply": response.reply,
        "events": [e.model_dump() for e in response.events],
    }


@router.get("/sessions")
async def list_sessions():
    """列出所有会话"""
    from ..services.chat_service import chat_service
    sessions = await chat_service.list_sessions()
    return {"sessions": sessions}


async def ws_endpoint(websocket: WebSocket):
    """WebSocket端点 — 推送崽崽状态变化给前端"""
    await websocket.accept()
    active_connections.append(websocket)

    # 发送初始状态
    from ..services.state_machine import state_machine
    try:
        await websocket.send_json({
            "type": "state_update",
            "state": state_machine.current_state.value,
        })
    except Exception:
        pass

    current_chat_task: asyncio.Task | None = None

    async def run_chat_stream(text: str, images: list):
        from ..services.chat_service import chat_service
        from ..services.state_machine import state_machine, CaicaiState

        state_machine.transition(CaicaiState.THINKING)
        full_reply = ""
        caicai_events = []

        try:
            async for chunk in chat_service.send_message(text, images):
                chunk_type = chunk.get("type")

                if chunk_type == "token":
                    token = chunk.get("text", "")
                    if token:
                        full_reply += token
                        for conn in active_connections[:]:
                            try:
                                await conn.send_json({"type": "token", "text": token})
                            except Exception:
                                active_connections.remove(conn)

                elif chunk_type == "caicai_event":
                    events = chunk.get("events", [])
                    for ev in events:
                        caicai_events.append(ev)
                        for conn in active_connections[:]:
                            try:
                                await conn.send_json({"type": "caicai_event", "event": ev})
                            except Exception:
                                active_connections.remove(conn)

                elif chunk_type == "done":
                    for conn in active_connections[:]:
                        try:
                            await conn.send_json({
                                "type": "chat_reply",
                                "reply": full_reply.strip(),
                                "events": caicai_events,
                            })
                        except Exception:
                            active_connections.remove(conn)
                    state_machine.transition(CaicaiState.TALKING)

                elif chunk_type == "error":
                    error_msg = chunk.get("message", "Unknown error")
                    for conn in active_connections[:]:
                        try:
                            await conn.send_json({"type": "error", "message": error_msg})
                        except Exception:
                            active_connections.remove(conn)
                    state_machine.transition(CaicaiState.IDLE)
        except asyncio.CancelledError:
            for conn in active_connections[:]:
                try:
                    await conn.send_json({"type": "chat_stopped"})
                except Exception:
                    active_connections.remove(conn)
            state_machine.transition(CaicaiState.IDLE)
            raise
        except Exception as e:
            for conn in active_connections[:]:
                try:
                    await conn.send_json({"type": "error", "message": f"连接失败: {str(e)}"})
                except Exception:
                    active_connections.remove(conn)
            state_machine.transition(CaicaiState.IDLE)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON payload"})
                continue

            msg_type = msg.get("type")

            # 心跳：前端每 30s 发 ping，后端必须回 pong，避免客户端误判断连
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "chat":
                if current_chat_task and not current_chat_task.done():
                    current_chat_task.cancel()
                    try:
                        await current_chat_task
                    except asyncio.CancelledError:
                        pass
                text = msg.get("message", "")
                images = msg.get("images", [])
                current_chat_task = asyncio.create_task(run_chat_stream(text, images))
            elif msg_type == "stop":
                if current_chat_task and not current_chat_task.done():
                    current_chat_task.cancel()
                    try:
                        await current_chat_task
                    except asyncio.CancelledError:
                        pass
                else:
                    await websocket.send_json({"type": "chat_stopped"})
            else:
                await websocket.send_json({"type": "error", "message": f"Unsupported message type: {msg_type}"})

    except WebSocketDisconnect:
        pass
    finally:
        if current_chat_task and not current_chat_task.done():
            current_chat_task.cancel()
        if websocket in active_connections:
            active_connections.remove(websocket)


def register_ws(app: FastAPI):
    @app.websocket("/ws/caicai")
    async def ws_route(websocket: WebSocket):
        await ws_endpoint(websocket)
