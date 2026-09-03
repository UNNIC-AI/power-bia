#!/usr/bin/env bash
#
# One command to get Power BIA running.
#
#   ./start.sh            auto - live mode if .env carries real credentials, demo otherwise
#   ./start.sh demo       navigable app with invented numbers; no Power BI, no OpenAI
#   ./start.sh live       the full pipeline: DAX gateway + Power BI + OpenAI
#   ./start.sh --stop     stop the containers (add --reset to wipe the database too)
#   ./start.sh --status   what is up and what is not
#
# Other flags
#   --reset               drop the Postgres volume and start from an empty database
#   --no-seed             skip db:seed and the demo seed
#   --no-install          skip pnpm install
#   --smoke               query Power BI through the gateway before starting the app
#   --gateway docker|dotnet|none
#
# Nothing here is new: it is README.md and docs/setup.md in the right order, with
# the traps handled: the devshell, exporting .env, the generated secrets and
# rebuilding the workspace packages.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --------------------------------------------------------------------- shell ---
# The host has no node, pnpm or dotnet - the flake provides them. Re-enter the
# devshell instead of telling the user they forgot to.
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v nix >/dev/null 2>&1; then
    printf '\n\033[1;34m==> entering the nix devshell\033[0m\n'
    exec nix develop --command bash "${BASH_SOURCE[0]}" "$@"
  fi
  printf '\033[31m!! neither pnpm nor nix found. Install Nix with flakes - see README.md.\033[0m\n' >&2
  exit 1
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31merror: %s\033[0m\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------- args ---
MODE=auto
GATEWAY=docker
ACTION=start
DO_SEED=1
DO_SMOKE=0
DO_RESET=0
DO_INSTALL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    demo|live|auto) MODE="$1" ;;
    --demo)         MODE=demo ;;
    --live)         MODE=live ;;
    --stop)         ACTION=stop ;;
    --status)       ACTION=status ;;
    --reset)        DO_RESET=1 ;;
    --no-seed)      DO_SEED=0 ;;
    --no-install)   DO_INSTALL=0 ;;
    --smoke)        DO_SMOKE=1 ;;
    --gateway)      GATEWAY="${2:?--gateway needs docker, dotnet or none}"; shift ;;
    -h|--help)      awk 'NR>1 && !/^#/ {exit} NR>1 {sub(/^# ?/, ""); print}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)              die "unknown argument: $1   (./start.sh --help)" ;;
  esac
  shift
done

case "$GATEWAY" in docker|dotnet|none) ;; *) die "--gateway must be docker, dotnet or none" ;; esac

command -v docker >/dev/null 2>&1 || die "docker is not installed - Postgres and the gateway run in compose."
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable. Start it and run this again."

# Every service in the compose file declares a profile, so nothing starts by
# accident. This script runs the API and the web app on the host, so it only
# ever brings up the two it cannot: Postgres and the gateway.
COMPOSE=(docker compose --profile db --profile gateway)

# ----------------------------------------------------------------------- env ---
if [[ ! -f .env ]]; then
  step "creating .env from .env.example"
  cp .env.example .env
  ok ".env created"
fi

env_value() { sed -n "s/^$1=//p" .env | tail -1 | tr -d "\"'" ; }

set_env_value() {
  local key="$1" value="$2"
  if grep -qE "^$key=" .env; then
    sed -i "s|^$key=.*|$key=$value|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# All three want `openssl rand -hex 32`, and all three are validated at import
# time - the API refuses to boot on a malformed one, in demo mode as much as in
# live mode. Only replace a value that is actually malformed: rotating
# DATASET_SECRET_KEY in place makes every stored dataset secret undecryptable.
generated=()
for key in DAX_GATEWAY_TOKEN DATASET_SECRET_KEY SESSION_COOKIE_SECRET; do
  if [[ ! "$(env_value "$key")" =~ ^[0-9a-fA-F]{64}$ ]]; then
    set_env_value "$key" "$(openssl rand -hex 32)"
    generated+=("$key")
  fi
done
if (( ${#generated[@]} )); then
  step "generated missing secrets in .env"
  for key in "${generated[@]}"; do ok "$key"; done
  if [[ " ${generated[*]} " == *" DATASET_SECRET_KEY "* ]]; then
    warn "DATASET_SECRET_KEY was regenerated - any dataset secret already stored can no longer be decrypted (re-run db:seed)"
  fi
fi

# Nothing on the Node side reads .env - no dotenv, no --env-file. Everything
# reads the ambient environment, so it has to be exported here.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:5173}"

is_guid() { [[ "${1:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; }

credentials_look_real() {
  [[ -n "${OPENAI_API_KEY:-}" ]] &&
  is_guid "${PBI_TENANT_ID:-}" && is_guid "${PBI_CLIENT_ID:-}" &&
  [[ -n "${PBI_CLIENT_SECRET:-}" && -n "${PBI_WORKSPACE_NAME:-}" && -n "${PBI_DATASET_NAME:-}" ]]
}

# ------------------------------------------------------------ stop / status ---
if [[ "$ACTION" == stop ]]; then
  step "stopping"
  if (( DO_RESET )); then
    "${COMPOSE[@]}" down -v
    ok "containers stopped, database volume removed"
  else
    "${COMPOSE[@]}" down
    ok "containers stopped, database volume kept"
  fi
  exit 0
fi

port_state() {
  if ss -ltn 2>/dev/null | grep -q ":$1 "; then printf 'in use'; else printf 'free'; fi
}

if [[ "$ACTION" == status ]]; then
  step "containers"
  "${COMPOSE[@]}" ps
  step "ports"
  for p in 5432 8080 3000 5173; do printf '  %-5s %s\n' "$p" "$(port_state "$p")"; done
  step "credentials"
  if credentials_look_real; then ok "OPENAI_API_KEY and PBI_* look real - live mode available"
  else warn "incomplete OPENAI_API_KEY / PBI_* - only demo mode is available"; fi
  exit 0
fi

# ---------------------------------------------------------------------- mode ---
if [[ "$MODE" == auto ]]; then
  if credentials_look_real; then MODE=live; else MODE=demo; fi
fi

if [[ "$MODE" == live ]] && ! credentials_look_real; then
  die "live mode needs OPENAI_API_KEY and all five PBI_* values in .env - see docs/setup.md section 2. Run './start.sh demo' meanwhile."
fi

step "mode: $MODE"
if [[ "$MODE" == demo ]]; then
  ok "demo user, invented numbers, no external calls"
  warn "typing a question fails at the first model call - the demo exercises the renderers, not the pipeline"
  # The startup catalogue refresh would spend its whole timeout on credentials
  # that cannot work. It never blocks listen, but it does fill the log.
  export INTROSPECT_ON_STARTUP=false
else
  ok "live Power BI over XMLA + OpenAI ($LLM_MODEL)"
fi

for p in 3000 5173; do
  if [[ "$(port_state "$p")" == "in use" ]]; then
    die "port $p is already in use - another instance is probably running. './start.sh --status' shows what is up."
  fi
done

# ------------------------------------------------------------------ postgres ---
if (( DO_RESET )); then
  step "resetting the database volume"
  "${COMPOSE[@]}" down -v
  ok "volume removed"
fi

step "starting Postgres"
"${COMPOSE[@]}" up -d postgres
container="$("${COMPOSE[@]}" ps -q postgres)"
for _ in $(seq 1 60); do
  health="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)"
  [[ "$health" == healthy ]] && break
  sleep 1
done
[[ "${health:-}" == healthy ]] || die "Postgres did not become healthy. Logs: ${COMPOSE[*]} logs postgres"
ok "healthy on 5432"

# ------------------------------------------------------------------- gateway ---
gateway_pid=""
cleanup() { [[ -n "$gateway_pid" ]] && kill "$gateway_pid" 2>/dev/null || true; }
trap cleanup EXIT

gateway_healthy() { curl -fsS --max-time 3 http://localhost:8080/health >/dev/null 2>&1; }

start_gateway_dotnet() {
  step "starting the gateway with dotnet run"
  ASPNETCORE_URLS=http://0.0.0.0:8080 \
    dotnet run --project services/dax-gateway -c Release >/tmp/powerbia-gateway.log 2>&1 &
  gateway_pid=$!
  for _ in $(seq 1 90); do
    gateway_healthy && { ok "gateway up on 8080 (pid $gateway_pid, log /tmp/powerbia-gateway.log)"; return 0; }
    kill -0 "$gateway_pid" 2>/dev/null || break
    sleep 1
  done
  gateway_pid=""
  die "the gateway did not come up. Log: /tmp/powerbia-gateway.log"
}


if [[ "$MODE" == live && "$GATEWAY" != none ]] && gateway_healthy; then
  step "DAX gateway"
  ok "already answering on 8080 - leaving it alone"
elif [[ "$MODE" == live && "$GATEWAY" != none ]]; then
  if [[ "$GATEWAY" == docker ]]; then
    step "starting the DAX gateway (container)"
    # The image is not built in CI, so a build problem here is plausible; fall
    # back to running it from source rather than dead-ending on it.
    if "${COMPOSE[@]}" up -d --build dax-gateway; then
      for _ in $(seq 1 90); do
        gateway_healthy && break
        sleep 1
      done
      if gateway_healthy; then
        ok "gateway up on 8080"
      else
        warn "the container started but /health does not answer - falling back to dotnet run"
        "${COMPOSE[@]}" stop dax-gateway >/dev/null 2>&1 || true
        start_gateway_dotnet
      fi
    else
      warn "docker build of the gateway failed - falling back to dotnet run"
      start_gateway_dotnet
    fi
  else
    start_gateway_dotnet
  fi

  if [[ "$DAX_GATEWAY_URL" != http://localhost:8080* && "$DAX_GATEWAY_URL" != http://127.0.0.1:8080* ]]; then
    warn "DAX_GATEWAY_URL is $DAX_GATEWAY_URL but the gateway is on http://localhost:8080"
  fi
elif [[ "$MODE" == live ]]; then
  warn "gateway skipped (--gateway none) - every question will fail at DAX execution"
fi

# ------------------------------------------------------------------ workspace ---
if (( DO_INSTALL )); then
  stamp=node_modules/.powerbia-install-stamp
  if [[ ! -d node_modules || ! -f "$stamp" || pnpm-lock.yaml -nt "$stamp" ]]; then
    step "pnpm install"
    pnpm install
    touch "$stamp"
    ok "dependencies installed"
  fi
fi

# The API runs through tsx, which resolves the workspace packages to their built
# dist/ - and tsx watch does not watch dist/. Editing packages/db or
# packages/contracts does nothing until this runs. It is the single trap that
# cost the most time during development, so it is unconditional.
step "building the workspace packages"
pnpm --filter @powerbia/contracts --filter @powerbia/db build
ok "@powerbia/contracts and @powerbia/db built"

step "applying migrations"
pnpm db:migrate
ok "schema up to date"

if (( DO_SEED )); then
  # Idempotent: a no-op once the dataset row exists. It seeds metadata only:
  # the connection is written by the API on boot, from PBI_*.
  step "seeding the dataset"
  pnpm db:seed

  if [[ "$MODE" == demo ]]; then
    step "seeding the demo account"
    pnpm --filter @powerbia/api demo
    ok "demo@unnic.ai / demo-password-1234"
  fi
fi

# --------------------------------------------------------------------- smoke ---
if (( DO_SMOKE )) && [[ "$MODE" == live ]]; then
  step "smoke-testing the gateway against Power BI"
  # ROW() touches no table, so this isolates auth and connectivity from
  # anything about the model. Cold start is ~18s.
  payload="$(cat <<JSON
{"connection":{"tenantId":"$PBI_TENANT_ID","clientId":"$PBI_CLIENT_ID","clientSecret":"$PBI_CLIENT_SECRET","workspaceName":"$PBI_WORKSPACE_NAME","datasetName":"$PBI_DATASET_NAME"},"dax":"EVALUATE ROW(\"ok\", 1)"}
JSON
)"
  if response="$(curl -fsS --max-time 120 http://localhost:8080/query \
      -H "authorization: Bearer $DAX_GATEWAY_TOKEN" \
      -H 'content-type: application/json' \
      -d "$payload")"; then
    ok "Power BI answered: $response"
  else
    warn "the gateway could not execute DAX. Check the capacity first - XMLA needs Premium, PPU or Fabric with the endpoint set to Read (docs/setup.md section 3.3)."
  fi
fi

# ----------------------------------------------------------------------- run ---
step "starting the app"
printf '  web  http://localhost:5173\n'
printf '  api  http://localhost:3000\n'
if [[ "$MODE" == demo ]]; then
  printf '  log in as demo@unnic.ai / demo-password-1234\n'
else
  printf '  register the first account - it becomes admin; every one after it is a member\n'
fi
if [[ -n "$gateway_pid" ]]; then
  # The gateway is a child of this script, so Ctrl-C takes it with it.
  printf '\n  Ctrl-C stops the dev servers and the gateway; Postgres stays up ("./start.sh --stop").\n'
else
  printf '\n  Ctrl-C stops the dev servers; the containers stay up ("./start.sh --stop").\n'
fi

pnpm dev
