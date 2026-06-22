#!/usr/bin/env bash
set -euo pipefail

# ─── colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── helpers ──────────────────────────────────────────────────────────────────
ts()   { date '+%H:%M:%S'; }
log()  { echo -e "${DIM}[$(ts)]${NC} $*"; }
info() { echo -e "${CYAN}[$(ts)] ▶ $*${NC}"; }
ok()   { echo -e "${GREEN}[$(ts)] ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}[$(ts)] ⚠ $*${NC}"; }
die()  { echo -e "${RED}[$(ts)] ✗ $*${NC}" >&2; exit 1; }
sep()  { echo -e "${DIM}───────────────────────────────────────────────────${NC}"; }

# ─── banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║       Promptly Frontend — Dev Server         ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Script dir  : $SCRIPT_DIR"
info "Working dir : $(pwd)"
info "Node        : $(node --version 2>/dev/null || echo 'not found')"
info "npm         : $(npm --version 2>/dev/null || echo 'not found')"
info "Date        : $(date)"
sep

# ─── resolve frontend dir ─────────────────────────────────────────────────────
FRONTEND_DIR="$SCRIPT_DIR"
cd "$FRONTEND_DIR"
log "Changed into: $FRONTEND_DIR"

# ─── check required tools ─────────────────────────────────────────────────────
info "Checking required tools..."

for cmd in node npm; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd found → $($cmd --version)"
  else
    die "$cmd not found — install Node.js 18+"
  fi
done

sep

# ─── check .env.local ─────────────────────────────────────────────────────────
info "Checking environment configuration..."

ENV_FILE="$FRONTEND_DIR/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  ok ".env.local exists"
  log "Validating required variables..."

  REQUIRED_VARS=(NEXT_PUBLIC_API_URL)
  MISSING=()
  for var in "${REQUIRED_VARS[@]}"; do
    if grep -qE "^${var}=" "$ENV_FILE" 2>/dev/null; then
      VAL=$(grep -E "^${var}=" "$ENV_FILE" | cut -d= -f2-)
      ok "  $var = $VAL"
    else
      warn "  $var is NOT set in .env.local"
      MISSING+=("$var")
    fi
  done

  if [[ ${#MISSING[@]} -gt 0 ]]; then
    warn "Missing vars: ${MISSING[*]}"
    warn "Create .env.local with:"
    warn "  NEXT_PUBLIC_API_URL=http://localhost:8000"
  fi
else
  warn ".env.local not found — creating from defaults"
  cat > "$ENV_FILE" <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF
  ok "Created .env.local with NEXT_PUBLIC_API_URL=http://localhost:8000"
fi

sep

# ─── check backend reachability ───────────────────────────────────────────────
API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
# source from file if available
if [[ -f "$ENV_FILE" ]]; then
  API_URL=$(grep -E '^NEXT_PUBLIC_API_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || echo "http://localhost:8000")
fi

info "Checking backend reachability at $API_URL ..."
if curl -sf --max-time 3 "$API_URL/health" &>/dev/null || curl -sf --max-time 3 "$API_URL/docs" &>/dev/null; then
  ok "Backend is reachable at $API_URL"
else
  warn "Backend at $API_URL is not reachable"
  warn "Start the backend first:  cd ../qa-chatbot && make infra && make migrate && make dev"
  warn "Continuing anyway — frontend will start but API calls will fail"
fi

sep

# ─── install dependencies ─────────────────────────────────────────────────────
info "Checking node_modules..."

if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
  MODULE_COUNT=$(find "$FRONTEND_DIR/node_modules" -maxdepth 1 -type d | wc -l | tr -d ' ')
  ok "node_modules exists ($MODULE_COUNT top-level packages)"

  # check if package-lock.json is newer than node_modules
  if [[ "$FRONTEND_DIR/package-lock.json" -nt "$FRONTEND_DIR/node_modules/.package-lock.json" ]] 2>/dev/null; then
    warn "package-lock.json changed since last install — running npm ci"
    info "Running: npm ci"
    npm ci 2>&1 | while IFS= read -r line; do log "  npm | $line"; done
    ok "Dependencies installed (npm ci)"
  else
    log "node_modules is up to date — skipping install"
  fi
else
  info "node_modules not found — running npm install"
  npm install 2>&1 | while IFS= read -r line; do log "  npm | $line"; done
  ok "Dependencies installed"
fi

sep

# ─── typescript check (non-blocking) ──────────────────────────────────────────
info "Running TypeScript type check (non-blocking)..."

if npx tsc --noEmit 2>&1 | tee /tmp/tsc_output.txt; then
  ok "TypeScript: no errors"
else
  TS_ERRORS=$(grep -c 'error TS' /tmp/tsc_output.txt 2>/dev/null || echo "?")
  warn "TypeScript: $TS_ERRORS error(s) found — server will start anyway"
  while IFS= read -r line; do warn "  tsc | $line"; done < /tmp/tsc_output.txt
fi

sep

# ─── lint check (non-blocking) ────────────────────────────────────────────────
info "Running ESLint check (non-blocking)..."

if npm run lint -- --max-warnings 0 2>&1 | tee /tmp/lint_output.txt; then
  ok "ESLint: no warnings or errors"
else
  warn "ESLint issues found — server will start anyway"
  while IFS= read -r line; do warn "  lint | $line"; done < /tmp/lint_output.txt
fi

sep

# ─── launch Next.js dev server ────────────────────────────────────────────────
PORT="${PORT:-3000}"
info "Starting Next.js dev server on port $PORT ..."
log "Command: npm run dev"
log ""
echo -e "${BOLD}${GREEN}  Frontend will be available at: http://localhost:$PORT${NC}"
echo -e "${BOLD}${GREEN}  Press Ctrl+C to stop${NC}"
echo ""
sep

export PORT
exec npm run dev
