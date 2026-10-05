#!/usr/bin/env bash
# Publicação segura dos apps Norte Vendas (Windows + Android). Ver docs/superpowers/plans/2026-10-05-release-seguro.md
#   scripts/release-apps.sh [--dry-run] [--so-windows|--so-android]
# Recusa publicar se: árvore suja, commit fora do origin/main, servidor embutido errado, versão já no feed, portão falhou
# ou o arquivo publicado difere do construído. Guarda o feed anterior para scripts/rollback-apps.sh.
set -u
cd "$(dirname "$0")/.."
REMOTE="root@185.193.66.240"
KEY=~/.ssh/notebook_contabo_key
FEED="/home/ntb/web/updates.norteparanegocios.com.br/public_html"
DRY=0; WIN=1; AND=1
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --so-windows) AND=0;; --so-android) WIN=0;; esac; done
falha() { echo "  FALHOU  $1"; echo; echo "RELEASE ABORTADO: nada foi publicado."; exit 1; }
ok() { echo "  PASSOU  $1"; }

echo "== 1. Estado do repositório"
SUJO="$(git status --porcelain | grep -vE 'mobile/android/capacitor.settings.gradle|scripts/e2e/\.out|\.estado-portao\.json' || true)"
[ -z "$SUJO" ] || { echo "$SUJO" | head -5; falha "há mudança não commitada"; }; ok "árvore limpa"
git fetch -q origin || falha "git fetch"
git merge-base --is-ancestor HEAD origin/main || falha "commit atual não está no origin/main (faça push antes)"; ok "commit $(git rev-parse --short HEAD) está no origin/main"

echo "== 2. Configuração do servidor embutido"
for d in desktop/webapp mobile/webapp; do
  if [ ! -f "$d/.env.local" ]; then
    PRINC="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
    if [ -f "$PRINC/$d/.env.local" ]; then cp "$PRINC/$d/.env.local" "$d/.env.local"; echo "  (copiei $d/.env.local da pasta principal)"; fi
  fi
  [ -f "$d/.env.local" ] || falha "$d/.env.local ausente"
  grep -q "testvendase.norteparanegocios.com.br" "$d/.env.local" || falha "$d/.env.local não aponta para testvendase"
done; ok ".env.local dos dois webapps apontam para o servidor certo"

echo "== 3. Versões"
VW="$(node -p "require('./desktop/package.json').version")"
VA="$(node -p "require('./mobile/package.json').version")"
NOWFEEDW="$(curl -s https://updates.norteparanegocios.com.br/ntb-vendas-desktop/latest.yml | sed -n 's/^version: //p')"
NOWFEEDA="$(curl -s https://updates.norteparanegocios.com.br/ntb-vendas-android/latest.json | sed -n 's/.*"versionName": "\([^"]*\)".*/\1/p')"
if [ "$WIN" = 1 ] && [ "$VW" = "$NOWFEEDW" ]; then falha "desktop $VW já está no feed (suba a versão)"; fi
if [ "$AND" = 1 ] && [ "$VA" = "$NOWFEEDA" ]; then falha "android $VA já está no feed (suba a versão)"; fi
ok "desktop $VW (feed: $NOWFEEDW) | android $VA (feed: $NOWFEEDA)"

echo "== 4. Portão (tsc + testes + build + fluxo)"
bash scripts/e2e/portao-deploy.sh >/tmp/release-portao.log 2>&1 && ok "portão PASSOU" || { tail -15 /tmp/release-portao.log; falha "portão"; }

echo "== 5. Build"
if [ "$WIN" = 1 ]; then
  rm -rf desktop/dist
  (cd desktop && npm run dist >/tmp/release-win.log 2>&1) || { tail -10 /tmp/release-win.log; falha "build Windows"; }
  ok "instalador Windows (a trava conferir-bundle rodou dentro do build)"
fi
if [ "$AND" = 1 ]; then
  (cd mobile && npm run build:web >/tmp/release-and.log 2>&1 && npx cap sync android >>/tmp/release-and.log 2>&1 && cd android && ./gradlew assembleDebug -q >>/tmp/release-and.log 2>&1) || { tail -10 /tmp/release-and.log; falha "build Android"; }
  node scripts/conferir-bundle.mjs mobile/android/app/build/outputs/apk/debug/app-debug.apk || falha "APK com servidor errado"; ok "APK"
fi

if [ "$DRY" = 1 ]; then echo; echo "DRY-RUN: tudo certo, nada publicado."; exit 0; fi

echo "== 6. Backup do feed e publicação"
ID="$NOWFEEDW-$NOWFEEDA"
ssh -n -i $KEY $REMOTE "mkdir -p /root/backups/feed-pre-$ID/desktop /root/backups/feed-pre-$ID/android && cp -p $FEED/ntb-vendas-desktop/latest.yml /root/backups/feed-pre-$ID/desktop/ && cp -p $FEED/ntb-vendas-android/latest.json /root/backups/feed-pre-$ID/android/" || falha "backup do feed"
echo "$ID" > /tmp/release-ultimo-backup.txt
ok "feed anterior guardado em /root/backups/feed-pre-$ID"
if [ "$WIN" = 1 ]; then (cd desktop && bash scripts/publish.sh >/tmp/release-pub-win.log 2>&1) || falha "publicar Windows"; fi
if [ "$AND" = 1 ]; then (cd mobile && bash scripts/publish-android.sh >/tmp/release-pub-and.log 2>&1) || falha "publicar Android"; fi

echo "== 7. Verificação do que foi publicado"
if [ "$WIN" = 1 ]; then
  L=$(stat -f%z "desktop/dist/Norte Vendas Setup $VW.exe")
  R=$(curl -sI "https://updates.norteparanegocios.com.br/ntb-vendas-desktop/Norte%20Vendas%20Setup%20$VW.exe" | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r')
  if [ "$L" = "$R" ]; then ok "Windows no servidor: $R bytes"; else echo "  tamanho local=$L remoto=$R"; falha "Windows publicado diferente do construído (rode scripts/rollback-apps.sh)"; fi
fi
if [ "$AND" = 1 ]; then
  T="$(mktemp -d)"; curl -s -o "$T/a.apk" "https://updates.norteparanegocios.com.br/ntb-vendas-android/Norte-Vendas-$VA.apk"
  if node scripts/conferir-bundle.mjs "$T/a.apk"; then ok "APK baixado do servidor passa na trava"; else falha "APK publicado com servidor errado (rode scripts/rollback-apps.sh)"; fi
fi
echo; echo "RELEASE OK: desktop $VW / android $VA publicados como atualização opcional."
echo "Para desfazer: scripts/rollback-apps.sh"
