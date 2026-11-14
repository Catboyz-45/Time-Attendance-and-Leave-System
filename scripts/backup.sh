#!/usr/bin/env sh
# สำรองฐานข้อมูลเป็นไฟล์ backups/webdb-YYYYmmdd-HHMMSS.sql.gz และลบไฟล์สำรองที่เก่ากว่า KEEP_DAYS วัน
# วิธีใช้ (รันที่โฟลเดอร์หลักของโปรเจกต์):  sh scripts/backup.sh
# ตั้งให้รันอัตโนมัติทุกคืน (crontab -e):    0 2 * * * cd /path/to/project && sh scripts/backup.sh
set -eu

cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_DIR="backups"
FILE="$BACKUP_DIR/webdb-$(date +%Y%m%d-%H%M%S).sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ใช้รหัสผ่าน root จากตัวแปรในคอนเทนเนอร์ (ไม่ต้องพิมพ์รหัสผ่านในคำสั่ง)
docker compose exec -T db sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases webdb' \
  | gzip > "$FILE"

chmod 600 "$FILE"
echo "สำรองข้อมูลแล้ว: $FILE"

find "$BACKUP_DIR" -name 'webdb-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
