from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.dependencies import get_current_user
from app.dependencies import get_db
from app.models.user import User
from app.schemas.prompt import PromptEnhanceResponse
from app.schemas.prompt import PromptEnhanceRequest
from app.services.prompt_service import PromptService
from app.api.types.response import SuccessResponse

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.post("/enhance", response_model=SuccessResponse[PromptEnhanceResponse])
async def enhance_prompt(
    request: PromptEnhanceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[PromptEnhanceResponse]:
    """
    Standalone prompt enhancement.
    Runs guardrails + LLM enhancement only — no council vote, no session persistence.
    """
    if current_user.credits < 10:
        raise HTTPException(status_code=402, detail="Insufficient credits. 10 credits required per run.")
    current_user.credits -= 10

    service = PromptService(db=db)
    result = await service.enhance(
        raw_prompt=request.raw_prompt,
        user_id=str(current_user.id),
    )
    return SuccessResponse(data=PromptEnhanceResponse(**result))