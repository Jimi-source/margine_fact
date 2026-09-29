#!/bin/bash
# Фактическая юнит-экономика Ozon из живой базы.
#
#   tools/margin.sh                      последние 8 полных недель, таблицей
#   tools/margin.sh --weeks 4            другое число недель
#   tools/margin.sh --format md          markdown (удобно вставлять в чат)
#   tools/margin.sh --format json        машиночитаемо
#   tools/margin.sh --min-qty 20         порог надёжности выборки
#
# Скрипт сам определяет, какие недели уже закрыты: меряет по реестру заказов,
# за сколько недель доезжает 99,5% начислений, и отбрасывает более свежие —
# в них расход на рекламу завышен, потому что хвост заказов ещё не доставлен.
#
# Реквизиты сервера читаются из vps_credentials.rtf в корне проекта (в git не хранится).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CREDS="$ROOT/vps_credentials.rtf"
HOST="root@31.130.130.129"
REMOTE_DIR="/var/www/marginefact-api"
REMOTE_TMP="$REMOTE_DIR/_margin_facts_$$.js"

if [ ! -f "$CREDS" ]; then
  echo "Не найден $CREDS с реквизитами сервера." >&2
  exit 1
fi
PASS="$(grep -o 'pass:[^}]*' "$CREDS" | head -1 | sed 's/pass: *//' | tr -d '\r\n')"
if [ -z "$PASS" ]; then
  echo "Не удалось прочитать пароль из $CREDS." >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Нужен sshpass: brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

cleanup() { sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$HOST" "rm -f $REMOTE_TMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

sshpass -p "$PASS" scp -o StrictHostKeyChecking=no -q "$ROOT/tools/margin_facts.js" "$HOST:$REMOTE_TMP"
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$HOST" "cd $REMOTE_DIR && node $REMOTE_TMP $*"
