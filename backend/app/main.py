"""
HermesBungalow - 智能家居监控可视化小屋
FastAPI 主应用入口
"""
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="HermesBungalow",
    description="智能家居监控可视化小屋 API",
    version="0.1.0",
)

# CORS 配置 - 允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "HermesBungalow API", "status": "running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# TODO: 添加设备管理、房间管理、实时数据推送等API

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
