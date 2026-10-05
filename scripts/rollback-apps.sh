#!/usr/bin/env bash
# Volta o feed de update dos apps para o que estava antes da última publicação (criado por scripts/release-apps.sh).
# Quem já atualizou NÃO volta atrás (sem downgrade): isso só impede novos aparelhos de pegar a versão ruim.
#   scripts/rollback-apps.sh [<desktop>-<android>]     ex.: 1.2.87-1.0.23
set -eu
REMOTE="root@185.193.66.240"; KEY=~/.ssh/notebook_contabo_key
FEED="/home/ntb/web/updates.norteparanegocios.com.br/public_html"
ID="${1:-$(cat /tmp/release-ultimo-backup.txt 2>/dev/null || true)}"
[ -n "$ID" ] || { echo "informe <desktop>-<android> (ex.: 1.2.87-1.0.23) ou rode logo depois de um release"; exit 1; }
ssh -n -i $KEY $REMOTE "set -e; B=/root/backups/feed-pre-$ID; [ -d \$B ] || { echo \"backup \$B não existe\"; exit 1; }
cp -p \$B/desktop/latest.yml $FEED/ntb-vendas-desktop/latest.yml
cp -p \$B/android/latest.json $FEED/ntb-vendas-android/latest.json
chown -R ntb:ntb $FEED/ntb-vendas-desktop $FEED/ntb-vendas-android; echo feed restaurado"
curl -s https://updates.norteparanegocios.com.br/ntb-vendas-desktop/latest.yml | sed -n 1p
curl -s https://updates.norteparanegocios.com.br/ntb-vendas-android/latest.json; echo
