#!/bin/bash
# สำรอง/กู้คืนฐานข้อมูล ทำงานภายในคอนเทนเนอร์ backup (ดู docker-compose.yml)
# ใช้ได้เหมือนกันทั้ง Windows, macOS และ Linux เพราะทุกอย่างรันใน Docker
#
# คำสั่ง (รันที่โฟลเดอร์โปรเจกต์):
#   docker compose exec backup backup now               สำรองทันที
#   docker compose exec backup backup list              ดูไฟล์สำรองทั้งหมด
#   docker compose exec backup backup restore <ไฟล์>    กู้คืนจากไฟล์ (ข้อมูลปัจจุบันจะถูกแทนที่)
# เมื่อเปิดระบบ คอนเทนเนอร์จะสำรองให้อัตโนมัติทุกวันตามเวลา BACKUP_TIME และลบไฟล์ที่เก่ากว่า BACKUP_KEEP_DAYS วัน
set -euo pipefail

BACKUP_DIR=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_TIME="${BACKUP_TIME:-02:00}"
DB_HOST="${DB_HOST:-db}"
# ส่งรหัสผ่านผ่านตัวแปรแทนการพิมพ์ในคำสั่ง
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?ไม่ได้ตั้งค่า MYSQL_ROOT_PASSWORD}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

backup_now() {
  # $1 = ป้ายชื่อ (ไม่บังคับ) เช่น before-restore เพื่อไม่ให้ชื่อไฟล์ชนกับไฟล์อื่น
  local label="${1:+$1-}"
  mkdir -p "$BACKUP_DIR"
  local file tmp
  file="$BACKUP_DIR/webdb-${label}$(date +%Y%m%d-%H%M%S).sql.gz"
  tmp="$file.part"
  if mysqldump -h "$DB_HOST" -uroot --single-transaction --routines --triggers --databases webdb | gzip > "$tmp"; then
    mv "$tmp" "$file"
    chmod 600 "$file"
    log "สำรองข้อมูลแล้ว: $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f "$tmp"
    log "สำรองข้อมูลไม่สำเร็จ" >&2
    return 1
  fi
  find "$BACKUP_DIR" -name 'webdb-*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | while read -r old; do
    log "ลบไฟล์สำรองเก่า: $(basename "$old")"
  done
}

list_backups() {
  ls -lh "$BACKUP_DIR"/webdb-*.sql.gz 2>/dev/null || echo "ยังไม่มีไฟล์สำรอง"
}

restore() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    echo "วิธีใช้: docker compose exec backup backup restore <ชื่อไฟล์>"
    list_backups
    exit 1
  fi
  local file="$BACKUP_DIR/$(basename "$name")"
  [ -f "$file" ] || { echo "ไม่พบไฟล์ $file"; exit 1; }
  printf 'จะกู้คืนจาก %s ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด พิมพ์ yes เพื่อยืนยัน: ' "$(basename "$file")"
  read -r answer
  [ "$answer" = "yes" ] || { echo "ยกเลิก"; exit 1; }
  # ตรวจว่าไฟล์อ่านได้ครบก่อน แล้วสำรองข้อมูลปัจจุบันไว้ (ใช้ชื่อแยก) เผื่อกู้คืนผิดไฟล์
  gzip -t "$file" || { echo "ไฟล์สำรองเสียหาย ยกเลิกการกู้คืน"; exit 1; }
  backup_now before-restore
  gunzip -c "$file" | mysql -h "$DB_HOST" -uroot
  log "กู้คืนจาก $(basename "$file") เรียบร้อย"
}

# สำรองทุกวันตามเวลาที่ตั้งไว้
loop() {
  log "เริ่มทำงาน: สำรองทุกวันเวลา $BACKUP_TIME เก็บไว้ $KEEP_DAYS วัน"
  # ถ้ายังไม่มีไฟล์สำรองภายใน 24 ชั่วโมง ให้สำรองทันที
  if [ -z "$(find "$BACKUP_DIR" -name 'webdb-*.sql.gz' -mtime -1 2>/dev/null)" ]; then
    backup_now || true
  fi
  while true; do
    local now next
    now=$(date +%s)
    next=$(date -d "today $BACKUP_TIME" +%s)
    [ "$next" -le "$now" ] && next=$(date -d "tomorrow $BACKUP_TIME" +%s)
    log "สำรองครั้งถัดไป: $(date -d "@$next" '+%Y-%m-%d %H:%M')"
    sleep $((next - now))
    backup_now || true
  done
}

case "${1:-loop}" in
  loop) loop ;;
  now) backup_now ;;
  list) list_backups ;;
  restore) restore "${2:-}" ;;
  *) echo "คำสั่งที่ใช้ได้: now | list | restore <ไฟล์>"; exit 1 ;;
esac
