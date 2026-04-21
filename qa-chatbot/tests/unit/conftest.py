"""Unit test conftest — no real database required.

Override the session-scoped ``setup_db`` autouse fixture from the root
conftest so that unit tests can run without a live PostgreSQL instance.
"""

import pytest


@pytest.fixture(scope="session", autouse=True)
def setup_db():  # type: ignore[override]
    """No-op override: unit tests do not need a database."""
    yield
