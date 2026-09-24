# Mobile — Fase 2: Fluxo do garçom e pagamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o caminho "abrir mesa → lançar itens → receber → fechar" rápido e sem armadilhas no celular: botões de ação sempre à vista, observação do item visível pra quem precisa, pagamento sem rolagem dupla e com aviso claro, feedback do resultado da nota fiscal, e correção de dois erros achados no fluxo real.

**Architecture:** Só `components/modules/StoreModule.tsx`, `lib/api.ts` (um helper novo de leitura) e uma checagem/correção de dados no banco. Mudanças de layout usam `max-sm:` (celular) para não alterar tablet/desktop. Nenhuma migration, nenhuma mudança de regra de pedido/pagamento/fiscal.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, Supabase (self-hosted no Contabo, aplicar SQL via `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas`).

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-overhaul-design.md` (§3 fase 2). Evidência: `~/ClaudeGerado/ntb-vendas-mobile-audit-2026-09-23/index2.md` (seções "Bugs/behavior problems" e "Flow friction").

## Global Constraints

- Telas `sm` (≥640px) e maiores NÃO podem mudar de aparência: toda regra nova de celular usa `max-sm:` mantendo as classes antigas.
- Tailwind v4 com tokens `var(--token)`; nunca a variante `dark:`; cor de ação = `--brand`.
- Não mudar: valores de pedido/pagamento, cálculo de troco/taxa, emissão fiscal (só o que é exibido ao operador), migrations.
- Cliente (`ClientModule.tsx`) mantém a pré-seleção de opção obrigatória (decisão de 2026-07-05); só o garçom passa a exigir escolha.
- Borda de pizza por tamanho NÃO entra nesta fase (depende de definição com o Ramon).
- Testes de fluxo no Sertão (autorizado pelo dono; homologação): todo dado de teste leva o nome `QA-MOBILE` e é apagado por SQL no fim; nunca tocar nos pedidos de outros testes do dia nem no caixa antigo aberto.
- Sem framework de teste: verificação = `npx tsc --noEmit` + medições/capturas Playwright em 390x844 contra o deploy.
- Deploy só na Task 9. Commits terminam com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Review Focus

1. **Botão fixo dentro de janela rolável** (Tasks 1 e 4): o rodapé sticky não pode cobrir o último campo (observação, CPF) nem ficar atrás do teclado; o conteúdo precisa poder rolar até o fim.
2. **Sem regressão no desktop** (Tasks 1, 4, 8): as mesmas telas em ≥640px continuam idênticas.
3. **Observação com dado antigo** (Task 2): itens já gravados com `[Nome] [Nome] obs` e itens sem observação não podem mostrar linhas vazias ou o nome duplicado como se fosse observação.
4. **Nota fiscal sem resposta** (Task 5): rede lenta/SEFAZ demorando não pode travar o fechamento nem mostrar aviso de "rejeitada" quando a nota só ainda não voltou.
5. **Nome ao abrir a mesa** (Task 6): campo vazio continua abrindo com o nome do operador (comportamento de hoje); mesa aberta offline (fila) continua funcionando.

---

### Task 1: Modal "Adicionar Item" do garçom — botão fixo e escolha explícita

**Files:**
- Modify: `components/modules/StoreModule.tsx` — `StoreProductModal` (buscar `const StoreProductModal`): `useEffect` de pré-seleção (~1522-1538) e o bloco do botão "Lançar Pedido" (~1633-1637).

- [ ] **Step 1: Sem pré-seleção no garçom**

No `useEffect` de `StoreProductModal`, substituir o bloco que monta `initialSelections` (o `forEach` sobre `product.option_groups`) por um estado vazio:

```tsx
    useEffect(() => {
        if (product) {
            setQty(1);
            setNotes('');
            // Garçom escolhe tamanho/sabor explicitamente (2026-09-24): com a 1ª opção
            // pré-marcada, um pedido errado ficava a um toque de distância e o selo
            // "Obrigatório" perdia o sentido. O cardápio do CLIENTE mantém a pré-seleção.
            setSelections({});
        }
    }, [product]);
```

(`missingRequired` e o botão desabilitado já bloqueiam o lançamento até escolher.)

- [ ] **Step 2: Rodapé fixo com o botão Lançar no celular**

Trocar o bloco final (o `<Button ... Lançar Pedido ...>` e a linha de `missingRequired`) por:

```tsx
                <div className="max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5 max-sm:pt-2 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:bg-[var(--surface)] max-sm:border-t max-sm:border-[var(--border)] max-sm:z-10">
                    <Button className="w-full mt-4 max-sm:mt-1 h-12 text-lg" disabled={missingRequired} onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}>
                        Lançar Pedido • R$ {formatBRL(unitPrice * qty)}
                    </Button>
                    {missingRequired && <p className="text-xs text-center text-[var(--err)] mt-1">Escolha uma opção obrigatória para continuar.</p>}
                </div>
```

(`-mb-5` cancela o `pb-5` do corpo do `Modal`; `sticky bottom-0` ancora no corpo rolável do `Modal`, que é o único scroller.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros.
Run: `grep -n "setSelections({})" components/modules/StoreModule.tsx` — Expected: 1 ocorrência em `StoreProductModal`.

- [ ] **Step 4: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: garçom escolhe opção obrigatória e Lançar fica fixo no celular" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Observação do item visível + correção do nome duplicado

**Files:**
- Modify: `components/modules/StoreModule.tsx` — `handleAddItem` (~3388-3400), comanda (~3966), "Já pedido nesta mesa" (~4119-4131), "Pedidos do Dia" (~4558-4568), cartão do Balcão (~5286-5291).

- [ ] **Step 1: Confirmar o defeito no banco (somente leitura)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -At -c \"select left(notes,80) from order_items where added_by_role='garcom' and coalesce(notes,'')<>'' order by created_at desc limit 8;\""
```

Expected (se o defeito existe): linhas no formato `[Nome] [Nome] ...` ou `[Nome] [Nome]`. Se vier `[Nome] obs` (uma vez só), pule o Step 2 e registre no relatório.

- [ ] **Step 2: Parar de prefixar duas vezes**

Em `handleAddItem`, o garçom monta `finalNotes = \`[${loggedUser.name}] ${notes}\`` e ainda passa `loggedUser.name` como `customerName` para `createOrder`, que prefixa de novo (`lib/api.ts` ~1345-1351). O KDS lê `parseItemNote` e mostra `[Nome] obs` como observação. Trocar:

```tsx
        const finalNotes = notes ? `[${loggedUser.name}] ${notes}` : `[${loggedUser.name}]`;
```

por (remover a linha e passar `notes` puro):

```tsx
            const result = await createOrder(selectedTable.id, storeId, [{
                product, quantity: qty, notes, selectedOptions
            }], loggedUser.name, 'garcom', loggedUser.name);
```

(`createOrder` já grava `[Nome] obs` ou `[Nome]` quando não há observação.) Remover qualquer outro uso de `finalNotes` no mesmo handler (o update otimista da lista local): usar no lugar `notes ? \`[${loggedUser.name}] ${notes}\` : \`[${loggedUser.name}]\`` calculado localmente só para o item otimista, para a tela mostrar o mesmo que o banco vai gravar.

- [ ] **Step 3: Comanda mostra a observação também dos itens do garçom**

Na comanda (`showFullBill`, buscar `const clientNote = item.added_by_role !== 'garcom'`), trocar por:

```tsx
                                                    const clientNote = parseItemNote(item.notes || '');
```

(a linha `{clientNote?.observation && <span>• {clientNote.observation}</span>}` já existe e passa a valer para todos os itens).

- [ ] **Step 4: "Já pedido nesta mesa" mostra a observação**

Dentro do `<div className="min-w-0 flex-1">` da linha do item (buscar `<span className="text-xs text-[var(--text-muted)] mr-1">x{item.quantity}</span>`), depois do `<div className="text-xs text-[var(--text-muted)] mt-0.5">…</div>` de preço/status, acrescentar:

```tsx
                                                {parseItemNote(item.notes || '').observation && (
                                                    <div className="text-xs font-semibold text-[var(--warn)] mt-0.5">Obs: {parseItemNote(item.notes || '').observation}</div>
                                                )}
```

- [ ] **Step 5: "Pedidos do Dia" e Balcão**

"Pedidos do Dia" (buscar `filteredHistory.map(row =>`): depois do `<p className="text-xs text-[var(--text-muted)]">Mesa … · mesa fechada</p>` acrescentar:

```tsx
                                        {row.observation && <p className="text-xs font-semibold text-[var(--warn)]">Obs: {row.observation}</p>}
```

Cartão do Balcão (buscar `order.order_items?.map((item, idx) =>`): trocar o `<div key={idx} ...>` por um fragmento com a linha do item + observação:

```tsx
                             {order.order_items?.map((item, idx) => {
                                 const obs = parseItemNote(item.notes || '').observation;
                                 return (
                                     <div key={idx}>
                                         <div className="flex justify-between text-sm text-[var(--text-muted)]">
                                             <span className="truncate flex-1">{item.quantity}x {getOrderItemDisplayName(item)}</span>
                                             <span className="font-mono text-xs">{(item.price_at_time * item.quantity).toFixed(2)}</span>
                                         </div>
                                         {obs && <div className="text-xs font-semibold text-[var(--warn)]">Obs: {obs}</div>}
                                     </div>
                                 );
                             })}
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros. `grep -n "finalNotes" components/modules/StoreModule.tsx` — Expected: nenhum uso restante passando `finalNotes` a `createOrder`.

- [ ] **Step 7: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: observação do item visível (comanda, já pedido, dia, balcão) e fim do nome duplicado" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Ordem dos sabores da pizza (dado do Sertão)

**Files:** nenhum arquivo; correção de dados no banco (catálogo, mesmo critério já usado no cardápio do Sertão).

- [ ] **Step 1: Ver a ordem atual dos grupos**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -At -c \"select p.name, g.name, g.\\\"order\\\" from product_option_groups g join products p on p.id=g.product_id where p.store_id=(select id from stores where slug='sertao-vai-virar-mar') and (g.name ilike 'tamanho%' or g.name ilike 'sabor%') order by p.name, g.\\\"order\\\", g.name;\""
```

Expected: para cada pizza, `Sabor 1` com `order` menor que `Sabor 2`. Se algum `Sabor 2` tiver `order` ≤ `Sabor 1`, é a causa de "Calabresa, Mussarela" (o resumo lista as opções na ordem dos grupos).

- [ ] **Step 2: Corrigir só onde estiver errado**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -At -c \"update product_option_groups g2 set \\\"order\\\" = g1.\\\"order\\\" + 1 from product_option_groups g1 where g1.product_id = g2.product_id and g1.name ilike 'Sabor 1%' and g2.name ilike 'Sabor 2%' and g2.\\\"order\\\" <= g1.\\\"order\\\" and g1.product_id in (select id from products where store_id=(select id from stores where slug='sertao-vai-virar-mar'));\""
```

Expected: `UPDATE n` (n = pizzas corrigidas; `UPDATE 0` se já estava certo — então a causa é outra: registrar no relatório e seguir).

- [ ] **Step 3: Repetir o Step 1**

Expected: `Sabor 1` sempre com `order` menor que `Sabor 2`.

- [ ] **Step 4: Registrar**

Sem commit de código. Anotar no relatório da task o antes/depois. (Rotular o resumo como "Sabor 1: X · Sabor 2: Y" exige gravar o nome do grupo no pedido — migration em `create_order_secure`; fica para uma fase futura.)

---

### Task 4: Pagamento no celular — sem rolagem dupla, rodapé fixo, aviso claro

**Files:**
- Modify: `components/modules/StoreModule.tsx` — janela da mesa (`title="Receber Pagamento"`, wrapper `max-h-[60vh] overflow-y-auto pr-1`, ~4219) e `PaymentCaptureFields` (bloco "Summary & Action", ~2128-2166).

- [ ] **Step 1: Uma rolagem só no celular (janela da mesa)**

No wrapper das abas do pagamento da mesa, trocar:

```tsx
                    <div className="max-h-[60vh] overflow-y-auto pr-1">
```

por:

```tsx
                    <div className="sm:max-h-[60vh] sm:overflow-y-auto sm:pr-1">
```

(No celular quem rola é o corpo do `Modal`, e o rodapé sticky do Step 2 ancora nele. A janela do Balcão já não tem esse wrapper.)

- [ ] **Step 2: Rodapé fixo com Restante e FINALIZAR**

Em `PaymentCaptureFields`, no bloco `{/* Summary & Action */}`, trocar a abertura:

```tsx
        <div className="border-t border-[var(--border)] pt-4">
```

por:

```tsx
        <div className="border-t border-[var(--border)] pt-4 max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:bg-[var(--surface)] max-sm:z-10">
```

- [ ] **Step 3: Aviso quando o FINALIZAR está desabilitado**

Logo depois da linha "Restante a Pagar" (o `<div className="flex justify-between text-sm">` com `Restante a Pagar:`), antes do bloco de `Troco`, acrescentar:

```tsx
                {finishDisabled && (
                    <p className="text-xs text-[var(--text-muted)]">
                        Digite o valor recebido e toque em <span className="font-bold">+</span> para liberar o fechamento.
                    </p>
                )}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros. `grep -n "sm:max-h-\[60vh\]" components/modules/StoreModule.tsx` — Expected: 1 ocorrência (janela da mesa).

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: pagamento com uma rolagem, rodapé fixo e aviso no FINALIZAR desabilitado" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Resultado da nota fiscal avisado ao operador

**Files:**
- Modify: `lib/api.ts` — junto de `aguardarNotaFiscalDaVenda` (~2101): novo helper `descreverFalhaFiscalDaVenda` e estado `pendente` como terminal.
- Modify: `components/modules/StoreModule.tsx` — `abrirCupomFiscalQuandoSair` (~447-565): trocar os avisos genéricos e acrescentar o de sucesso.

- [ ] **Step 1: `pendente` também encerra a espera**

Em `aguardarNotaFiscalDaVenda`, trocar:

```ts
      if (daVenda?.status === 'erro' || daVenda?.status === 'rejeitada') return null;
```

por:

```ts
      if (daVenda?.status === 'erro' || daVenda?.status === 'rejeitada' || daVenda?.status === 'pendente') return null;
```

(`pendente` = falta CPF/CNPJ do destinatário; a nota nunca vai aparecer sozinha, então não adianta esperar 12s.)

- [ ] **Step 2: Helper que explica por que a nota não saiu**

Logo depois de `aguardarNotaFiscalDaVenda` em `lib/api.ts`, adicionar:

```ts
// Só lê: devolve o estado da nota MAIS RECENTE desta venda (criada de agora em
// diante) pra o operador saber por que o cupom não abriu. null = ainda não
// existe (SEFAZ demorando).
export const descreverFalhaFiscalDaVenda = async (
  storeId: string,
  alvo: { orderId?: string; tableId?: string },
): Promise<{ status: string; motivo: string | null } | null> => {
  const inicio = Date.now() - 60000;
  const notas = await fetchFiscalNotas(storeId);
  const nota = notas
    .filter((n: any) => !n.pessoa_identificador)
    .filter((n: any) => (alvo.orderId ? n.order_id === alvo.orderId : n.table_id === alvo.tableId))
    .filter((n: any) => new Date(n.created_at).getTime() >= inicio)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] as any;
  return nota ? { status: nota.status, motivo: nota.motivo_erro ?? null } : null;
};
```

- [ ] **Step 3: Aviso claro em vez do genérico**

Em `StoreModule.tsx`, acima de `abrirCupomFiscalQuandoSair`, adicionar (e importar `descreverFalhaFiscalDaVenda` de `@/lib/api`):

```tsx
const avisarFalhaNotaFiscal = async (storeId: string, alvo: { orderId?: string; tableId?: string }) => {
    const r = await descreverFalhaFiscalDaVenda(storeId, alvo).catch(() => null);
    if (r?.status === 'pendente') {
        toast.warning('Nota fiscal pendente: falta o CPF/CNPJ do cliente. Informe em Administração → Notas Fiscais e clique em Reemitir.');
    } else if (r?.status === 'rejeitada' || r?.status === 'erro') {
        toast.error(`Nota fiscal rejeitada: ${(r.motivo || 'sem detalhe').slice(0, 140)}`);
    } else {
        toast.error('A nota fiscal ainda não voltou autorizada — imprima por Administração → Notas Fiscais quando ela sair.');
    }
};
```

Dentro de `abrirCupomFiscalQuandoSair`, nas duas ocorrências do aviso genérico `toast.error('A nota fiscal ainda não voltou autorizada — imprima por Administração → Notas Fiscais quando ela sair.');` (ramo Electron `if (!resultado)` e ramo navegador `else`), substituir a chamada `toast.error(...)` por `avisarFalhaNotaFiscal(storeId, alvo);`. No ramo Electron manter o `return` que já existe logo depois.

- [ ] **Step 4: Aviso de sucesso**

No começo dos dois `.then((resultado) => {…})` (Electron e navegador), quando `resultado` existir e a nota estiver `autorizada`, acrescentar:

```tsx
if (resultado?.nota.status === 'autorizada') toast.success(`Nota fiscal autorizada${resultado.nota.numero ? ` (nº ${resultado.nota.numero})` : ''}.`);
```

(No ramo Electron, colocar depois do `if (!resultado) {…return;}`.)

- [ ] **Step 5: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros. `grep -c "avisarFalhaNotaFiscal" components/modules/StoreModule.tsx` — Expected: 3 (definição + 2 usos).

```bash
git add lib/api.ts components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: aviso claro do resultado da nota fiscal ao fechar a venda" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Nome do cliente ao abrir a mesa

**Files:**
- Modify: `components/modules/StoreModule.tsx` — `TablesView`: estado novo e o botão "Abrir Mesa Manualmente" (~3888-3932).

- [ ] **Step 1: Estado do nome**

No `TablesView`, junto dos outros `useState` (buscar `const [selectedTable, setSelectedTable]`), adicionar:

```tsx
    const [hostNameInput, setHostNameInput] = useState('');
    useEffect(() => { setHostNameInput(''); }, [selectedTable?.id]);
```

- [ ] **Step 2: Campo de nome acima do botão**

Dentro de `{selectedTable?.status === 'available' && ( … )}`, antes do `<Button className="w-full text-lg h-14" …>`, envolver em fragmento e acrescentar:

```tsx
                                <Input
                                    label="Nome do cliente (opcional)"
                                    placeholder="Ex.: Família Silva"
                                    value={hostNameInput}
                                    onChange={e => setHostNameInput(e.target.value)}
                                />
```

- [ ] **Step 3: Usar o nome informado**

No `onClick` do botão, definir no início `const hostName = hostNameInput.trim() || loggedUser.name;` e trocar as duas ocorrências de `loggedUser.name` do handler (o `current_host_name` do `optimisticTable` e o 3º argumento de `openTableManually(selectedTable.id, store.id, …)`) por `hostName`. Nada mais muda (campo vazio = comportamento de hoje).

- [ ] **Step 4: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros.

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: nome do cliente opcional ao abrir a mesa" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Confirmação de cancelar item nomeia o item

**Files:**
- Modify: `components/modules/StoreModule.tsx` — `handleDeleteItem` (~3477).

- [ ] **Step 1: Mensagem com o item**

Trocar a linha `if(await confirm("Deseja cancelar este item da comanda?")) {` por:

```tsx
        const itemAlvo = selectedTable ? getTableSummary(selectedTable.id).allItems.find((i: any) => i.id === itemId) : undefined;
        const nomeItem = itemAlvo ? `${itemAlvo.quantity}x ${getOrderItemDisplayName(itemAlvo)}` : 'este item';
        if(await confirm(`Cancelar ${nomeItem} da comanda?`)) {
```

Se `getTableSummary(...).allItems` não existir com esse nome, usar o campo de lista de itens que `getTableSummary` devolve (conferir com `grep -n "const getTableSummary" -A25 components/modules/StoreModule.tsx`) e registrar no relatório o nome usado.

- [ ] **Step 2: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros.

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: confirmar cancelamento nomeia o item" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: "Zerar Vendas" afastado das exportações no celular

**Files:**
- Modify: `components/modules/StoreModule.tsx` — barra de ações do Histórico de Vendas (~10148-10173).

- [ ] **Step 1: Linha própria no fim, só no celular**

Na barra `<div className="flex items-center gap-2">` que contém Filtros/Imprimir/Exportar/Zerar, trocar por `flex items-center gap-2 max-sm:flex-wrap`. No divisor `<div className="w-px h-6 bg-[var(--border)] mx-1" />` acrescentar `max-sm:hidden`. No botão "Zerar Vendas" acrescentar `max-sm:order-last max-sm:w-full max-sm:mt-6` às classes (o botão desce para uma linha própria, largura total, com folga de 24px do resto). No `Badge` de contagem acrescentar `max-sm:order-first`.

- [ ] **Step 2: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros.

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile fase 2: Zerar Vendas em linha própria no celular, longe de Exportar" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Deploy e verificação do fluxo real no Sertão

**Files:** nenhum (scripts e capturas no scratchpad da sessão).

- [ ] **Step 1: Build, push, deploy**

```bash
npm run build
git push
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh > /tmp/deploy.log 2>&1; tail -1 /tmp/deploy.log"
```

Expected: build limpo; `✓ Ready in …ms`.

- [ ] **Step 2: Fluxo completo no Sertão (390x844, conta universal, tudo `QA-MOBILE`)**

Com Playwright: abrir a Mesa 1 informando o nome `QA-MOBILE` → "Adicionar Pedido" → abrir "Pizza Tradicional". Verificar e capturar:
1. Nenhuma opção vem marcada; `Lançar Pedido` está desabilitado; o botão fica visível sem rolar (`getBoundingClientRect().bottom <= innerHeight`) e o texto pede escolher opção.
2. Escolher Média + sabor; com Pequena o Sabor 2 some (regra da fase anterior continua).
3. Digitar observação `QA-MOBILE obs`, lançar; abrir "Já pedido nesta mesa" e "Ver Comanda": a linha `Obs: QA-MOBILE obs` aparece e NÃO aparece `[Nome] [Nome]` (conferir também no banco: `notes` do item = `[Nome] QA-MOBILE obs` com o nome uma vez só).
4. Título/cartão da mesa mostra `QA-MOBILE` como nome.
5. Tocar na lixeira do item: a confirmação cita `1x Pizza Tradicional (...)`.
6. Receber & Finalizar: sem rolagem dupla (`.max-h` interno inexistente no celular); `FINALIZAR` desabilitado com a frase de aviso visível; após lançar o valor com `+`, `FINALIZAR` habilita; o rodapé (Restante + botão) está colado embaixo (`bottom === innerHeight`).
7. Fechar com CPF `111.444.777-35` e "Emitir nota" ligado: aparece o aviso `Nota fiscal autorizada (nº …)` (SEFAZ homologação). Fechar uma segunda venda sem CPF: nota autorizada também.
8. Histórico de Vendas em 390px: "Zerar Vendas" em linha própria, abaixo de Exportar CSV, com folga.
9. Desktop 1280x800: modal "Adicionar Item" e pagamento idênticos aos de antes (sem rodapé sticky, com `max-h-[60vh]` no pagamento da mesa).

- [ ] **Step 3: Limpeza dos dados de teste no Sertão**

Identificar só os pedidos criados por este teste (itens com `notes like '%QA-MOBILE%'` nas últimas 2 horas), apagar em transação: `fiscal_notas` (por `order_id`), `order_change_pings`, `order_ratings`, `order_items`, `orders`, e os `print_jobs` das últimas 2 horas do Sertão. Confirmar: nenhuma mesa do Sertão fora de `available` e zero pedidos QA-MOBILE. Não tocar em pedidos anteriores ao teste nem no caixa aberto antigo.

- [ ] **Step 4: App desktop e registro**

Bump de patch em `desktop/package.json`, `cd desktop && npm run dist && bash scripts/publish.sh`, commit e push. Atualizar `project_ntb_vendas_mobile_figma.md`: fase 2 concluída; próximo = plano da fase 3 (Master Admin e Administração).

---

## Fora de escopo desta fase (registrado para decidir depois)
- **Balcão criar pedido pelo painel** (hoje só recebe pedidos do cliente): é funcionalidade nova, não correção de celular — precisa de decisão do dono.
- **Rótulo "Sabor 1: X · Sabor 2: Y"** e **borda por tamanho**: exigem gravar o nome do grupo no pedido (migration) e definição com o Ramon.
- **Lançar em lote ("enviar tudo")** no garçom: muda o fluxo de cozinha/impressão; discutir com o dono.
- **KDS do Sertão** (módulo desligado): decisão do dono, fase 5.

## Self-Review

**Cobertura da spec (§3, fase 2):** botão Lançar/Finalizar fixos → Tasks 1, 4; observação visível → Task 2; opções obrigatórias sem pré-seleção no garçom → Task 1; aviso do FINALIZAR desabilitado → Task 4; feedback da nota → Task 5; nome ao abrir mesa → Task 6; confirmação nomeando o item → Task 7; "Zerar Vendas" afastado → Task 8; borda por tamanho → fora de escopo por decisão da spec (§5).

**Placeholders:** nenhum; trechos com `~linha` trazem a âncora por conteúdo (`buscar …`) porque o arquivo tem ~11k linhas e as linhas se deslocam a cada commit.

**Consistência:** `descreverFalhaFiscalDaVenda` (Task 5) é definido em `lib/api.ts` e usado só em `avisarFalhaNotaFiscal`; `hostNameInput` (Task 6) só no `TablesView`; a classe de rodapé sticky usa o mesmo padrão nas Tasks 1 e 4 (`max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:-mb-5 …`).
