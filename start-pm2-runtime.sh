#!/usr/bin/env bash
set -euo pipefail
cd /opt/data/naver-booking-ping
export HOME=/opt/data/home
export PM2_HOME=/opt/data/home/.pm2
export PLAYWRIGHT_BROWSERS_PATH=/opt/data/ms-playwright
mkdir -p "$PM2_HOME" logs data
exec ./node_modules/.bin/pm2-runtime ecosystem.config.cjs
