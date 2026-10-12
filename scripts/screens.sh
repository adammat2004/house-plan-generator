#!/usr/bin/env bash
# Pixel baselines (tests/e2e/screens.spec.ts) are Linux screenshots taken in
# the Playwright Docker image, so they match on every machine and in CI.
#   npm run test:screens            compare with the committed baselines
#   npm run test:screens:update     take new baselines after an intended change
set -euo pipefail

if [ -n "${PLAYWRIGHT_DOCKER:-}" ]; then
  # Inside the image (or the CI job that runs in it).
  npx next build
  exec npx playwright test --project=screens "$@"
fi

version=$(node -p "require('./node_modules/@playwright/test/package.json').version")
image="mcr.microsoft.com/playwright:v${version}-noble"
snapshots="tests/e2e/screens.spec.ts-snapshots"
mkdir -p "$snapshots" test-results

# The repo is copied in without node_modules, which hold this machine's native builds.
docker run --rm --ipc=host --init \
  -e PLAYWRIGHT_DOCKER=1 -e CI=1 \
  -v "$PWD":/src:ro \
  -v "$PWD/$snapshots":/snapshots \
  -v "$PWD/test-results":/results \
  "$image" bash -c '
    set -euo pipefail
    mkdir /work && cd /src
    tar --exclude=./node_modules --exclude=./.next --exclude=./test-results -cf - . | tar -xf - -C /work
    cd /work
    npm ci --no-audit --no-fund
    status=0
    bash scripts/screens.sh "$@" || status=$?
    cp -r tests/e2e/screens.spec.ts-snapshots/. /snapshots/ 2>/dev/null || true
    cp -r test-results/. /results/ 2>/dev/null || true
    exit $status
  ' screens "$@"
