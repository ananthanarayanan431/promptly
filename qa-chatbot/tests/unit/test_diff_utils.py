"""Unit tests for the diff utility (pure logic)."""

from app.utils.diff import compute_diff


def test_compute_diff_identical_texts():
    hunks, stats = compute_diff("hello world", "hello world")
    types = [h.type for h in hunks]
    assert "delete" not in types
    assert "insert" not in types
    assert stats["added"] == 0
    assert stats["removed"] == 0
    assert stats["equal"] > 0


def test_compute_diff_insertion():
    hunks, stats = compute_diff("hello world", "hello beautiful world")
    types = [h.type for h in hunks]
    assert "insert" in types
    assert stats["added"] > 0


def test_compute_diff_deletion():
    hunks, stats = compute_diff("hello beautiful world", "hello world")
    types = [h.type for h in hunks]
    assert "delete" in types
    assert stats["removed"] > 0


def test_compute_diff_replacement():
    hunks, stats = compute_diff("hello world", "goodbye world")
    types = [h.type for h in hunks]
    assert "replace" in types or "delete" in types


def test_compute_diff_empty_strings():
    hunks, stats = compute_diff("", "")
    assert stats["added"] == 0
    assert stats["removed"] == 0
    assert stats["equal"] == 0


def test_compute_diff_empty_to_content():
    hunks, stats = compute_diff("some content", "")
    assert stats["removed"] > 0
    assert stats["added"] == 0


def test_compute_diff_empty_from_content():
    hunks, stats = compute_diff("", "new content")
    assert stats["added"] > 0
    assert stats["removed"] == 0


def test_compute_diff_hunk_types_valid():
    hunks, _ = compute_diff(
        "You are an assistant.",
        "You are an expert assistant. Answer concisely.",
    )
    for hunk in hunks:
        assert hunk.type in ("equal", "insert", "delete", "replace")


def test_compute_diff_replace_hunk_has_from_and_to():
    hunks, _ = compute_diff("hello world", "goodbye planet")
    replace_hunks = [h for h in hunks if h.type == "replace"]
    for h in replace_hunks:
        assert h.from_text is not None
        assert h.to_text is not None


def test_compute_diff_equal_hunk_has_text():
    hunks, _ = compute_diff("hello world today", "hello world tomorrow")
    equal_hunks = [h for h in hunks if h.type == "equal"]
    for h in equal_hunks:
        assert h.text is not None


def test_compute_diff_stats_consistency():
    from_text = "word1 word2 word3 word4"
    to_text = "word1 word3 word4 word5"
    _, stats = compute_diff(from_text, to_text)
    assert isinstance(stats["added"], int)
    assert isinstance(stats["removed"], int)
    assert isinstance(stats["equal"], int)
