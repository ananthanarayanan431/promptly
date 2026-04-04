import uuid
from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.dependencies import get_db
from app.dependencies import get_current_user
from app.dependencies import get_graph
from app.schemas.chat import ChatRequest
from app.schemas.chat import ChatResponse
from app.services.chat_service import ChatService
from app.api.types.response import SuccessResponse

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/", response_model=SuccessResponse[ChatResponse])
async def create_chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
    graph = Depends(get_graph),
):
    if current_user.credits < 10:
        raise HTTPException(status_code=402, detail="Insufficient credits. 10 credits required per run.")
    current_user.credits -= 10

    service = ChatService(db=db, graph=graph)
    result = await service.process(
        user_id=str(current_user.id),
        raw_prompt=request.prompt,
        session_id=str(request.session_id) if request.session_id else str(uuid.uuid4()),
    )
    return SuccessResponse(data=ChatResponse(**result))


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
    graph = Depends(get_graph),
):
    if current_user.credits < 10:
        raise HTTPException(status_code=402, detail="Insufficient credits. 10 credits required per run.")
    current_user.credits -= 10

    service = ChatService(db=db, graph=graph)

    async def event_stream():
        async for chunk in service.stream(
            user_id=str(current_user.id),
            raw_prompt=request.prompt,
            session_id=str(request.session_id) if request.session_id else str(uuid.uuid4()),
        ):
            yield f"data: {chunk}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")