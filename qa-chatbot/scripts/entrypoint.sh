#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting QA Chatbot..."
echo "   Environment : ${ENVIRONMENT:-development}"
echo "   Mode        : ${MODE:-api}"

# ── Wait for Postgres ─────────────────────────────────────────
echo "⏳ Waiting for Postgres..."
until python -c "
import asyncio, asyncpg, os, sys
async def check():
    try:
        url = os.environ['DATABASE_URL'].replace('+asyncpg', '')
        conn = await asyncpg.connect(url)
        await conn.close()
    except Exception:
        sys.exit(1)
asyncio.run(check())
" 2>/dev/null; do
    echo "   Postgres not ready — retrying in 2s..."
    sleep 2
done
echo "✅ Postgres ready"

# ── Wait for Redis ────────────────────────────────────────────
echo "⏳ Waiting for Redis..."
until python -c "
import redis, os, sys
try:
    r = redis.from_url(os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))
    r.ping()
except Exception:
    sys.exit(1)
" 2>/dev/null; do
    echo "   Redis not ready — retrying in 2s..."
    sleep 2
done
echo "✅ Redis ready"

# ── Run Migrations ────────────────────────────────────────────
echo "⏳ Running database migrations..."
alembic upgrade head
echo "✅ Migrations complete"

# ── Start Process ─────────────────────────────────────────────
MODE="${MODE:-api}"

case "$MODE" in
    api)
        echo "🌐 Starting FastAPI..."
        exec uvicorn app.main:app \
            --host "0.0.0.0" \
            --port "${PORT:-8000}" \
            --workers "${WORKERS:-4}" \
            --log-level "${LOG_LEVEL:-info}" \
            --no-access-log
        ;;
    worker)
        echo "⚙️  Starting Celery worker..."
        exec celery -A app.workers.celery_app worker \
            --loglevel="${LOG_LEVEL:-info}" \
            --concurrency="${CELERY_CONCURRENCY:-4}" \
            --without-heartbeat \
            --without-gossip
        ;;
    beat)
        echo "⏰ Starting Celery beat..."
        exec celery -A app.workers.celery_app beat \
            --loglevel="${LOG_LEVEL:-info}"
        ;;
    *)
        echo "❌ Unknown MODE: $MODE. Use: api | worker | beat"
        exit 1
        ;;
esac
