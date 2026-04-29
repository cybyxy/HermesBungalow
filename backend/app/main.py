from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.gateway import register_ws, router as gateway_router
from .api import prd
from .services.chat_service import chat_service

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

@app.get("/")
async def root():
    return {"status": "HermesBungalow API", "version": "2.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
async def on_startup():
    # 启动后预初始化 Hermes 常驻通道，减少首条消息冷启动开销
    await chat_service.initialize_persistent_channel()


@app.on_event("shutdown")
async def on_shutdown():
    await chat_service.close()
