#!/usr/bin/env bash
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Config ────────────────────────────────────────────────────
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-8000}"
WORKERS="${WORKERS:-1}"
ENV_FILE=".env"
MAX_WAIT=30   # seconds to wait for postgres/redis

# ── Mode (default: dev) ───────────────────────────────────────
MODE="${1:-dev}"   # dev | prod | worker | migrate-only

# ─────────────────────────────────────────────────────────────
check_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error ".env file not found. Copy .env.example to .env and fill in the values."
    fi
    log_success ".env file found"
}

check_uv() {
    if ! command -v uv &>/dev/null; then
        log_error "uv not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi
    log_success "uv found: $(uv --version)"
}

check_docker() {
    if ! command -v docker &>/dev/null; then
        log_error "Docker not found. Please install Docker."
    fi
    log_success "Docker found"
}

install_deps() {
    log_info "Syncing dependencies with uv..."
    uv sync --all-extras
    log_success "Dependencies synced"
}

start_infra() {
    log_info "Starting Postgres and Redis via Docker Compose..."
    docker compose up postgres redis -d
    log_success "Infrastructure containers started"
}

wait_for_postgres() {
    log_info "Waiting for Postgres to be ready..."
    local count=0
    until docker compose exec postgres pg_isready -U postgres &>/dev/null; do
        count=$((count + 1))
        if [[ $count -ge $MAX_WAIT ]]; then
            log_error "Postgres did not become ready in ${MAX_WAIT}s"
        fi
        echo -n "."
        sleep 1
    done
    echo ""
    log_success "Postgres is ready"
}

wait_for_redis() {
    log_info "Waiting for Redis to be ready..."
    local count=0
    until docker compose exec redis redis-cli ping &>/dev/null; do
        count=$((count + 1))
        if [[ $count -ge $MAX_WAIT ]]; then
            log_error "Redis did not become ready in ${MAX_WAIT}s"
        fi
        echo -n "."
        sleep 1
    done
    echo ""
    log_success "Redis is ready"
}

run_migrations() {
    log_info "Running Alembic migrations..."
    uv run alembic upgrade head
    log_success "Migrations applied"
}

start_dev() {
    log_info "Starting FastAPI in DEV mode (hot-reload, 1 worker)..."
    uv run uvicorn app.main:app \
        --host "$APP_HOST" \
        --port "$APP_PORT" \
        --reload \
        --reload-dir src \
        --log-level debug
}

start_prod() {
    log_info "Starting FastAPI in PROD mode ($WORKERS workers)..."
    uv run uvicorn app.main:app \
        --host "$APP_HOST" \
        --port "$APP_PORT" \
        --workers "$WORKERS" \
        --log-level info \
        --no-access-log
}

start_worker() {
    log_info "Starting Celery worker..."
    uv run celery -A app.workers.celery_app worker \
        --loglevel=info \
        --concurrency=4
}

print_banner() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║        QA Chatbot — Backend          ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
    echo -e "  Mode     : ${YELLOW}${MODE}${NC}"
    echo -e "  Host     : http://${APP_HOST}:${APP_PORT}"
    echo -e "  Docs     : http://localhost:${APP_PORT}/docs"
    echo -e "  Health   : http://localhost:${APP_PORT}/api/v1/health"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────
main() {
    print_banner

    check_env_file
    check_uv
    check_docker
    install_deps
    start_infra
    wait_for_postgres
    wait_for_redis

    case "$MODE" in
        dev)
            run_migrations
            start_dev
            ;;
        prod)
            run_migrations
            start_prod
            ;;
        worker)
            start_worker
            ;;
        migrate-only)
            run_migrations
            log_success "Migration complete. Exiting."
            ;;
        *)
            log_error "Unknown mode: '$MODE'. Use: dev | prod | worker | migrate-only"
            ;;
    esac
}

main