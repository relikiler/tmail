#!/bin/bash
# TMAIL backup: encrypted SQLite dump with 14-day rotation
# Run: 0 3 * * * /opt/tokemail/server/backup.sh

set -euo pipefail

BASE=/opt/tokemail
DB=$BASE/server/data/tokemail.db
BK=$BASE/backups
KEEP=14

mkdir -p "$BK"

# Backup encryption key: stored on server (separate from DB). Generate once:
#   openssl rand -base64 32 > "$BK/.backup_key"
KEY_FILE="$BK/.backup_key"
if [ ! -f "$KEY_FILE" ]; then
  umask 077
  openssl rand -base64 32 > "$KEY_FILE"
  echo "[backup] generated new backup key at $KEY_FILE (keep it safe!)"
fi

STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$BK/tokemail-$STAMP.sql"

# Dump database
sqlite3 "$DB" ".dump" > "$DUMP" 2>/dev/null || /usr/bin/sqlite3 "$DB" ".dump" > "$DUMP"

# Encrypt
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 -in "$DUMP" -out "$DUMP.enc" -pass file:"$KEY_FILE"
rm -f "$DUMP"

# Rotate: keep last KEEP encrypted backups
ls -1t "$BK"/tokemail-*.enc 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f

# List
echo "[backup] done: $(ls -1t "$BK"/tokemail-*.enc 2>/dev/null | wc -l) archives (keep $KEEP)"
ls -lh "$BK" | tail -5