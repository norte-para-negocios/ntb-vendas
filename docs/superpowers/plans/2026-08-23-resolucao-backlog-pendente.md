# Resolução do backlog pendente (formato, PIN, jurisdição, emissão por venda, XML, cor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os itens do backlog de 21/08 que dependem só de código, deixando explícito o que continua travado em ação humana (SEFAZ, fotos, arquivo do relatório de margem, decisão de produto com o Ramon).

**Architecture:** Seis tarefas independentes, cada uma tocando uma área diferente do sistema. Sem dependência entre elas — podem ser feitas em qualquer ordem.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Supabase (Postgres + RPCs `security definer`).

**Spec:** Sem documento separado. Fonte é `docs/backlog-2026-08-21-garcom-caixa.md`, itens 1, 6, 9, 13, e a ideia de cor por loja levantada em 23/08. Onde o backlog registrava "ponto em aberto pro usuário" sem resposta, este plano fixa um default sensato — documentado em cada tarefa — em vez de bloquear esperando resposta, por pedido explícito do usuário ("resolva o que falta").

## Global Constraints

- **As 7 lojas reais não podem mudar de comportamento** onde a feature não for explicitamente ligada. Todo campo/config novo é opt-in, com ausência = comportamento de hoje.
- **Produção (Contabo) é o único banco.** `.env.local` aponta pra lá. Toda migration vai só nesse banco (não existe mais banco de dev separado sendo usado).
- Migration sempre com `notify pgrst, 'reload schema';` no final.
- `SERVICE_FEE_RATE` e formatação de dinheiro só em `lib/calc.ts`.
- `escapeHtml()` obrigatório em todo campo de texto livre que chega em documento impresso.
- Rótulo de enum sempre de `lib/labels.ts`, nunca inline.
- Motion: só `SPRING_TAP`/`SPRING_SHEET`. Tailwind v4, tokens semânticos, nunca hex cru.
- Sem suíte de testes. `npm run build` é o portão.
- **Nunca emitir nota fiscal real em teste.** Homologação sempre.
- Todo teste de escrita vai em `ZZ Laboratorio (NAO E CLIENTE)` (`zz-laboratorio`, `is_test=true`). Nunca nas 7 lojas reais.

---

### Task 1: Formato de preço — últimos ~13 lugares com ponto em vez de vírgula

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx` (linhas ~332-443)
- Modify: `components/modules/StoreModule.tsx` (linhas ~2693, 2821)
- Modify: `lib/print.ts` (linhas ~319-454)

**Interfaces:**
- Consome: `formatBRL` já existe em `lib/calc.ts` (`n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})`).

- [ ] **Passo 1: Trocar todo `R$ ${x.toFixed(2)}` por `R$ ${formatBRL(x)}`**

Nos arquivos e linhas listados acima. Não reescrever a fórmula — só trocar `.toFixed(2)` por `formatBRL(...)`, importando de `lib/calc.ts` onde não estiver importado ainda.

- [ ] **Passo 2: `npm run build` limpo, commit**

```
fix(dinheiro): ultimos lugares com R$ 44.90 viram R$ 44,90
```

---

### Task 2: PIN de mesa rotativo

**Files:**
- Modify: `supabase/migrations/` (criar `048_pin_rotativo.sql`)
- Modify: `lib/api.ts` (se precisar de novo retorno de `closeTableSession`)

**Interfaces:**
- Consome: `open_table_session`, `close_table_orders_secure` (ambas já existem).

- [ ] **Passo 1: Regra escolhida (default, sem mais pergunta ao usuário)**

O PIN rotaciona **no fechamento da mesa**, não na abertura — gerar o PIN novo é a última coisa que `close_table_orders_secure` faz, antes de soltar a mesa pra `available`. Isso evita o risco já registrado no backlog ("rotacionar no momento errado derruba a sessão de quem está com a mesa aberta"): como a rotação só acontece quando a sessão já encerrou, nunca existe alguém com a mesa aberta usando o PIN que está sendo trocado.

- [ ] **Passo 2: Migration**

```sql
-- 048_pin_rotativo.sql
create or replace function public.close_table_orders_secure(p_table_id uuid, p_payment_method text default null, p_payment_details jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo_pin text;
begin
  update orders set
    status = 'delivered',
    payment_method = coalesce(p_payment_method, payment_method),
    payment_details = coalesce(p_payment_details, payment_details),
    updated_at = now()
  where table_id = p_table_id and status not in ('delivered', 'canceled');

  v_novo_pin := lpad(floor(random() * 10000)::text, 4, '0');

  update tables set
    status = 'available',
    current_host_name = null,
    pin = v_novo_pin,
    pin_attempts = 0,
    pin_locked_until = null
  where id = p_table_id;
end;
$$;

grant execute on function public.close_table_orders_secure(uuid, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
```

Conferir a assinatura exata de `close_table_orders_secure` em `021_fecha_rls_orders_products.sql` antes de recriar — copiar o corpo real, só acrescentando a geração do PIN novo no fim. Não mudar nenhum outro comportamento da function.

- [ ] **Passo 3: Aplicar em produção, testar em `zz-laboratorio`**

Abrir mesa, ver o PIN, fechar a mesa (com pedido pago), abrir de novo — confirmar que o PIN mudou. Confirmar que abrir a mesa NÃO muda o PIN (só fechar muda).

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(mesa): pin rotaciona ao fechar a mesa, nao mais fixo
```

---

### Task 3: Jurisdição de mesas por garçom

**Files:**
- Modify: `supabase/migrations/` (criar `049_jurisdicao_mesas.sql`)
- Modify: `components/modules/StoreModule.tsx` (`TablesView`, filtro de mesas visíveis)
- Modify: `components/modules/UserManagementView` (ou onde for a tela de gestão de usuários) — seleção de mesas por garçom

**Interfaces:**
- Produz: `store_users.assigned_table_ids uuid[]` (nullable — `null` ou array vazio = "todas as mesas", comportamento de hoje).

- [ ] **Passo 1: Defaults escolhidos (backlog tinha 2 perguntas em aberto, resolvidas aqui)**

1. **Mesa fora da jurisdição fica visível, bloqueada (somente leitura, visual acinzentado)** — não some da tela. Escondê-la seria pior operacionalmente: se outro garçom estiver perto de uma mesa que não é dele e precisar avisar o caixa, ele precisa conseguir ver que ela existe e o estado dela.
2. **Mesa sem nenhum garçom com jurisdição atribuída fica visível pra todos** (mesmo tratamento de hoje) — jurisdição é uma restrição opt-in, nunca um buraco que deixa mesa "órfã" sem ninguém podendo atendê-la.

- [ ] **Passo 2: Migration**

```sql
-- 049_jurisdicao_mesas.sql
alter table store_users add column if not exists assigned_table_ids uuid[];

notify pgrst, 'reload schema';
```

`null` ou `'{}'` = sem restrição (todas as mesas), que é o valor de todo usuário já existente — nenhuma loja muda de comportamento.

- [ ] **Passo 3: UI de atribuição**

Na tela de gestão de usuários (onde hoje se define papel/permissões), para usuários com `role IN ('waiter', 'cashier')`: um seletor multi-mesa com opção "Todas as mesas" (que grava `null`) versus escolher mesas específicas (grava o array de ids). Reaproveitar o componente de seleção que já existe pra permissões, não inventar um novo padrão visual.

- [ ] **Passo 4: Enforcement em `TablesView`**

Mesa cujo id não está em `loggedUser.assigned_table_ids` (quando o array não é vazio/null): renderiza normalmente (número, status, PIN mascarado) mas com opacidade reduzida e sem os botões de ação (lançar pedido, bloquear, receber) — mesmo padrão visual que uma mesa "disabled" já usa em outro lugar do app, se existir; senão, `opacity-50 pointer-events-none` no card inteiro exceto a leitura do status.

- [ ] **Passo 5: Testar em `zz-laboratorio`**

Criar um garçom de teste com jurisdição em 2 das 4 mesas. Confirmar: vê as 4, só consegue agir nas 2 dele; as outras aparecem cinza. Criar um segundo garçom sem jurisdição nenhuma atribuída — confirmar que vê e age em todas (comportamento de hoje). Limpar usuário de teste depois.

- [ ] **Passo 6: `npm run build` limpo, commit**

```
feat(mesas): jurisdicao por garcom, opcional, mesa fora da area fica visivel e bloqueada
```

---

### Task 4: Controle de emissão de nota fiscal por venda

**Files:**
- Modify: `components/modules/StoreModule.tsx` (tela de pagamento/finalização — toggle "Emitir nota fiscal desta venda")
- Modify: `app/api/fiscal/emitir/route.ts` (respeitar o toggle)
- Modify: `lib/api.ts` (`closeTableSession`/`closeCounterOrder` passam o flag adiante)

**Interfaces:**
- Não precisa de coluna nova necessariamente — `orders.payment_details` (jsonb) já existe e pode carregar `{ emitir_nota: boolean }` dentro do objeto que já é montado no pagamento. Conferir antes de assumir migration.

- [ ] **Passo 1: Onde o toggle mora**

Na tela de pagamento (a mesma janela grande do Caixa/Garçom, Task 5 do backlog original, já construída), um toggle "Emitir nota fiscal desta venda" — **default ligado** (comportamento de hoje: toda venda emite, se a loja tem `modelo_emissao_automatica` configurado). Só aparece se a loja tiver emissão automática configurada; loja sem isso configurado não ganha toggle nenhum (nada muda pra ela).

- [ ] **Passo 2: Rotulagem — não é sobre reduzir imposto**

O texto ao lado do toggle, se precisar de ajuda contextual, não deve mencionar "evitar imposto" nem nada equivalente. Rótulo neutro: "Emitir nota fiscal desta venda" com o toggle já explicando a ação. Isso está registrado no backlog (item 13) como cuidado deliberado — o recurso existe por usos legítimos (cortesia, loja sem módulo fiscal contratado, contingência), nunca deve ser descrito como forma de reduzir carga tributária, no produto nem em qualquer texto voltado ao cliente.

- [ ] **Passo 3: Respeitar o flag no pipeline fiscal**

Em `app/api/fiscal/emitir/route.ts`, antes de montar/transmitir qualquer XML: se o pedido tiver `payment_details.emitir_nota === false`, retornar sem tentar emitir (sem erro — é uma escolha válida, não uma falha). Testar em homologação, nunca produção.

- [ ] **Passo 4: Testar em `zz-laboratorio`**

Se a loja de teste não tiver `modelo_emissao_automatica` configurado, configurar homologação temporariamente só pra esse teste, reverter depois. Fechar uma venda com o toggle desligado, confirmar que nenhuma linha nova aparece em `fiscal_notas`. Fechar outra com o toggle ligado, confirmar que emite normal (homologação).

- [ ] **Passo 5: `npm run build` limpo, commit**

```
feat(fiscal): toggle de emitir nota fiscal por venda, default ligado
```

---

### Task 5: Relatório de notas fiscais — filtro de período + export

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`FiscalNotasView`, adicionar filtro de período + botão de exportar)
- Create: `app/api/fiscal/exportar/route.ts` (monta o pacote)

**Interfaces:**
- Consome: `fiscal_notas` (já tem `chave_acesso`, `numero`, `serie`, `xml_path`, `pdf_path`, `valor_total`, `created_at`).

- [ ] **Passo 1: Formato escolhido (backlog tinha 1 pergunta em aberto)**

**ZIP contendo**: uma pasta com todos os XMLs do período (nome do arquivo = chave de acesso) + um CSV na raiz com uma linha por nota (data, número, série, chave de acesso, valor, status). É o formato que o próprio backlog já apontava como mais provável — contador recebe XML em lote, e o CSV serve de índice legível.

- [ ] **Passo 2: Filtro de período na UI**

Em `FiscalNotasView`, ao lado dos filtros já existentes (ambiente, tipo NF-e/NFC-e), um seletor de intervalo de datas (reaproveitar o padrão de date-range já usado no Histórico de Vendas, se existir componente comum) e um botão "Exportar período".

- [ ] **Passo 3: Rota que monta o ZIP**

`app/api/fiscal/exportar/route.ts`, recebe `storeId` + intervalo de datas via query. Busca as notas de `fiscal_notas` no intervalo (via `supabaseAdmin`, mesmo padrão de `/api/fiscal/pdf-url`), baixa cada XML do Storage, monta um ZIP (`jszip` — checar se já é dependência do projeto antes de adicionar; se não for, é a única lib nova permitida nesta tarefa) com os XMLs + o CSV, devolve como download.

- [ ] **Passo 4: Testar em `zz-laboratorio` ou com notas já existentes**

Se `zz-laboratorio` não tiver notas fiscais reais (provavelmente não tem), testar a exportação contra o histórico real do Sertão (**somente leitura** — a rota só lê `fiscal_notas` e Storage, nunca emite nada) pra confirmar que o ZIP sai com as 6 notas existentes de homologação, cada XML abrindo corretamente, CSV com as colunas certas.

- [ ] **Passo 5: `npm run build` limpo, commit**

```
feat(fiscal): exportar notas do periodo em zip (xmls + csv)
```

---

### Task 6: Cor de destaque customizável por loja

**Files:**
- Modify: `supabase/migrations/` (criar `050_cor_loja.sql` — na real, sem coluna nova, ver Passo 1)
- Modify: `components/modules/AdminModule.tsx` e/ou `MenuManagementView` (seletor de cor)
- Modify: `components/modules/ClientModule.tsx` (aplicar a cor)

**Interfaces:**
- Produz: `stores.config.accent_color` (hex string, opcional). Ausente = dourado padrão (`WINE_GOLD`) de hoje, comportamento intocado.

- [ ] **Passo 1: Escopo (era pergunta aberta na auditoria, decidido aqui — v1 deliberadamente pequena)**

**Só uma cor de destaque**, não paleta inteira. Ela substitui `WINE_GOLD` — usada hoje só no preço e no realce de categoria ativa. Não mexe em fundo, texto, nem nos tokens `--ink`/`--surface` do resto do app. É a menor superfície que já responde ao pedido ("deixar mais original") sem risco de alguém deixar o cardápio ilegível trocando fundo/texto.

**Trava de contraste**: calcular luminância do hex escolhido; se ficar abaixo de um mínimo legível contra o fundo escuro do cardápio, recusar salvar e mostrar erro pedindo outra cor — não deixar salvar cor que quebra a leitura.

Nenhuma coluna nova — `stores.config` já é jsonb, `accent_color` cabe ali, mesmo padrão de `service_fee_rate`/`note_suggestions`.

- [ ] **Passo 2: Seletor de cor**

No painel do lojista (não só Master Admin — é customização da própria loja, mesmo espírito de `charge_service_fee`), um campo de cor (`<input type="color">` nativo é suficiente, sem lib nova) com preview ao vivo do preço de um produto de exemplo usando a cor escolhida.

- [ ] **Passo 3: Aplicar em `ClientModule.tsx`**

Onde `WINE_GOLD` é usado hoje (preço, destaque de categoria ativa): `store.config?.accent_color || WINE_GOLD`. Nada mais no arquivo muda.

- [ ] **Passo 4: Testar em `zz-laboratorio`**

Definir uma cor, abrir o cardápio do cliente, confirmar que o preço e a categoria ativa usam a cor nova. Remover a config, confirmar que volta pro dourado padrão. Testar o caso de cor inválida (ex.: branco puro) sendo recusada pela trava de contraste.

- [ ] **Passo 5: `npm run build` limpo, commit**

```
feat(loja): cor de destaque customizavel pelo lojista, com trava de contraste
```

---

## Fora de escopo deste plano (não é código, ou precisa de decisão de terceiro)

- **Relatório de margem 80% do Sertão** — esperando o arquivo de base do usuário desde 21/08.
- **Fotos de produto e identidade visual da loja** — conteúdo, não código.
- **CSC de produção na SEFAZ-BA** — cadastro administrativo, não código.
- **NCM de produto com variação de tamanho** — precisa de decisão de produto com o Ramon antes de mexer.
- **"Melhorar todos os relatórios de histórico de vendas"** — pedido amplo demais pra ter default seguro; precisa de conversa própria sobre o que está faltando.
- **Maquininha de cartão** — já é pesquisa concluída, próximo passo é decisão de negócio (qual adquirente), não código.
