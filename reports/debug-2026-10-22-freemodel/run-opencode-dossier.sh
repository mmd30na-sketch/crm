#!/usr/bin/env bash
set -euo pipefail
DIR="/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm/reports/debug-2026-10-22-freemodel"
OUT="$DIR/dossier-complete.md"
LOG="$DIR/opencode-run.log"
cd "$DIR"
: >"$LOG"
MODELS=(
  "opencode/deepseek-v4.1-flash-free"
  "opencode/beam-free"
  "opencode/flint-40b-free"
)
for m in "${MODELS[@]}"; do
  echo "trying $m" | tee -a "$LOG"
  set +e
  opencode run --auto --dir "$DIR" -m "$m" \
    --file="$DIR/PROMPT.md" \
    --file="$DIR/dossier.md" \
    --file="$DIR/origin.md" \
    --file="$DIR/server-slices.ts" \
    -- "Follow attached PROMPT.md. Write completed report to $OUT. No deploy. No secrets." \
    >>"$LOG" 2>&1
  rc=$?
  set -e
  echo "exit $rc model=$m" | tee -a "$LOG"
  if [[ $rc -eq 0 && -s "$OUT" ]]; then
    echo "OK $m bytes=$(wc -c < "$OUT")"
    exit 0
  fi
done
echo "all free models failed; see $LOG" >&2
tail -n 40 "$LOG" >&2 || true
exit 1
