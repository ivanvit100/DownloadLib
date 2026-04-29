#!/usr/bin/env bash
# build-kf8.sh — компилирует assembly/kf8.ts → lib/kf8.wasm
#
# Требования:
#   node >= 18, npm
#
# Первый запуск:
#   npm install --save-dev assemblyscript
#   bash build-kf8.sh
#
# Последующие запуски (AssemblyScript уже установлен):
#   bash build-kf8.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/assembly/kf8.ts"
OUT="${SCRIPT_DIR}/lib/kf8.wasm"
OUT_DEV="${SCRIPT_DIR}/lib/kf8.debug.wasm"

# Проверяем наличие asc
if ! npx --no asc --version &>/dev/null; then
    echo "Устанавливаем AssemblyScript..."
    npm install --save-dev assemblyscript
fi

echo "Компилируем $SRC → $OUT"

# Release build
npx asc "$SRC" \
    --outFile "$OUT" \
    --runtime stub \
    --exportRuntime \
    --optimizeLevel 3 \
    --shrinkLevel 1 \
    2>&1 | grep -v "^WARNING"

echo "Release: $(wc -c < "$OUT") байт → $OUT"

# Debug build (с именами функций для отладки)
npx asc "$SRC" \
    --outFile "$OUT_DEV" \
    --runtime stub \
    --exportRuntime \
    --debug \
    2>&1 | grep -v "^WARNING"

echo "Debug:   $(wc -c < "$OUT_DEV") байт → $OUT_DEV"
echo "Готово."
