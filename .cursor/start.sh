#!/usr/bin/env bash
# Per-boot reconciliation for the Scenic Route environment.
# Ensures Node dependencies and a local Postgres are ready before the
# dev terminal runs `npm run dev`. Idempotent: safe to run every start.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_VERSION=16
PG_CLUSTER=main
DB_USER=scenic
DB_PASSWORD=scenic
DB_NAME=scenic_route

# Node dependencies. `install` (npm ci) normally bakes these into the build
# image, but boots from a snapshot/build that lacks them still self-heal here.
if [ ! -d node_modules ] || [ ! -d node_modules/.bin ]; then
  echo "node_modules missing; running npm ci"
  npm ci
fi

# Ensure the Postgres server package is present (no-op when the base image
# already has it, e.g. when booting from a snapshot or prebuilt env build).
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq "postgresql-${PG_VERSION}" postgresql-client
fi

# Ensure a data cluster exists before trying to start it.
if ! sudo pg_lsclusters -h 2>/dev/null | grep -qE "^${PG_VERSION}\s+${PG_CLUSTER}\b"; then
  sudo pg_createcluster "${PG_VERSION}" "${PG_CLUSTER}"
fi

# Start the cluster. Tolerates an already-running server.
sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start 2>/dev/null || true

# Wait until Postgres accepts connections.
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then
    break
  fi
  sleep 1
done

# Ensure the application role and database exist (matches the default
# DATABASE_URL: postgres://scenic:scenic@127.0.0.1:5432/scenic_route).
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

echo "Postgres ${PG_VERSION}/${PG_CLUSTER} ready on 127.0.0.1:5432 (db=${DB_NAME}, user=${DB_USER})"
