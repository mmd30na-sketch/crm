#!/usr/bin/env bash
# Nightly dump of nodejs430_carla from the mysql-local container. Credentials come from the container's own env
# (never printed). Keeps 14 days. Install: cron `0 3 * * * bash /project/kermanshahcart/crm/scripts/backup-db.sh`
set -euo pipefail
DIR="${CRM_BACKUP_DIR:-/project/_archive/db-backups}"
DB="${CRM_DB_NAME:-nodejs430_carla}"
KEEP_DAYS="${CRM_BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"; chmod 700 "$DIR"
TS=$(TZ=Asia/Tehran date +%Y%m%d-%H%M)
OUT="$DIR/ham-taraz-$TS.sql.gz"
TMP="$OUT.part"
docker exec mysql-local sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces "$0"' "$DB" 2>/dev/null | gzip -9 > "$TMP"
# A valid dump ends with the "Dump completed" trailer.
if zcat "$TMP" | tail -n 1 | grep -q "Dump completed"; then
  mv "$TMP" "$OUT"; chmod 600 "$OUT"
  find "$DIR" \( -name 'ham-taraz-*.sql.gz' -o -name 'carla-*.sql.gz' \) -mtime +"$KEEP_DAYS" -delete
  echo "$(date -Is) OK $(basename "$OUT") $(stat -c %s "$OUT")" >> "$DIR/backup.log"
else
  rm -f "$TMP"; echo "$(date -Is) FAIL" >> "$DIR/backup.log"; exit 1
fi
