.PHONY: help install dev worker infra pull migrate migrate-supabase migrate-supabase-sql migration rollback dbshell dbshell-supabase \
        lint format typecheck check test test-unit test-api \
        build prod down logs clean

help:
	@echo ""
	@echo "  QA Chatbot — commands"
	@echo ""
	@echo "  Dev"
	@echo "    make install          Install all dependencies"
	@echo "    make pull             Pull all required Docker images"
	@echo "    make infra            Start Postgres + Redis + MinIO"
	@echo "    make dev              Start API with hot-reload"
	@echo "    make worker           Start Celery worker"
	@echo ""
	@echo "  Database"
	@echo "    make migrate              Apply pending migrations (local Docker)"
	@echo "    make migrate-supabase     Apply pending migrations (Supabase, direct)"
	@echo "    make migrate-supabase-sql Generate SQL to paste into Supabase SQL editor"
	@echo "    make migration            Create migration  (name=your_name)"
	@echo "    make rollback             Roll back last migration (local)"
	@echo "    make dbshell              Open psql shell (local Docker)"
	@echo "    make dbshell-supabase     Open psql shell (Supabase)"
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

pull:
	docker pull pgvector/pgvector:pg16
	docker pull redis:7-alpine
	docker pull minio/minio:latest
	docker pull nginx:alpine

infra:
	docker compose up postgres redis minio -d

dev:
	uv run uvicorn app.main:app --reload --reload-dir src --port 8000 --log-level debug

worker:
	uv run celery -A app.workers.celery_app worker --loglevel=info --concurrency=4

# ── Database ─────────────────────────────────────────────────
migrate:
	uv run alembic upgrade head

migrate-supabase:
	@SUPABASE_DB_URL=$$(grep '^SUPABASE_DB_URL=' .env | cut -d '=' -f2-); \
	echo "🚀  Running Alembic migrations against Supabase..."; \
	DATABASE_URL="$$SUPABASE_DB_URL" uv run alembic upgrade head

migrate-supabase-sql:
	@echo "📄  Generating complete SQL for all Supabase migrations..."
	@echo "    Paste /tmp/supabase_migrations.sql into: Supabase dashboard → SQL Editor → New query → Run"
	@echo ""
	@_URL="postgresql+asyncpg://postgres:placeholder@db.placeholder.supabase.co:5432/postgres"; \
	{ \
		DATABASE_URL="$$_URL" uv run alembic upgrade base:c9f3e5a1d7b2 --sql 2>/dev/null | grep -v '^COMMIT'; \
		printf "\n-- Running upgrade c9f3e5a1d7b2 -> d4a7c2e9b1f5 (partial unique index, skipping live check — safe on empty DB)\n"; \
		printf "CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_category_slug_when_global ON prompt_categories(slug) WHERE user_id IS NULL;\n"; \
		printf "UPDATE alembic_version SET version_num='d4a7c2e9b1f5' WHERE alembic_version.version_num = 'c9f3e5a1d7b2';\n\n"; \
		DATABASE_URL="$$_URL" uv run alembic upgrade d4a7c2e9b1f5:head --sql 2>/dev/null | grep -v '^BEGIN;'; \
	} > /tmp/supabase_migrations.sql
	@echo "✅  $(shell wc -l < /tmp/supabase_migrations.sql | tr -d ' ') lines written to /tmp/supabase_migrations.sql"
	@echo "    Last migration: $(shell grep 'Running upgrade' /tmp/supabase_migrations.sql | tail -1)"

migration:
	@[ "${name}" ] || ( echo "❌ Usage: make migration name=your_migration_name"; exit 1 )
	uv run alembic revision --autogenerate -m "$(name)"

rollback:
	uv run alembic downgrade -1

dbshell:
	docker compose exec postgres psql -U postgres -d qa_chatbot

dbshell-supabase:
	@SUPABASE_DB_URL=$$(grep '^SUPABASE_DB_URL=' .env | cut -d '=' -f2-); \
	PLAIN_URL=$$(echo "$$SUPABASE_DB_URL" | sed 's|postgresql+asyncpg://|postgresql://|'); \
	psql "$$PLAIN_URL"

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
