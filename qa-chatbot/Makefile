.PHONY: help install dev worker infra migrate migration rollback dbshell \
        lint format typecheck check test test-unit test-api \
        build prod down logs clean

help:
	@echo ""
	@echo "  QA Chatbot — commands"
	@echo ""
	@echo "  Dev"
	@echo "    make install          Install all dependencies"
	@echo "    make infra            Start Postgres + Redis"
	@echo "    make dev              Start API with hot-reload"
	@echo "    make worker           Start Celery worker"
	@echo ""
	@echo "  Database"
	@echo "    make migrate          Apply pending migrations"
	@echo "    make migration        Create migration  (name=your_name)"
	@echo "    make rollback         Roll back last migration"
	@echo "    make dbshell          Open psql shell"
	@echo ""
	@echo "  Code quality"
	@echo "    make lint             Run ruff linter"
	@echo "    make format           Run ruff formatter"
	@echo "    make typecheck        Run mypy"
	@echo "    make check            Run lint + format + typecheck"
	@echo ""
	@echo "  Testing"
	@echo "    make test             Run all tests with coverage"
	@echo "    make test-unit        Run unit tests"
	@echo "    make test-api         Run integration tests"
	@echo ""
	@echo "  Docker"
	@echo "    make build            Build Docker image"
	@echo "    make prod             Start production stack"
	@echo "    make down             Stop all containers"
	@echo "    make logs             Tail container logs"
	@echo "    make clean            Remove containers + volumes"
	@echo ""

# ── Dev ──────────────────────────────────────────────────────
install:
	uv sync --all-extras

infra:
	docker compose up postgres redis -d

dev:
	uv run uvicorn app.main:app --reload --reload-dir src --port 8000 --log-level debug

worker:
	uv run celery -A app.workers.celery_app worker --loglevel=info --concurrency=4

# ── Database ─────────────────────────────────────────────────
migrate:
	uv run alembic upgrade head

migration:
	@[ "${name}" ] || ( echo "❌ Usage: make migration name=your_migration_name"; exit 1 )
	uv run alembic revision --autogenerate -m "$(name)"

rollback:
	uv run alembic downgrade -1

dbshell:
	docker compose exec postgres psql -U postgres -d qa_chatbot

# ── Code quality ─────────────────────────────────────────────
lint:
	uv run ruff check src/

format:
	uv run ruff format src/

typecheck:
	uv run mypy src/

check: lint format typecheck
	@echo "✅ All checks passed"

# ── Testing ──────────────────────────────────────────────────
test:
	uv run pytest tests/ --cov=app --cov-report=term-missing --cov-report=xml -v

test-unit:
	uv run pytest tests/unit/ -v

test-api:
	uv run pytest tests/integration/ -v

# ── Docker ───────────────────────────────────────────────────
build:
	docker build -t qa-chatbot:latest .

prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	docker compose down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
