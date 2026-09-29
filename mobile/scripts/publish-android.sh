#!/bin/bash
# Publica o APK + latest.json no feed de atualização do app Android (o app lê
# esse latest.json — ver android/.../updater/NtbUpdaterPlugin.kt). Rodar da
# raiz de mobile/ depois de `npm run build:web && npx cap sync android` e
# `cd android && ./gradlew assembleDebug`. Antes de publicar, suba versionCode
# e versionName em android/app/build.gradle e "version" em mobile/package.json.
# Uso: scripts/publish-android.sh [subpasta-remota]   (padrão: ntb-vendas-android)
set -e
cd "$(dirname "$0")/.."

SUB="${1:-ntb-vendas-android}"
REMOTE="root@185.193.66.240"
REMOTE_PATH="/home/ntb/web/updates.norteparanegocios.com.br/public_html/$SUB"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

[ -f "$APK" ] || { echo "APK não encontrado em $APK — rode o assembleDebug primeiro."; exit 1; }
VC="$(sed -n 's/^ *versionCode \([0-9][0-9]*\) *$/\1/p' android/app/build.gradle | head -1)"
VN="$(sed -n 's/^ *versionName "\(.*\)" *$/\1/p' android/app/build.gradle | head -1)"
[ -n "$VC" ] && [ -n "$VN" ] || { echo "Não li versionCode/versionName do build.gradle."; exit 1; }

NAME="Norte-Vendas-$VN.apk"
TMP="$(mktemp -d)"
cp "$APK" "$TMP/$NAME"
printf '{"versionCode": %s, "versionName": "%s", "url": "https://updates.norteparanegocios.com.br/%s/%s"}\n' "$VC" "$VN" "$SUB" "$NAME" > "$TMP/latest.json"

ssh -i ~/.ssh/notebook_contabo_key "$REMOTE" "mkdir -p '$REMOTE_PATH'"
# APK primeiro, latest.json por último: ninguém vê versão nova antes do arquivo existir.
scp -i ~/.ssh/notebook_contabo_key "$TMP/$NAME" "$REMOTE:$REMOTE_PATH/"
scp -i ~/.ssh/notebook_contabo_key "$TMP/latest.json" "$REMOTE:$REMOTE_PATH/"
ssh -i ~/.ssh/notebook_contabo_key "$REMOTE" "chown -R ntb:ntb '$REMOTE_PATH'"
rm -rf "$TMP"
echo "Publicado versionCode=$VC ($VN) em https://updates.norteparanegocios.com.br/$SUB/latest.json"
