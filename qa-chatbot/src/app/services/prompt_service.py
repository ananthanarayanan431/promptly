from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.nodes.enhance_prompt import enhance_prompt_node
from app.graph.nodes.guardrails import guardrails_node
from app.graph.state import GraphState
from app.core.exceptions import GuardrailException


class PromptService:
    """
    Handles standalone prompt enhancement — no council vote, no DB persistence.
    Used by the /prompts/enhance endpoint for quick one-shot enhancement.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def enhance(self, raw_prompt: str, user_id: str) -> dict:
        """
        Runs guardrails → enhance_prompt nodes and returns the result.

        Returns:
            dict with keys: raw_prompt, enhanced_prompt
        Raises:
            GuardrailException if the prompt fails safety checks
        """
        state: GraphState = {
            "raw_prompt": raw_prompt,
            "session_id": "",
            "user_id": user_id,
            "enhanced_prompt": "",
            "council_responses": [],
            "final_response": "",
            "messages": [],
            "token_usage": {},
            "error": None,
        }

        # Run guardrails first
        guardrail_result = await guardrails_node(state)
        if guardrail_result.get("error"):
            raise GuardrailException(detail=guardrail_result["error"])

        # Merge guardrail result into state
        state.update(guardrail_result)  # type: ignore[typeddict-item]

        # Enhance the prompt
        enhance_result = await enhance_prompt_node(state)

        return {
            "raw_prompt": raw_prompt,
            "enhanced_prompt": enhance_result["enhanced_prompt"],
        }