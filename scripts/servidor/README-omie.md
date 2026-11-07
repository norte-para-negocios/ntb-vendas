# Jobs Norte Vendas x Omie no servidor (185.193.66.240), desde 07/11/2026

Instalados no crontab do root (servidor em horário de Berlim, Bahia = CET-4):

| Job | Quando | O que faz | Log |
|---|---|---|---|
| `/usr/local/bin/vendas-omie-status.sh` (cópia: `vendas-omie-status.sh`) | a cada 10 min | copia o resultado da fila do Estoque (`vendas_integracao_fila` Concluido/Erro) para `fiscal_notas.omie_status` | `/var/log/vendas-omie-status.log` |
| `/opt/norte-jobs/reenviar-omie-falhas.cjs` (fonte: `scripts/fiscal/reenviar-omie-falhas.ts`) | de hora em hora (:23) | reenvia ao Omie NFC-e com erro passageiro (502, timeout, bloqueio) dos últimos 3 dias | `/var/log/vendas-omie-reenvio.log` |
| `/opt/norte-jobs/conferencia-omie.py` (cópia: `conferencia-omie.py`) | 07:13 Bahia | confere as notas de ontem contra o contas a receber do Omie e os produtos sem código; manda WhatsApp ao dono só se achar problema | `/var/log/conferencia-omie.log` |

Rebuild do reenvio depois de mudar `lib/omieEnvio*.ts`, `lib/fiscal/payloadOmieDoXml.ts` ou `lib/omie/nota-fiscal.ts`:

    npx esbuild scripts/fiscal/reenviar-omie-falhas.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/tmp/reenviar-omie-falhas.cjs
    scp /tmp/reenviar-omie-falhas.cjs root@185.193.66.240:/opt/norte-jobs/

Rodar a conferência de um dia sem mandar WhatsApp: `python3 /opt/norte-jobs/conferencia-omie.py 2026-11-06 --sem-zap`.
