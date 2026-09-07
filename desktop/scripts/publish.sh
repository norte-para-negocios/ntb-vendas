#!/bin/bash
# Publica o instalador + latest.yml no feed de atualização do Contabo.
# Rodar depois de `npm run dist` (Task 5), da raiz de desktop/.
set -e

DIST_DIR="$(dirname "$0")/../dist"
REMOTE="root@185.193.66.240"
# Domínio criado via HestiaCP (v-add-web-domain ntb updates.norteparanegocios.com.br),
# não é um vhost estático avulso em /var/www — o docroot real do Hestia é este:
REMOTE_PATH="/home/ntb/web/updates.norteparanegocios.com.br/public_html/ntb-vendas-desktop"

if [ ! -f "$DIST_DIR/latest.yml" ]; then
  echo "latest.yml não encontrado em $DIST_DIR — rode 'npm run dist' primeiro."
  exit 1
fi

# Nunca publicar um *.exe às cegas (glob): se sobrar mais de um instalador em
# dist/ (ex.: resíduo de um bump de versão manual anterior), um glob
# publicaria todos, e o electron-updater dos clientes já instalados passaria
# a ver um arquivo que não bate com o que latest.yml descreve. Em vez disso,
# lê o nome exato do instalador direto do campo `path:` do latest.yml —
# a mesma fonte de verdade que o autoUpdater dos clientes usa — e publica
# só esse arquivo.
EXE_NAME="$(sed -n 's/^path: //p' "$DIST_DIR/latest.yml")"
if [ -z "$EXE_NAME" ]; then
  echo "Não foi possível ler o campo 'path:' de $DIST_DIR/latest.yml."
  exit 1
fi
if [ ! -f "$DIST_DIR/$EXE_NAME" ]; then
  echo "Instalador referenciado por latest.yml não encontrado: $DIST_DIR/$EXE_NAME"
  exit 1
fi

scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR/$EXE_NAME" "$DIST_DIR/latest.yml" "$REMOTE:$REMOTE_PATH/"
ssh -i ~/.ssh/notebook_contabo_key "$REMOTE" "chown -R ntb:ntb '$REMOTE_PATH'"
echo "Publicado em https://updates.norteparanegocios.com.br/ntb-vendas-desktop/"
