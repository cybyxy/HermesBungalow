from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
from .api.gateway import register_ws, router as gateway_router
from .api import prd
from .services.chat_service import chat_service
from .services.hermes_gateway_manager import hermes_gateway_manager
from .services.hermes_webui_service import hermes_webui_service

app = FastAPI(title="HermesBungalow API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prd.router)
app.include_router(gateway_router)
register_ws(app)


class _SkipEnergyAccessLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/api/hermes/energy" not in msg

@app.get("/")
async def root():
    return {"status": "HermesBungalow API", "version": "2.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
async def on_startup():
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _SkipEnergyAccessLog) for f in access_logger.filters):
        access_logger.addFilter(_SkipEnergyAccessLog())
    await hermes_gateway_manager.start()
    await hermes_webui_service.start()
    skip_startup_session = os.getenv("HERMES_SKIP_STARTUP_SESSION", "0").lower() in {"1", "true", "yes"}
    if skip_startup_session:
        print("[ChatService] skipped startup session (HERMES_SKIP_STARTUP_SESSION=1)")
    else:
        sid = await chat_service.create_startup_session()
        print(f"[ChatService] startup new session created: {sid}")
        # 启动后预初始化 Hermes 常驻通道，减少首条消息冷启动开销
        await chat_service.initialize_persistent_channel()


@app.on_event("shutdown")
async def on_shutdown():
    await hermes_webui_service.stop()
    await hermes_gateway_manager.stop()
    await chat_service.close()
