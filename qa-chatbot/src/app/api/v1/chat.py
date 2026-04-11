import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.types.response import SuccessResponse
from app.dependencies import get_current_user, get_db, get_graph
from app.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/", response_model=SuccessResponse[ChatResponse])
async def create_chat(
    request: ChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    graph: Annotated[Any, Depends(get_graph)],  # noqa: ANN401
) -> SuccessResponse[ChatResponse]:
    if current_user.credits < 10:
        raise HTTPException(
            status_code=402,
            detail="Insufficient credits. 10 credits required per run.",
        )
    current_user.credits -= 10

    service = ChatService(db=db, graph=graph)
    result = await service.process(
        user_id=str(current_user.id),
        raw_prompt=request.prompt,
        session_id=str(request.session_id) if request.session_id else str(uuid.uuid4()),
        feedback=request.feedback,
    )
    return SuccessResponse(data=ChatResponse(**result))
