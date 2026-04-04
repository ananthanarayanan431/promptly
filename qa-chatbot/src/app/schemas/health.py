from pydantic import BaseModel

class HealthResponse(BaseModel):
    status: str

class ReadinessResponse(BaseModel):
    status: str
    checks: dict
