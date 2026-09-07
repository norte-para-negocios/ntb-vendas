#!/bin/bash
# Publica o instalador + latest.yml no feed de atualização do Contabo.
# Rodar depois de `npm run dist` (Task 5), da raiz de desktop/.
set -e

DIST_DIR="$(dirname "$0")/../dist"
REMOTE="root@185.193.66.240"
REMOTE_PATH="/var/www/updates-ntb-vendas-desktop"

if [ ! -f "$DIST_DIR/latest.yml" ]; then
  echo "latest.yml não encontrado em $DIST_DIR — rode 'npm run dist' primeiro."
  exit 1
fi

scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR"/*.exe "$DIST_DIR/latest.yml" "$REMOTE:$REMOTE_PATH/"
echo "Publicado em https://updates.norteparanegocios.com.br/ntb-vendas-desktop/"
