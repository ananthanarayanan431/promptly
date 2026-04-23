import uuid

from app.models.favorite_prompt import FavoritePrompt


def test_favorite_prompt_defaults() -> None:
    fav = FavoritePrompt(
        user_id=uuid.uuid4(),
        prompt_version_id=uuid.uuid4(),
    )
    assert fav.tags == []
    assert fav.category == "Other"
    assert fav.is_pinned is False
    assert fav.use_count == 0
    assert fav.note is None
    assert fav.last_used_at is None


def test_favorite_prompt_tablename() -> None:
    assert FavoritePrompt.__tablename__ == "favorite_prompts"
