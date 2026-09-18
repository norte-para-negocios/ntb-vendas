# NTB Vendas — Plano do backlog (2026-09-18)

Fonte: pedidos ditados pelo dono em 2026-09-18 + pendências antigas (memória `project_ntb_vendas_backlog_2026_09_15`). Mapeamento de código feito em 2026-09-18 (números de linha são de `StoreModule.tsx`/`ClientModule.tsx` nessa data; reconferir antes de editar).

Regras de execução (valem pra tudo): deploy do web = `git push` + `ssh root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"`; migration = `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < arquivo.sql` + `NOTIFY pgrst, 'reload schema'`; desktop = `cd desktop && npm run dist` + `scripts/publish.sh` (versão atual 1.2.25). Testar no navegador/impressora real antes de dizer "pronto". Nomes de produto/UX: autoexplicativos.

## Decisões que travam o começo (responder antes)

| # | Pergunta | Default se o dono não responder |
|---|---|---|
| D1 | "Cor tá morta / aumenta a cor": é a **escuridão da impressão** ou uma **cor de tela**? Qual tela? | Tratar como impressão fraca (Fase 1C) |
| D2 | "Ver todas as categorias": **sheet com grade de categorias** (pular pra uma) ou **alternar** "tudo empilhado / uma por vez"? Cliente e garçom? | Sheet de categorias nos dois + pílula "Todas" no garçom |
| D3 | Painel "Já pedido" do garçom: só leitura ou permite cancelar item? | Só leitura (cancelar continua na comanda completa) |
| D4 | Papel de cada loja: 58mm, 80mm ou A4? Qual papel está no driver do Windows do caixa do Sertão? | 80mm; validar na impressora real |
| D5 | App na bandeja + iniciar com o Windows: ok? Atualização aplica no "Sair" ou de madrugada? | Sim; aplicar update quando ocioso 3h ou no "Sair" |
| D6 | A frase cortada "Outra coisa é o seguinte da nota fiscal…" | Perguntar |

## Fase 1 — Impressão certa (maior dor na loja)

Problema: cupom sai pequeno "independente do tamanho". Causas mapeadas: (1) `printer_configs` não tem largura; só `stores.config.printer_paper_width_mm`, e o seletor da tela de impressora é só de teste; (2) o PDF do DANFCe vem de `nfe-danfe-pdf` com página fixa de 201pt (~71mm) x 1000pt e fontes 6–8pt; (3) `main.js:475` chama SumatraPDF sem `-print-settings` (default *shrink* encolhe tudo se o papel do driver for mais curto que 353mm); (4) fontes do HTML são px fixos e não crescem com a largura; (5) caminho USB (`print-engine.js`, `print-agent/agent.js`) usa `Consolas 9` fixo e ignora largura.

**1A. Largura do papel por impressora** (M)
- Migration `0NN_printer_paper_width.sql`: `printer_configs.paper_width_mm int not null default 80 check (paper_width_mm in (58,80,210))`; backfill com o valor do store quando existir.
- `PrinterSettingsView.tsx`: campo real "Largura do papel" no cadastro e na edição (substitui o seletor só-de-teste, linhas ~82, 264–280); tipo `PrinterConfig` + funções de `lib/api.ts`.
- Fluxo: `fetchUsbPrinterForAutoprint`/`enqueueReceiptPrintJobs` passam a devolver `paperWidthMm`; `CaixaPrintStation` e os 8 call sites de `paperWidthMm` usam a da impressora de destino, com fallback no store.
- Verificação: cadastrar impressora 58 e 80, imprimir teste → largura muda de fato.

**1B. Cupom fiscal no tamanho certo** (M/L)
- `main.js` `printPdfSilent`: receber `paperWidthMm` e mandar `-print-settings` (`noscale` ou `fit` + `paper=`) conforme a largura; medir na impressora real qual combinação enche o papel.
- PDF: parametrizar largura em `gerarPdfContingencia` (`LARGURA_MM` fixo hoje) e, pro DANFCe oficial, escalar a página do `nfe-danfe-pdf` para a largura da impressora (ou layout pdfkit próprio — **nunca** resumo em texto, o dono rejeitou). Cortar a altura fixa de 1000pt para o tamanho do conteúdo.
- Verificação: emitir NFC-e de homologação, imprimir em 58 e 80; QR legível; sem página em branco.

**1C. Legibilidade/escuridão** (S/M, depende de D1)
- `thermalStyles` (`lib/print.ts:38-59`): fonte do corpo em bold/mais escura e escala de fonte por largura (multiplicador para 58/80); caminho `PrintDocument`: fonte maior/negrito; fiscal: fontes maiores no PDF.
- Verificação: comparar impressão antes/depois lado a lado.

Riscos: precisa de teste em impressora física (não dá pra provar por screenshot). Entregar 1A→1B→1C em commits/deploys separados e testar com o Ramon/André.

## Fase 2 — App desktop em segundo plano (M)

Hoje: sem bandeja, sem autostart, sem single-instance, fecha a janela = encerra (`main.js:504`); motor de impressão e auto-impressão rodam no **renderer** (então precisa manter a janela viva, escondida).
- `requestSingleInstanceLock` + focar janela existente.
- `close` → `hide()` (não encerrar); `Tray` com "Abrir Norte Vendas" / "Sair".
- `webPreferences.backgroundThrottling = false` (timers/polling/Realtime seguem com a janela escondida).
- `app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })` + abrir escondido com `--hidden`.
- Updates: hoje instalam só ao sair; aplicar `quitAndInstall` no "Sair" ou quando ocioso (D5).
- Release 1.2.26; a versão antiga não tem bandeja, então a 1ª atualização exige fechar/reabrir uma vez no PC da loja.
- Verificação (PC Windows real): fechar janela → segue imprimindo comanda nova; reiniciar Windows → app volta na bandeja e imprime; "Sair" encerra de vez.
- Fora de escopo agora: Mac; PC que hiberna (nada a fazer).

## Fase 3 — UX do garçom e do cardápio

**3A. "Já pedido" ao lado do menu do garçom** (M) — `TablesView` View 3 (`:3560-3576`)
- Layout 2 colunas: `StoreTableMenu` à esquerda, painel "Já pedido" à direita (empilha no mobile), scroll próprio (a cadeia `h-full`/`max-h-[70vh]` é frágil, ver comentário `:3567-3572`).
- Dados: `getTableSummary(selectedTable.id)` (`:2509`, já tem itens/subtotal/taxa/total); extrair as linhas da View 2 (comanda) num componente só-leitura compartilhado. Atualização ao vivo já vem de `handleAddItem` (otimista) + `loadData` via Realtime.
- Verificação: adicionar item → aparece no painel na hora; mobile empilhado.

**3B. Botão "Ver todas as categorias"** (S/M, D2)
- Cliente (`ClientModule.tsx:3978-4012`): botão fixo (ícone grade + "Categorias") à esquerda da barra, abre `BottomSheet`/`Modal variant="sheet"` com grade de categorias e contagem; clique chama `handleTabClick(cat.id)` e fecha.
- Garçom (`StoreTableMenu` `:1519-1531`): mesmo sheet; clique = `setActiveCategory`; opcional pílula "Todas".
- Verificação: cardápio com 40 categorias do Sertão no celular (largura ~400px) e no desktop.

## Fase 4 — Realtime entre computadores (L, incerteza alta)
Já descartado (revertido): header do nginx, `DB_AFTER_CONNECT_QUERY`, RLS (controle em tabela pública), upgrade v2.134.10. Regra do debug sistemático: 3 fixes falhos = discutir arquitetura.
- Timebox 1: `LOG_LEVEL=debug` no container `ntb-vendas.supabase-realtime`, reproduzir com o script de teste (subscribe + update) e ler o que o Realtime faz com o evento.
- Se não fechar: **fallback por polling** curto nas telas críticas (mesas/pedidos: `table_change_pings`/`order_change_pings` ou refetch a cada N s) + indicador de "sincronizando".
- Reconciliar `docker-compose.vendas.yml` (falta `DB_AFTER_CONNECT_QUERY` no arquivo; container vivo tem).

## Fase 5 — Demais pendências
- **App lento sem internet**: levantar o sintoma exato (login? mesas? enviar pedido?) medindo; candidato `lib/offline/network.ts` (timeout 4s). (S/M depois de medir)
- **Impressão entre computadores**: fechar venda no Mac → imprimir no PC da impressora; reproduzir com a fila `print_jobs` (parece certa) e achar onde falha. (M)
- **Enviar nota fiscal pro Omie**: desenhar (spec) — ainda não existe; brainstorming antes. (L)
- **Melhoria visual geral**: sem detalhe do dono; levantar com ele. (?)
- **NCM dos 249 produtos do Sertão**: revisão com o contador antes de emissão fiscal real em volume. (S, dependência externa)
- **Pendências do cardápio do Sertão**: Eisenbahn Pilsen/Weiss, Malzbier, Refrigerante 350ml, Gin Fruta, Filé de Peixe (450g) (reativar/criar no Omie); Sodas Artesanais, Cachaça Especiais, Caipirinha 51, Pirão de Moqueca, Café Expresso (criar SKU no Omie e vincular). (dependência do Omie)

## Ordem recomendada
1) Responder D1–D6 → 2) Fase 1 (1A→1B→1C) → 3) Fase 2 → 4) Fase 3 (3A, 3B) → 5) Fase 4 timeboxed → 6) Fase 5 conforme o dono priorizar.
Cada item: implementar, deploy, testar de verdade (navegador para UX; impressora/PC real para Fases 1–2), só então avançar.
