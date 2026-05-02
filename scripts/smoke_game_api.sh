#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8000}"
curl -sf "$BASE/health" | python3 -m json.tool
curl -sf "$BASE/api/game/state" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'agents' in d and len(d['agents'])>=1"
echo "smoke ok: $BASE"
