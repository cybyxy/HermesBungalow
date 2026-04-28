from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.gateway import register_ws, router as gateway_router
from .api import prd

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
