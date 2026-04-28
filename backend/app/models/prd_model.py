from pydantic import BaseModel
from typing import Optional

class PRDDoc(BaseModel):
    id: str
    title: str
    version: str
    date: str
    content: Optional[str] = None

class ChatRequest(BaseModel):
    message: str

class GatewayEvent(BaseModel):
    type: str  # expression | action | object_reaction | environment_change
    value: str
    duration: Optional[int] = None
    target: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str
    events: list[GatewayEvent] = []
