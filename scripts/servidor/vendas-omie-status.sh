#!/bin/bash
# Norte Vendas: copia para fiscal_notas.omie_status o resultado final da fila do Estoque (vendas_integracao_fila).
# Antes (até 07/11/2026) a nota ficava "na_fila" para sempre mesmo depois de a fila mandar ao Omie (190 do Sertão em out/26).
set -euo pipefail
PSQL="docker exec supabase-db psql -U supabase_admin -v ON_ERROR_STOP=1 -qAt"
ok=$($PSQL -d postgres -c "select coalesce(string_agg(quote_literal(ref), ','), '') from vendas_integracao_fila where tipo='nfce' and status='Concluido' and updated_at > now() - interval '7 days' and ref ~ '^[0-9]{44}$'")
if [ -n "$ok" ]; then
  n=$($PSQL -d ntb_vendas -c "with u as (update fiscal_notas set omie_status='ok', omie_erro=null, omie_em=now() where omie_status in ('na_fila','erro') and chave_acesso in ($ok) returning 1) select count(*) from u")
  [ "$n" != "0" ] && echo "$(date '+%F %T') ok: $n"
fi
$PSQL -d postgres -c "select ref || chr(9) || left(regexp_replace(coalesce(ultimo_erro,'Erro na fila do Estoque'), '[\t\n\r]', ' ', 'g'), 400) from vendas_integracao_fila where tipo='nfce' and status='Erro' and updated_at > now() - interval '7 days' and ref ~ '^[0-9]{44}$'" |
while IFS=$'\t' read -r ch msg; do
  msg=${msg//\'/\'\'}
  n=$($PSQL -d ntb_vendas -c "with u as (update fiscal_notas set omie_status='erro', omie_erro='Fila do Estoque desistiu: $msg', omie_em=now() where omie_status='na_fila' and chave_acesso='$ch' returning 1) select count(*) from u")
  [ "$n" != "0" ] && echo "$(date '+%F %T') erro: $ch"
done
exit 0
