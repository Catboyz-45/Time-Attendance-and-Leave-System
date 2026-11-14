#!/usr/bin/env sh
# กู้คืนฐานข้อมูลจากไฟล์สำรอง (ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด)
# วิธีใช้:  sh scripts/restore.sh backups/webdb-20260101-020000.sql.gz
set -eu

cd "$(dirname "$0")/.."
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "วิธีใช้: sh scripts/restore.sh <ไฟล์สำรอง .sql.gz>"
  exit 1
fi

printf 'จะกู้คืนจาก %s ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด พิมพ์ yes เพื่อยืนยัน: ' "$FILE"
read -r answer
[ "$answer" = "yes" ] || { echo "ยกเลิก"; exit 1; }

gunzip -c "$FILE" | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
echo "กู้คืนเรียบร้อย"
