from pathlib import Path

# Project root is 3 levels up from src/app/graph/
_PROMPTS_DIR = Path(__file__).parents[3] / "prompts"


def load_prompt(name: str) -> str:
    """Load a system prompt from the prompts/ directory at the project root.

    Args:
        name: Filename without the .md extension (e.g. "intent_classifier")

    Returns:
        The prompt text, stripped of leading/trailing whitespace.
    """
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
