#!/usr/bin/env bash
# Run Elder Link locally, watching the REAL ESP32 door sensor.
#
# Usage:  bash scripts/run-live.sh
#
# Why this is a script rather than a line in a README: two environment details
# are load-bearing and easy to get wrong, and both fail in ways that look like
# bugs in the app rather than misconfiguration.
#
#   1. The sandbox (and some corporate networks) export HTTP_PROXY/HTTPS_PROXY.
#      Those route localhost AND Supabase through a proxy that can reach neither,
#      so everything fails with a bare `TypeError: fetch failed`. Setting
#      NO_PROXY is NOT enough — the proxies must be unset.
#   2. The device is on the flat's LAN over plain HTTP. Node 18+ resolves
#      `localhost` to ::1 first and will not talk to a bare IPv4 LAN address
#      through a proxy, so the board must be reached with no proxy at all.
set -euo pipefail

cd "$(dirname "$0")/.."

unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
export NO_PROXY="127.0.0.1,localhost,10.129.230.175,*.supabase.co"
export no_proxy="$NO_PROXY"

# Load .env into the environment.
#
# This is load-bearing and not obvious: Vite only auto-loads VITE_-prefixed
# variables, so the server-side variables this app runs on — SENSOR_URL,
# SENSOR_ELDER_ID, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TELEPHONY_* — are
# NEVER in process.env when the dev server starts. They have to be exported by
# hand. Worse, the failure is silent: the app boots fine and the sensor is
# simply never watched, so a door left open places no call and nothing says why.
#
# `set -a` marks everything assigned as exported. Values are taken literally
# (no quote/escape processing) so a secret containing spaces or `#` survives.
if [ -f .env ]; then
  while IFS= read -r line; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    case "$line" in
      *=*)
        key="${line%%=*}"
        val="${line#*=}"
        case "$key" in
          *[!A-Za-z0-9_]*) continue ;;
        esac
        export "$key=$val"
        ;;
    esac
  done < .env
fi

# Sensor defaults, only if .env did not supply them.
export SENSOR_URL="${SENSOR_URL:-http://10.129.230.175/data}"
export SENSOR_ELDER_ID="${SENSOR_ELDER_ID:-0ec7a7ef-d938-45f1-b0dd-d741bcd84726}"
export SENSOR_ELDER_LABEL="${SENSOR_ELDER_LABEL:-周伯}"
export SENSOR_DEVICE_ID="${SENSOR_DEVICE_ID:-esp32-door-01}"
export CRON_SECRET="${CRON_SECRET:-cron-test-secret}"

PORT="${PORT:-5174}"

echo "Elder Link — live door sensor"
echo "  device    : $SENSOR_URL"
echo "  elder     : $SENSOR_ELDER_LABEL ($SENSOR_ELDER_ID)"
echo "  app       : http://127.0.0.1:$PORT"
echo ""

# Probe the board before starting, so a dead sensor is obvious now rather than
# discovered as "the call never happened" twenty minutes later.
if curl -s --noproxy '*' --max-time 4 "$SENSOR_URL" >/dev/null 2>&1; then
  echo "  sensor    : REACHABLE  -> $(curl -s --noproxy '*' --max-time 4 "$SENSOR_URL")"
else
  echo "  sensor    : UNREACHABLE (the app will hold state and place no call)"
  echo "              check the board is powered and on the same wifi"
fi
echo ""

exec npx vite dev --port "$PORT" --host 127.0.0.1
