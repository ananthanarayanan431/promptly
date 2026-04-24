from pathlib import Path

_PROMPTS_DIR = Path(__file__).parents[4] / "prompts"


def load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
