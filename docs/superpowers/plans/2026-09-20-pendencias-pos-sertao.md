# Pendências pós-Sertão (NTB Vendas + infra Contabo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar tudo que sobrou depois das fases 1–5 do plano de 2026-09-18 e do incidente de disco de 2026-09-20: infra estável e monitorada, cardápio do Sertão completo, validação em hardware real, e os itens que dependem de decisão do dono (nota→Omie, NCM, visual).

**Architecture:** Trabalho em 4 blocos independentes, na ordem A (infra) → B (cardápio/estoque) → C (validação na loja) → D (decisões do dono). Bloco A e B são executáveis sozinhos; C é checklist humano com critérios de aceite; D só vira código depois de uma spec aprovada.

**Tech Stack:** Next.js 16 / Supabase self-hosted no Contabo (185.193.66.240, chave `~/.ssh/notebook_contabo_key`), Postgres (`supabase-db`: banco `ntb_vendas` = Vendas, banco `postgres` = Estoque + espelho Omie), Electron desktop, Omie API.

**Spec:** `docs/superpowers/plans/2026-09-18-backlog-ntb-vendas.md` (backlog anterior) + memória `project_contabo_disco_cheio_2026-09-20`.

## Global Constraints

- Deploy do web: `git push` + `ssh root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"`. Estoque: `cd /opt/ntb-estoque && rm -rf .next && bash deploy.sh`. **Rodar o deploy com `timeout 300` e em background** (o comando já travou uma vez por processo antigo no servidor).
- Migration: `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < arquivo.sql` + `NOTIFY pgrst, 'reload schema'`.
- **Nunca** ligar o Sertão do Vendas à loja 4 (produção) do estoque: a integração dele aponta para a loja 12 (`is_test`, escrita simulada) de propósito.
- **Nunca** escrever no Omie real sem confirmação explícita do dono no chat.
- Nomes de produto autoexplicativos ("Pastel de Queijo", nunca "Queijo").
- Não enviar nada ao cliente/grupo sem pedido; não mexer em dado de loja real fora do combinado.
- Testar de verdade (navegador/impressora/PC real) antes de dizer "pronto"; postar status curto durante tarefas longas.

---

## Bloco A — Infra e confiabilidade

### Task A1: Alerta de disco no Contabo

Motivo: o disco chegou a 100% sem aviso e o banco ficou ~3h fora do ar.

**Files:**
- Create (no servidor): `/usr/local/bin/disk-alert.sh`
- Modify (no servidor): crontab do root

**Interfaces:**
- Produces: alerta quando `/` passa de 80% (aviso) e 90% (crítico), no máximo 1 aviso por nível a cada 6 h.

**Decisão pendente D-A1 (canal do aviso):** padrão = mensagem de WhatsApp para o número do dono via Evolution API já instalada (texto fixo, sem dado sensível). Se o dono preferir e-mail, trocar só o bloco `enviar()`.

- [ ] **Step 1: Escrever o script (só log + gancho de envio)**

```bash
cat > /usr/local/bin/disk-alert.sh <<'EOF'
#!/bin/bash
set -u
LIMITE_AVISO=80; LIMITE_CRITICO=90
ESTADO=/var/tmp/disk-alert.estado
uso=$(df --output=pcent / | tail -1 | tr -dc '0-9')
nivel=0
[ "$uso" -ge $LIMITE_AVISO ] && nivel=1
[ "$uso" -ge $LIMITE_CRITICO ] && nivel=2
agora=$(date +%s)
ultimo_nivel=0; ultimo_ts=0
[ -f "$ESTADO" ] && read ultimo_nivel ultimo_ts < "$ESTADO"
echo "$(date -Is) uso=${uso}% nivel=$nivel" >> /var/log/disk-alert.log
if [ "$nivel" -gt 0 ] && { [ "$nivel" -gt "$ultimo_nivel" ] || [ $((agora-ultimo_ts)) -ge 21600 ]; }; then
  maiores=$(du -xh --max-depth=2 /opt /root /var 2>/dev/null | sort -rh | head -5 | tr '\n' ';')
  /usr/local/bin/enviar-alerta.sh "DISCO CONTABO ${uso}% (nivel $nivel). Maiores: $maiores"
  echo "$nivel $agora" > "$ESTADO"
fi
[ "$nivel" -eq 0 ] && rm -f "$ESTADO"
EOF
chmod +x /usr/local/bin/disk-alert.sh
```

- [ ] **Step 2: Escrever `enviar-alerta.sh` (gancho)**

Por enquanto só grava em `/var/log/disk-alert.log`; a chamada real à Evolution API entra depois que o dono confirmar D-A1 (nunca enviar mensagem sem ele aprovar o texto e o número).

```bash
cat > /usr/local/bin/enviar-alerta.sh <<'EOF'
#!/bin/bash
echo "$(date -Is) ALERTA: $1" >> /var/log/disk-alert.log
EOF
chmod +x /usr/local/bin/enviar-alerta.sh
```

- [ ] **Step 3: Testar com limite artificial**

Run: `LIMITE_AVISO=1 bash -c 'sed "s/LIMITE_AVISO=80/LIMITE_AVISO=1/" /usr/local/bin/disk-alert.sh | bash'; tail -3 /var/log/disk-alert.log`
Expected: linha `ALERTA: DISCO CONTABO ..%` com os 5 maiores diretórios.

- [ ] **Step 4: Agendar**

Run: `(crontab -l; echo '*/30 * * * * /usr/local/bin/disk-alert.sh') | crontab -`
Expected: `crontab -l | tail -1` mostra a linha.

- [ ] **Step 5: Ligar o canal escolhido (após D-A1)** e disparar um teste real.

- [ ] **Step 6: Registrar** em memória `project_contabo_disco_cheio_2026-09-20` que o alerta existe.

### Task A2: Garantir que a poda do `outbox` funciona

**Files:** crontab do root no servidor; `/var/log/outbox-prune.log`

- [ ] **Step 1: Esperar o primeiro ciclo (minuto 17) e ler o log**

Run: `ssh root@185.193.66.240 "tail -3 /var/log/outbox-prune.log; docker exec supabase-db psql -U supabase_admin -d postgres -At -c \"select count(*), min(created_at) from outbox\""`
Expected: `DELETE n` sem erro; `min(created_at)` nunca mais velho que 3 dias.

- [ ] **Step 2: Confirmar que o crescimento parou**

Run (duas vezes, com 1 h de intervalo): `... -At -c "select count(*) from outbox"`
Expected: contagem estável (não cresce mais que ~100 mil/h).

- [ ] **Step 3: Confirmar que o autovacuum reaproveita o espaço**

Run: `... -At -c "select pg_size_pretty(pg_total_relation_size('outbox')), n_dead_tup from pg_stat_user_tables where relname='outbox'"`
Expected: tamanho estável abaixo de ~4 GB.

### Task A3: Realtime entre computadores — causa raiz

Estado: 4 tentativas de correção falharam; polling de 5s cobre a operação. Suspeito novo: o esquema `realtime` no banco está em 82 migrations, a imagem v2.102.3 só conhece 72 (log `MigrationCountMismatch cached=72 database=82`).

**Files:** nenhum no repo; container `ntb-vendas.supabase-realtime`, `/root/realtime.env`, `/opt/ntb-vendas-infra/docker-compose.vendas.yml`

- [ ] **Step 1: Identificar qual versão da imagem corresponde às 82 migrations**

Run: `ssh root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -At -c 'select max(version), count(*) from realtime.schema_migrations'; docker images --format '{{.Repository}}:{{.Tag}}' | grep realtime"`
Expected: versão máxima e lista de imagens locais. Se a v2.134.x ainda estiver no disco, usar; senão `docker pull supabase/realtime:v2.134.10`.

- [ ] **Step 2: Subir a imagem compatível em paralelo, sem derrubar a atual**

Criar `ntb-vendas.supabase-realtime.novo` com `--env-file /root/realtime.env -e LOG_LEVEL=info`, mesma rede, **outro alias** (`novo.realtime`), sem receber tráfego.

- [ ] **Step 3: Testar evento ponta a ponta contra a instância nova**

Script `probe` (subscribe em `stores` + update sem mudança de valor; ver histórico da sessão 2026-09-19). Expected: `EVENTO UPDATE` recebido em < 5 s.

- [ ] **Step 4a (funcionou):** trocar alias/tag, remover o container antigo, manter polling por mais 1 semana e só então retirar `usePolling` das telas de mesas/balcão/KDS/caixa.
- [ ] **Step 4b (não funcionou):** parar aqui, manter polling como solução definitiva, registrar em memória e **não** tentar uma 6ª correção às cegas.

- [ ] **Step 5: Reconciliar o compose**

`docker-compose.vendas.yml` não reflete o container vivo (`DB_HOST=db` no env-file; `DB_PORT` no compose). Regenerar o serviço `realtime` a partir de `docker inspect` e commitar no repo de infra do servidor.

### Task A4: Backup que sobrevive a incidente

**Files:** `/root/backups-ntb-estoque` (24 GB, no mesmo disco)

- [ ] **Step 1:** Levantar o que é feito hoje (`ls -la`, `crontab -l`, idade do último backup dos DOIS bancos: `ntb_vendas` e `postgres`).
- [ ] **Step 2:** Se o `ntb_vendas` não tem backup diário, criar `pg_dump -Fc` diário com retenção de 7 dias.
- [ ] **Step 3:** Definir cópia fora do servidor (decisão do dono: destino). Não implementar sem essa decisão.

---

## Bloco B — Cardápio do Sertão e estoque

### Task B1: Confirmar que os 5 produtos novos mantêm `pdv = true`

- [ ] **Step 1:** Após 2 ciclos do sync (20 min), rodar:

`docker exec supabase-db psql -U supabase_admin -d postgres -c "select codigo, descricao, pdv from produtos where loja_id=4 and codigo like 'NTBV-SERTAO-%'"`
Expected: os 5 com `pdv = t`.

- [ ] **Step 2 (se voltaram a `f`):** achar onde o sync sobrescreve (`syncProdutos` em `ntb estoque/lib/omie/produto.ts`), corrigir para preservar `pdv` em updates, teste unitário do upsert, deploy do estoque (`rm -rf .next && bash deploy.sh`), remarcar.

### Task B2: Ficha técnica dos 5 produtos novos

Sem ficha, a Ordem de Produção deles retorna "sem estrutura".

- [ ] **Step 1:** Pedir ao Ramon (ou ao responsável pelo estoque do Sertão) os ingredientes e quantidades de: Caipirinha 51, Sodas Artesanais, Pirão de Moqueca, Cachaça Especiais (50 ml), Café Expresso. **Não inventar receita.**
- [ ] **Step 2:** Cadastrar a estrutura no Omie (pela tela do Omie ou pelo fluxo do estoque) e disparar 1 Ordem de Produção de teste na loja de teste (12), confirmando `ok: true`.

### Task B3: Os 8 itens indisponíveis do Sertão

Itens: Gin Fruta, Refrigerante 350ml, Refrigerante KS 290ml, Sprite Fresh 510ml, Eisenbahn Pilsen 355ml, Eisenbahn Weiss 355ml, Malzbier 355ml, Filé de Peixe (450g).

- [ ] **Step 1:** Perguntar ao Ramon, item a item, se ainda existe no cardápio (sim/não).
- [ ] **Step 2 (existe, com código inativo):** reativar no Omie ou criar SKU novo (mesmo script de `IncluirProduto` usado em 2026-09-19, **com confirmação do dono antes**), atualizar `products.omie_codigo` e `available=true`.
- [ ] **Step 3 (não existe):** deixar `available=false` e registrar na memória `project_sertao_cardapio_rebuild_2026_09_17`.
- [ ] **Step 4:** Rodar a auditoria dos códigos (query: todo produto/opção `available=true` sem `omie_codigo`, exceto "Sem borda"/"Sem segundo sabor") e conferir que retorna 0 linhas.

### Task B4: Limpeza pequena no Vendas

- [ ] **Step 1:** Conferir a tela de mesa do garçom (`/loja` → Gestão de Mesas → mesa → Cardápio) após o redesenho em linhas: lista rola, "Já pedido" atualiza ao adicionar item, cancelar item funciona, mobile empilha.
- [ ] **Step 2:** Se algo ainda estiver "errado" segundo o dono, registrar **exatamente qual parte** (modal, categorias, painel) antes de mexer de novo.

---

## Bloco C — Validação na loja (checklist humano; não dá para provar por screenshot)

Cada item só fecha com o resultado observado registrado na memória `project_ntb_vendas_backlog_2026_09_15`.

- [ ] **C1 Impressão térmica 80 mm:** comanda cozinha, comanda bar, conferência e **cupom fiscal**. Aceite: texto legível preto (não cinza), QR do cupom lê, sem página em branco, cupom ocupa a largura do papel.
- [ ] **C2 Impressão 58 mm:** cadastrar impressora 58 em Administração → Impressão e repetir C1. Aceite: nada cortado nas bordas.
- [ ] **C3 App Windows (v1.2.26):** fechar a janela e vender pelo celular → comanda sai; reiniciar o PC → app volta na bandeja e imprime; "Sair" encerra de vez. **A 1ª atualização exige fechar/reabrir uma vez.**
- [ ] **C4 Offline:** desligar a internet do PC do caixa; mesas e balcão carregam do cache em poucos segundos; vender offline e religar → pedido sobe uma vez só (sem duplicar).
- [ ] **C5 Duas máquinas:** vender no computador A e ver a mesa atualizar no B em até ~5 s (polling).
- [ ] **C6 Contingência fiscal:** simular queda da SEFAZ e conferir cupom de contingência + retransmissão em até 2 min.

---

## Bloco D — Precisa de decisão do dono (não codar antes)

### Task D1: Nota fiscal → Omie

- [ ] **Step 1:** Dono escolhe: **A** registrar a venda no Omie com a chave da NFC-e (recomendado), **B** faturar no Omie (conflita com a baixa por Ordem de Produção), **C** só exportar XML ao contador.
- [ ] **Step 2 (só se A):** escrever spec em `docs/superpowers/specs/2026-09-2x-nota-para-omie-design.md`: qual endpoint do Omie, campos, idempotência por chave de acesso, o que acontece se o Omie estiver fora do ar (fila, sem bloquear a venda). Aprovar com o dono, **depois** gerar plano de implementação com TDD.

### Task D2: NCM dos 249 produtos

- [ ] **Step 1:** Exportar CSV `produto, categoria, NCM atual` do Sertão (query em `products`) e entregar ao contador.
- [ ] **Step 2:** Aplicar as correções em lote (script com `update ... from (values ...)`), conferir contagem, e refletir no Omie dos 5 criados em 2026-09-19 (`NCM` provisório).
- [ ] **Step 3:** Só depois liberar emissão fiscal em volume.

### Task D3: Melhoria visual geral

- [ ] **Step 1:** Dono lista 3–5 telas e o que incomoda (ou manda prints). Sem isso, não mexer.
- [ ] **Step 2:** Pesquisa + skill de design + plano curto antes de código; screenshot antes de mostrar (regra `feedback_design_pass_obrigatorio`).

---

## Status (atualizado 2026-09-21)

- **A1 feito** (alerta de disco */30, testado; canal WhatsApp/e-mail ainda pendente — `enviar-alerta.sh` só grava em `/var/log/disk-alert.log`).
- **A2 feito** (poda roda, crescimento ~44k linhas/h, min(created_at)=3 dias).
- **A3 encerrado pelo Step 4b:** v2.134.10 já foi testada com o schema em 82 migrations e teve o mesmo sintoma; env do Realtime do estoque (funciona) é idêntico exceto `DB_NAME`. Polling de 5s (`lib/usePolling.ts`) é a solução definitiva. Compose do servidor continua divergente do container vivo (não mexido).
- **A4 parcial:** backup diário dos dois bancos criado e restore testado (`/usr/local/bin/backup-bancos.sh`, 04:30, retenção 7 d). Falta cópia fora do servidor (decisão do dono).
- **B1 feito** (pdv=true persiste).
- Pendentes: B2/B3 (respostas do Ramon), B4 e Bloco C (validação do dono/loja), Bloco D (decisões).

## Ordem de execução recomendada

1. **A1** (alerta) → **A2** (verificar poda) — protegem a produção agora.
2. **B1** (pdv persiste) e **B4** (garçom) — rápidos.
3. **C1–C6** — validação na loja; bloqueia confiança em tudo que foi entregue.
4. **B2, B3** — dependem de respostas do Ramon.
5. **A3** (Realtime), **A4** (backup).
6. **D1–D3** — quando o dono decidir.

## Self-Review

- Cobertura: backlog aberto de 2026-09-18 (Realtime, offline, impressão, nota→Omie, visual, NCM, pendências Sertão, validações em hardware) + incidente de disco (alerta, poda, backup) — todos têm task.
- Sem placeholders de código: A1/A2/A3/B1 têm comandos exatos; C é checklist com critério de aceite; D depende de decisão explícita (marcada como gate, não como TODO).
- Consistência: nomes (`outbox`, `NTBV-SERTAO-*`, loja 4 = produção, loja 12 = teste) iguais em todas as tasks.
