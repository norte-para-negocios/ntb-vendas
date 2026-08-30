# Varredura de Design/UX do Sistema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os achados reais de uma varredura de design/UX rodada contra as telas que não foram tocadas na reforma de Administração (Balcão, Cozinha/Bar, Caixa, Cardápio, Dashboard, modal de pagamento de Mesa) — priorizando primeiro risco financeiro/segurança real, depois o bug recorrente de layout (`items-start` faltando), depois consistência visual.

**Architecture:** Todo trabalho é dentro de `components/modules/StoreModule.tsx` (exceto Task 10, que é `components/modules/StoreDashboardView.tsx`, arquivo próprio). Cada task é aditiva e testável isoladamente. As tasks 1-5 mexem em lógica real (não só CSS) — exigem mais cuidado e teste manual antes de deploy. As tasks 6-10 são CSS/JSX puro.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, `motion/react`, `lib/api.ts` (RPCs já existentes no banco, migration 063 — nenhuma migration nova é necessária neste plano, com exceção da Task 1 que precisa de uma chave nova em `stores.config`, sem migration de schema).

**Spec:** Não existe spec formal separada — este plano vem direto de uma auditoria de 6 agentes rodada em paralelo nesta sessão (2026-08-29/30), cada um lendo uma tela inteira e comparando contra o padrão de qualidade estabelecido na correção de `TablesView` (altura automática, `items-start`, header compacto) e na reforma de Administração (fonte monoespaçada em número financeiro, cores semânticas). Achados de organização estrutural mais profunda (modal de produto virar seções colapsáveis, resumo de pagamento fixo no rodapé do modal de mesa, hierarquia visual entre as 4 abas de pagamento, remover o teto `max-w-7xl` do container principal) foram DELIBERADAMENTE deixados fora deste plano — são mudanças de maior risco/julgamento de design que merecem sua própria rodada dedicada, não days incluídas aqui só porque foram encontradas. Ficam registrados no backlog no fim deste arquivo.

## Global Constraints

- Nenhuma migration de schema neste plano — a única tabela/coluna nova necessária (`cash_shift_audit_events`, `cash_shifts.approved_by_user_id`, os parâmetros novos das RPCs) **já existe** desde a migration 063 (aplicada em 2026-08-28). Task 1 só adiciona uma chave nova em `stores.config` (jsonb, sem migration).
- `npm run build` (typecheck + build) tem que passar limpo depois de CADA task antes de comitar.
- Deploy manual ao final de cada task: `git push origin main` + `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"` — testar ao vivo antes de avançar pra próxima (mesmo padrão já usado nesta sessão).
- Tasks 1-5 envolvem dinheiro real ou ação irreversível — testar manualmente numa loja de TESTE (nunca a Sertão nem outra loja real de cliente) antes de considerar a task pronta.
- Cores/fontes fora dos tokens já existentes (`--brand`, `--ink`, `--surface`, `--text`, `--border`, `--ok/--warn/--err/--info`) são proibidas.
- `confirm` (de `@/components/ConfirmDialog`) já está importado em `StoreModule.tsx` — usar esse componente pra qualquer confirmação nova deste plano, nunca `window.confirm` nativo.

---

### Task 1: Caixa — tolerância de 2 níveis + aprovação de supervisor no fechamento

**Files:**
- Modify: `components/modules/StoreSettingsView.tsx` (novo campo de configuração)
- Modify: `types/index.ts` (`Store['config']`)
- Modify: `components/modules/StoreModule.tsx` (dentro de `CaixaView`, `handleConfirmCloseShift` e um modal novo de aprovação)

**Interfaces:**
- Consome: `closeCashShift(shiftId, closingCountedCash, closingCashBreakdown?, maxTolerance?, approvedByUserId?)` e `verifyCashSupervisor(storeId, email, password)` — ambas JÁ EXISTEM em `lib/api.ts` (linhas 1252 e 1270), prontas, nunca precisaram de mudança de assinatura.
- `closeCashShift` retorna `{ success, requires_approval?, expected_cash?, closing_counted_cash?, difference?, message? }`.
- `verifyCashSupervisor` retorna `{ success, user_id?, name?, message? }`.
- "Supervisor" = `store_user` com `role in ('owner','universal')` OU `permissions.supervisiona_caixa === true` (checagem já existe na RPC, migration 063 — não reimplementar essa regra no client).

**Contexto:** A RPC `close_cash_shift_secure` já recusa fechar o turno com diferença acima de `p_max_tolerance` sem `p_approved_by_user_id` de um supervisor válido — mas `handleConfirmCloseShift` hoje nunca manda esses dois parâmetros, então a trava nunca dispara. Não existe hoje nenhum lugar pra configurar o valor da tolerância — esta task adiciona isso.

- [ ] **Passo 1: Adicionar `cash_shift_max_tolerance` em `stores.config`**

Em `types/index.ts`, no `interface Store['config']` (mesmo bloco de `table_alert_occupied_minutes`), adicione:

```ts
    // Tolerância de fechamento de caixa (2026-08-30) — diferença acima
    // deste valor exige aprovação de supervisor pra fechar o turno.
    // 0/undefined = sem tolerância nenhuma configurada (comportamento
    // atual: qualquer diferença fecha sem trava, mesmo com o achado da
    // auditoria — a trava só liga quando a loja configurar um valor > 0).
    cash_shift_max_tolerance?: number;
```

- [ ] **Passo 2: Campo de configuração em `StoreSettingsView.tsx`**

Siga EXATAMENTE o mesmo padrão já usado nesse arquivo pros "Avisos de tempo na Gestão de Mesas" (state + handler + input number, `updateStoreConfig`) — leia esse bloco primeiro (`grep -n "tableAlertOccupiedMin" components/modules/StoreSettingsView.tsx`) pra copiar a estrutura exata. Adicione:

```tsx
const [cashShiftMaxTolerance, setCashShiftMaxTolerance] = useState<number>(store.config?.cash_shift_max_tolerance ?? 0);
```

Sincronize no mesmo `useEffect` de resync (`setCashShiftMaxTolerance(store.config?.cash_shift_max_tolerance ?? 0);`), e um handler:

```tsx
const handleChangeCashShiftTolerance = async (newValue: number) => {
    const previous = cashShiftMaxTolerance;
    setCashShiftMaxTolerance(newValue);
    try {
        const newConfig = { ...currentStoreConfig, cash_shift_max_tolerance: newValue };
        await updateStoreConfig(store.id, newConfig);
        setCurrentStoreConfig(newConfig);
        if (onStoreUpdate) onStoreUpdate({ ...store, config: newConfig });
    } catch (e) {
        console.error('Error updating cash shift tolerance', e);
        setCashShiftMaxTolerance(previous);
        toast.error('Erro ao atualizar a tolerância de fechamento de caixa.');
    }
};
```

E o campo na UI, no mesmo estilo dos "Avisos de tempo":

```tsx
<div className="mt-4 flex items-center justify-between p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
    <div>
        <h4 className="font-bold text-[var(--text)]">🔒 Tolerância no fechamento de caixa</h4>
        <p className="text-sm text-[var(--text-muted)]">Diferença acima deste valor exige aprovação de um supervisor (dono ou quem tiver a permissão "Supervisiona Caixa") pra fechar o turno. Deixe 0 pra desligar.</p>
    </div>
    <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] flex-shrink-0">
        R$
        <input
            type="number" min={0} step={5}
            value={cashShiftMaxTolerance}
            onChange={e => handleChangeCashShiftTolerance(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Tolerância máxima de diferença de caixa em reais"
            className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-bold text-center"
        />
    </label>
</div>
```

- [ ] **Passo 3: Modal de aprovação de supervisor em `CaixaView`**

Dentro de `CaixaView` (`components/modules/StoreModule.tsx`), adicione estado novo perto de `closeSummary`/`isClosingShift`:

```tsx
const [pendingApproval, setPendingApproval] = useState<{ expected: number; counted: number; difference: number } | null>(null);
const [supervisorEmail, setSupervisorEmail] = useState('');
const [supervisorPassword, setSupervisorPassword] = useState('');
const [isVerifyingSupervisor, setIsVerifyingSupervisor] = useState(false);
```

Altere `handleConfirmCloseShift` pra passar a tolerância configurada e tratar `requires_approval`:

```tsx
const handleConfirmCloseShift = async (approvedByUserId?: string) => {
    if (!shift) return;
    setIsClosingShift(true);
    try {
        const breakdownAsNumbers: Record<string, number> = {};
        CASH_DENOMINATIONS.forEach((value) => {
            const count = parseInt(closingCashBreakdown[String(value)] || '0', 10);
            if (count > 0) breakdownAsNumbers[String(value)] = count;
        });
        const maxTolerance = store.config?.cash_shift_max_tolerance || undefined;
        const result = await closeCashShift(shift.id, closingCountedValue, breakdownAsNumbers, maxTolerance, approvedByUserId);
        if (result.success) {
            toast.success('Caixa fechado.');
            if (!canSeeExpectedBeforeClosing && result.expected_cash !== undefined && result.difference !== undefined) {
                setClosedResultDifference({ expected: result.expected_cash, counted: closingCountedValue, difference: result.difference });
            }
            setPendingApproval(null);
            setShowCloseModal(false);
            setCloseSummary(null);
            setShift(null);
        } else if (result.requires_approval) {
            // Achado da varredura (2026-08-30): a RPC já recusava fechar com
            // diferença acima da tolerância, mas nada aqui nunca tratava
            // esse retorno -- ficava só o erro genérico. Abre o modal de
            // aprovação em vez de exibir o texto de erro cru.
            setPendingApproval({
                expected: result.expected_cash ?? 0,
                counted: closingCountedValue,
                difference: result.difference ?? 0,
            });
        } else {
            toast.error(result.message || 'Não foi possível fechar o caixa.');
            await loadShift();
        }
    } catch (e: any) {
        toast.error('Erro ao fechar o caixa: ' + e.message);
    } finally {
        setIsClosingShift(false);
    }
};

const handleApproveAndClose = async () => {
    if (!supervisorEmail.trim() || !supervisorPassword) {
        toast.error('Informe o e-mail e a senha do supervisor.');
        return;
    }
    setIsVerifyingSupervisor(true);
    try {
        const verify = await verifyCashSupervisor(store.id, supervisorEmail.trim(), supervisorPassword);
        if (!verify.success || !verify.user_id) {
            toast.error(verify.message || 'Supervisor não encontrado ou sem permissão.');
            return;
        }
        setSupervisorEmail('');
        setSupervisorPassword('');
        await handleConfirmCloseShift(verify.user_id);
    } finally {
        setIsVerifyingSupervisor(false);
    }
};
```

Importe `verifyCashSupervisor` de `@/lib/api` no topo do arquivo (já tem uma lista de imports de `lib/api` gigante — adicione o nome nessa lista existente, não crie um `import` novo).

O `onClick` do botão que hoje chama `handleConfirmCloseShift()` direto (procure `grep -n "handleConfirmCloseShift()" components/modules/StoreModule.tsx`) continua igual — a função agora aceita um parâmetro opcional, chamar sem argumento continua funcionando exatamente como antes (fluxo normal, sem supervisor, pra 99% dos fechamentos que não estouram a tolerância).

- [ ] **Passo 4: Modal de aprovação (JSX)**

Adicione um `<Modal isOpen={!!pendingApproval} onClose={() => setPendingApproval(null)} title="Diferença acima do limite — aprovação necessária">` (mesmo componente `Modal` de `components/ui.tsx`, já importado) em algum ponto de `CaixaView` perto dos outros modais dessa view. Conteúdo:

```tsx
<Modal isOpen={!!pendingApproval} onClose={() => setPendingApproval(null)} title="Diferença acima do limite — aprovação necessária">
    {pendingApproval && (
        <div className="space-y-4">
            <div className="bg-[var(--warn)]/10 p-4 rounded-xl border border-[var(--warn)]/20">
                <p className="text-sm text-[var(--warn)] font-semibold">
                    Diferença de R$ {formatBRL(Math.abs(pendingApproval.difference))} ({pendingApproval.difference >= 0 ? 'sobra' : 'falta'}) — acima da tolerância configurada pra esta loja.
                </p>
            </div>
            <p className="text-sm text-[var(--text-muted)]">Peça pra um supervisor (dono, ou quem tiver a permissão "Supervisiona Caixa") digitar o login dele pra aprovar o fechamento mesmo assim.</p>
            <Input label="E-mail do supervisor" type="email" value={supervisorEmail} onChange={e => setSupervisorEmail(e.target.value)} />
            <Input label="Senha do supervisor" type="password" value={supervisorPassword} onChange={e => setSupervisorPassword(e.target.value)} />
            <div className="flex gap-2">
                <Button className="flex-1" onClick={handleApproveAndClose} isLoading={isVerifyingSupervisor}>Aprovar e Fechar</Button>
                <Button variant="ghost" onClick={() => setPendingApproval(null)}>Cancelar</Button>
            </div>
        </div>
    )}
</Modal>
```

- [ ] **Passo 5: Typecheck, build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Passo 6: Teste manual numa loja de TESTE**

Configure uma tolerância pequena (ex.: R$ 5) em Administração > Configurações. Abra um turno, feche contando um valor com diferença MAIOR que a tolerância — confirme que aparece o modal de aprovação em vez de fechar direto. Tente aprovar com um login que NÃO é supervisor — confirme que recusa. Aprove com o dono — confirme que fecha. Feche outro turno com diferença DENTRO da tolerância — confirme que fecha direto, sem pedir aprovação (fluxo normal preservado).

- [ ] **Passo 7: Commit e deploy**

```bash
git add types/index.ts components/modules/StoreSettingsView.tsx components/modules/StoreModule.tsx
git commit -m "feat: tolerancia de fechamento de caixa com aprovacao de supervisor"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 2: Caixa — alerta de auditoria em sangria grande

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `CaixaView`, `handleSubmitMovement`)
- Modify: `components/modules/StoreSettingsView.tsx` (campo de configuração do limiar)
- Modify: `types/index.ts`

**Interfaces:**
- Consome: `registerCashMovement(shiftId, type, amount, reason, operatorName?, alertThreshold?)` — já existe, `lib/api.ts:1180`.

**Contexto:** A RPC só grava evento de auditoria (`cash_shift_audit_events`, tipo `sangria_grande`) quando `p_operator_name` E `p_alert_threshold` vêm preenchidos E o valor da sangria é `>= p_alert_threshold`. Hoje `handleSubmitMovement` nunca manda esses dois parâmetros.

- [ ] **Passo 1: Campo `cash_shift_sangria_alert_threshold` em `stores.config`**

Mesmo padrão da Task 1, Passo 1, em `types/index.ts`:

```ts
    // Limiar de alerta de sangria grande (2026-08-30) — sangria com valor
    // igual ou maior que isso gera evento em cash_shift_audit_events.
    // 0/undefined = alerta desligado.
    cash_shift_sangria_alert_threshold?: number;
```

- [ ] **Passo 2: Campo de configuração em `StoreSettingsView.tsx`**

Mesmo padrão da Task 1, Passo 2 (state + handler + input), rotulado "Alertar sangria acima de", mesmo componente visual.

- [ ] **Passo 3: Passar os parâmetros em `handleSubmitMovement`**

Ache `grep -n "registerCashMovement(shift.id" components/modules/StoreModule.tsx`. Troque a chamada pra incluir os dois novos argumentos:

```tsx
const result = await registerCashMovement(
    shift.id,
    movementType,
    value,
    movementReason.trim(),
    loggedUser.name,
    movementType === 'sangria' ? (store.config?.cash_shift_sangria_alert_threshold || undefined) : undefined,
);
```

`loggedUser` já está disponível no escopo de `CaixaView` (é usado em outros lugares da mesma view — confirme com `grep -n "loggedUser" components/modules/StoreModule.tsx` dentro do range de `CaixaView`).

- [ ] **Passo 4: Typecheck, build, teste manual, commit, deploy**

```bash
npx tsc --noEmit && npm run build
```

Teste numa loja de TESTE: configure um limiar pequeno (ex.: R$ 50), registre uma sangria maior que isso, confirme (via `node scripts/db.mjs "select * from cash_shift_audit_events order by created_at desc limit 5"`) que o evento foi gravado. Registre uma sangria MENOR que o limiar, confirme que NÃO gera evento.

```bash
git add types/index.ts components/modules/StoreSettingsView.tsx components/modules/StoreModule.tsx
git commit -m "feat: alerta de auditoria em sangria grande"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 3: Caixa — tela de visualização da trilha de auditoria

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `CaixaView`)

**Interfaces:**
- Consome: `fetchCashShiftAudit(storeId, shiftId?, operatorUserId?, limit?)` — já existe, `lib/api.ts:1295`, devolve `CashShiftAuditEvent[]` (`{ id, store_id, shift_id, operator_user_id, operator_name, event_type: 'item_cancelado'|'sangria_grande', details, created_at }` — confirme os campos exatos lendo a interface em `lib/api.ts:1284`).

**Contexto:** Task 1 e 2 fazem o sistema GRAVAR eventos de auditoria; sem esta task, ninguém consegue VER esses eventos — ficam só no banco.

- [ ] **Passo 1: Estado e carregamento**

Dentro de `CaixaView`, adicione:

```tsx
const [auditEvents, setAuditEvents] = useState<CashShiftAuditEvent[]>([]);
const [showAuditModal, setShowAuditModal] = useState(false);
const [isLoadingAudit, setIsLoadingAudit] = useState(false);

const loadAuditEvents = async () => {
    setIsLoadingAudit(true);
    try {
        const events = await fetchCashShiftAudit(store.id, null, null, 50);
        setAuditEvents(events);
    } finally {
        setIsLoadingAudit(false);
    }
};
```

Importe `fetchCashShiftAudit` e o tipo `CashShiftAuditEvent` de `@/lib/api`/`lib/api.ts` (adicione na lista de imports já existente de `lib/api`, e confirme se `CashShiftAuditEvent` é exportado de lá ou de `types/index.ts` — `grep -n "CashShiftAuditEvent"` pra confirmar).

- [ ] **Passo 2: Botão de acesso + Modal**

Ache um lugar natural na tela de Caixa pra um botão "Ver Auditoria" (perto de onde já existe algo tipo histórico/turnos anteriores — `grep -n "Histórico de Turnos\|Ver Turnos" components/modules/StoreModule.tsx` dentro do range de `CaixaView` pra achar um botão irmão e copiar o estilo). `onClick={() => { setShowAuditModal(true); loadAuditEvents(); }}`.

Modal simples, lista cronológica:

```tsx
<Modal isOpen={showAuditModal} onClose={() => setShowAuditModal(false)} title="Trilha de Auditoria" size="lg">
    {isLoadingAudit ? (
        <div className="text-center py-10 text-[var(--text-muted)] text-sm">Carregando...</div>
    ) : auditEvents.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-6">Nenhum evento registrado ainda.</p>
    ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {auditEvents.map(ev => (
                <div key={ev.id} className="flex items-center justify-between gap-3 bg-[var(--surface-2)] rounded-lg px-3 py-2">
                    <div className="min-w-0">
                        <p className="text-sm text-[var(--text)]">
                            <span className="font-bold">{ev.operator_name}</span>
                            {' — '}
                            {ev.event_type === 'sangria_grande'
                                ? `Sangria de R$ ${formatBRL(Number(ev.details?.valor) || 0)} (${ev.details?.motivo || 'sem motivo'})`
                                : `Cancelou "${ev.details?.produto || 'item'}"`}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">{new Date(ev.created_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <Badge color={ev.event_type === 'sangria_grande' ? 'bg-[var(--warn)]/10 text-[var(--warn)]' : 'bg-[var(--err)]/10 text-[var(--err)]'}>
                        {ev.event_type === 'sangria_grande' ? 'Sangria' : 'Cancelamento'}
                    </Badge>
                </div>
            ))}
        </div>
    )}
</Modal>
```

Ajuste os campos de `details` conforme a estrutura real gravada pelas RPCs da Task 2/migration 063 (`jsonb_build_object('valor', p_amount, 'motivo', p_reason)` pra sangria, `jsonb_build_object('produto', ...)` pra cancelamento — já documentado na migration, confira antes de assumir).

- [ ] **Passo 3: Typecheck, build, teste manual, commit, deploy**

Confirme que os eventos gravados nas Tasks 1/2 aparecem na lista, mais recentes primeiro.

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: tela de visualizacao da trilha de auditoria do caixa"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 4: Modal de Mesa — confirmação no atalho de Dinheiro/PIX

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `PaymentCaptureFields`)

**Contexto:** Confirmado com o dono (2026-08-30): adicionar confirmação também no atalho de 1 toque de Dinheiro/PIX, mesmo princípio já aplicado ao Cartão (que foi removido do atalho inteiramente cedo nesta sessão).

- [ ] **Passo 1: Adicionar confirmação ao clique**

Ache o bloco (`grep -n "onOneClickFinish(m.id)" components/modules/StoreModule.tsx`) e troque:

```tsx
onClick={() => onOneClickFinish(m.id)}
```

por:

```tsx
onClick={async () => {
    if (await confirm(`Finalizar em ${m.label} — R$ ${formatBRL(total)}? Essa ação fecha a conta e não pode ser desfeita.`)) {
        onOneClickFinish(m.id);
    }
}}
```

`confirm` já vem de `@/components/ConfirmDialog`, já importado no topo do arquivo — não precisa de import novo. `formatBRL` também já está em uso no mesmo componente.

- [ ] **Passo 2: Typecheck, build, teste manual, commit, deploy**

Teste numa loja de TESTE: clique no atalho de Dinheiro — confirme que aparece o diálogo antes de finalizar; cancele — confirme que NADA foi finalizado; confirme — finaliza normalmente.

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "fix: confirmacao no atalho de 1 toque para Dinheiro/PIX"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 5: Balcão — travar "Entregar" antes do pedido estar pronto

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `CounterView`)

**Contexto:** O botão que chama `handleClose` (entregar/receber pagamento) aparece idêntico e sempre clicável pros status `ACCEPTED`/`PREPARING`/`READY` — nada impede marcar como entregue um pedido que ainda está sendo preparado.

- [ ] **Passo 1: Localizar o botão**

`grep -n "handleClose" components/modules/StoreModule.tsx` dentro do range de `CounterView` (~3672-4255) — ache o `<Button onClick={() => handleClose(...)}>`.

- [ ] **Passo 2: Desabilitar quando não estiver pronto**

Adicione `disabled={order.status !== 'READY' && order.status !== 'PENDING'}` (mantendo o caso `PENDING`, que já tem outro texto/ação — "enviar pra cozinha" — segundo o achado da auditoria; ajuste o nome exato do enum de status conferindo `OrderStatus` em `types/index.ts`) e um estilo visual de desabilitado (`disabled:opacity-40 disabled:cursor-not-allowed`, mesmo padrão já usado em outros botões deste arquivo — `grep -n "disabled:opacity" components/modules/StoreModule.tsx` pra copiar a classe exata). Adicione também `title` explicando quando desabilitado: `title={order.status === 'PREPARING' ? 'Aguarde o pedido ficar pronto' : undefined}`.

- [ ] **Passo 3: Typecheck, build, teste manual, commit, deploy**

Teste numa loja de TESTE: pedido em "Preparando" — botão de entregar/receber deve estar desabilitado; muda pra "Pronto" — botão libera.

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "fix: trava botao Entregar no Balcao antes do pedido estar pronto"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 6: Grids sem `items-start` — Balcão, Cozinha/Bar, Cardápio (batch)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (3 grids diferentes, mesmo tipo de fix)

**Contexto:** Mesmo bug corrigido em `TablesView` hoje (grid sem `items-start` estica card curto pra igualar o mais alto da linha), reincidente em 3 lugares. Fix mecânico idêntico nos 3 — um implementador só, um commit só.

- [ ] **Passo 1: KdsView**

`grep -n "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" components/modules/StoreModule.tsx` (dentro de `KdsView`, ~linha 886). Adicione `items-start` à classe. Aproveite e adicione também `xl:grid-cols-4` (mesmo breakpoint que `TablesView` já tem), já que é a mesma linha.

- [ ] **Passo 2: CounterView**

`grep -n "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" components/modules/StoreModule.tsx` dentro de `CounterView` (~linha 4053). Adicione `items-start`.

- [ ] **Passo 3: MenuManagementView (produtos)**

`grep -n "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" components/modules/StoreModule.tsx` dentro de `MenuManagementView` (~linha 6056 — cuidado, o mesmo padrão de classe aparece em mais de um lugar do arquivo, confirme pelo contexto ao redor — deve estar logo depois de `{/* PRODUCTS */}`). Adicione `items-start`.

- [ ] **Passo 4: Typecheck, build, teste manual, commit, deploy**

Teste visual nas 3 telas: card com pouco conteúdo ao lado de card com muito conteúdo não deve mais esticar.

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "fix: items-start nos grids de Cozinha/Bar, Balcao e Cardapio (mesmo bug corrigido em Mesas)"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 7: Cozinha/Bar — legibilidade do atraso e do cronômetro

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `KdsView`)

**Contexto:** As duas informações mais urgentes do card de KDS (badge "Atrasado" e cronômetro de tempo decorrido) estão nos menores tamanhos de fonte da tela — o oposto do que uma tela olhada de longe/rápido precisa.

- [ ] **Passo 1: Badge de atraso**

`grep -n "text-\[10px\]" components/modules/StoreModule.tsx` dentro de `KdsView` (~linha 918, badge "Atrasado"). Troque `text-[10px]` por `text-xs` (mantenha o resto da classe, incluindo o negrito).

- [ ] **Passo 2: Cronômetro**

Ache o cronômetro (`grep -n "font-mono" components/modules/StoreModule.tsx` dentro de `KdsView`, ~linha 947). Troque `text-xs` por `text-sm` (ou `text-base` se ainda parecer pequeno ao testar visualmente).

- [ ] **Passo 3: Typecheck, build, teste manual, commit, deploy**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "fix: aumenta fonte do badge de atraso e do cronometro no KDS"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 8: Modal de Mesa — cardápio interno sem altura fixa

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro do modal de mesa, modo "Adicionar Pedido")

**Contexto:** `h-[70vh]` fixo no box do cardápio dentro do modal, independente do tamanho real do cardápio da loja.

- [ ] **Passo 1: Localizar e trocar**

`grep -n "h-\[70vh\]" components/modules/StoreModule.tsx`. Troque por `max-h-[70vh]` (mantém o teto pra não estourar a tela em cardápio grande, mas deixa de forçar altura fixa em cardápio pequeno) — confirme que o container já tem `overflow-y-auto` no grid interno (deveria já ter, só a altura do container pai é que está fixa).

- [ ] **Passo 2: Typecheck, build, teste manual, commit, deploy**

Teste com uma loja de cardápio curto (poucos produtos) — o box não deve mais sobrar espaço vazio embaixo.

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "fix: cardapio dentro do modal de mesa sem altura fixa desnecessaria"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 9: Dashboard — grids de KPI com colunas vazias (batch)

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**Contexto:** Duas grades reservam 4 (ou 2) colunas pra só 2 (ou 1) card, deixando metade da linha em branco em telas grandes.

- [ ] **Passo 1: KPIs de Faturamento**

Linha ~570-573 (`grep -n "lg:grid-cols-4" components/modules/StoreDashboardView.tsx`), com só 2 `StatCard` dentro ("Total no Período", "Ticket Médio"). Troque `lg:grid-cols-4` por `lg:grid-cols-2`.

- [ ] **Passo 2: Avaliações**

Linha ~754-756 (`grep -n "md:grid-cols-2 gap-4 mb-4" components/modules/StoreDashboardView.tsx`), com só 1 `StatCard` ("Nota Média") dentro. Troque `grid grid-cols-1 md:grid-cols-2` por só `grid grid-cols-1` (remove o breakpoint que nunca teria o que preencher).

- [ ] **Passo 3: Typecheck, build, teste manual, commit, deploy**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreDashboardView.tsx
git commit -m "fix: grids de KPI do Dashboard sem colunas vazias"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 10: Dashboard — fonte monoespaçada, cores por token, tooltip no escuro, estado vazio nos gráficos

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**Contexto:** Quatro achados de consistência, todos no mesmo arquivo — batch de um implementador só.

- [ ] **Passo 1: Fonte monoespaçada nos números**

No componente `StatCard` (`grep -n "const StatCard" components/modules/StoreDashboardView.tsx`, ~linha 389-402), ache o `<h3>` que mostra `value` e adicione a classe `num` na string de className (já existe em `app/globals.css` — é a classe usada nos 3 cards do topo que já fazem isso certo, `grep -n "className=\"num" components/modules/StoreDashboardView.tsx` pra copiar o padrão exato). Como `StatCard` é reusado em quase toda a tela, esse ajuste sozinho resolve a maioria dos números. Adicione também `num` nos `<span>`/`<p>` de `ChangeBadge` (~211-221) e nos 3 números do Funil de Conversão (~721/725/732).

- [ ] **Passo 2: Cores dos gráficos via tokens**

Troque a paleta hardcoded `const COLORS = [...]` (linha ~16) pelos tokens semânticos: use `'var(--ok)'`, `'var(--warn)'`, `'var(--info)'`, `'var(--brand)'` como as primeiras 4 cores (mantenha alguma cor extra literal só se sobrar categoria além dos 4 tokens — confirme quantas fatias o gráfico de Formas de Pagamento realmente usa antes de decidir se precisa de uma 5ª cor).

Troque `stroke="#484DB5"` (linha ~584, gráfico de Evolução) e `fill="#484DB5"` (linha ~671, gráfico de Ocupação) por `stroke="var(--brand)"`/`fill="var(--brand)"`.

- [ ] **Passo 3: Tooltip legível no modo escuro**

Nas 3 chamadas de `<RechartsTooltip .../>` (linhas ~583, 599, 670), adicione a prop `contentStyle`:

```tsx
<RechartsTooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
```

- [ ] **Passo 4: Estado vazio nos gráficos**

Nos dois `ResponsiveContainer` de gráfico (LineChart ~578-587, BarChart ~665-674), adicione a mesma checagem condicional já usada nas listas Top 5 (`grep -n "Sem dados" components/modules/StoreDashboardView.tsx` pra copiar o padrão exato — provavelmente um `data.length === 0 ? <p>Sem dados</p> : <ResponsiveContainer>...</ResponsiveContainer>`).

- [ ] **Passo 5: Typecheck, build, teste manual, commit, deploy**

Teste em modo escuro: passe o mouse nos 3 gráficos, confirme que o tooltip não é mais uma caixa branca sólida. Teste com um período sem vendas (ex.: filtro "Hoje" numa loja recém-criada), confirme que os gráficos mostram "Sem dados" em vez de eixos vazios.

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreDashboardView.tsx
git commit -m "fix: fonte monoespacada, cores por token, tooltip no escuro e estado vazio nos graficos do Dashboard"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

## Backlog (fora deste plano, de propósito — não implementar sem pedido explícito)

Achados reais da mesma auditoria, mas de maior risco/julgamento de design, deixados fora deste plano:

- **Cardápio**: modal de produto virar seções colapsáveis (9 seções empilhadas sem hierarquia), footer fixo pro botão "Salvar Produto" (hoje é preciso rolar tudo), aumentar a largura do modal (`size="md"`/`"lg"`, hoje `sm`/448px), mover "Integração NTB Estoque" pra Administração, adicionar busca de produto na lista principal, separar Categorias e Produtos em cards distintos.
- **Modal de Mesa**: resumo "Restante a Pagar" + botão de finalizar fixos no rodapé (hoje podem exigir rolagem), diferenciar visualmente a aba "Pagamento" (a única que de fato cobra) das outras 3 abas-calculadora (Divisão/Por Cliente/Calculadora), ícone distinto pra "remover taxa de serviço" vs. "cancelar item" (mesmo ícone hoje, ações financeiras diferentes).
- **Sistema inteiro**: `max-w-7xl` no container principal (`StoreLayout`) limita toda tela a ~1280px, inclusive a Cozinha/Bar que roda numa TV/monitor grande fixo — vale avaliar se deveria ser removido/aumentado especificamente pra essas duas abas (ou pro painel inteiro), mas é uma mudança que afeta TODAS as telas ao mesmo tempo e merece teste visual cuidadoso em cada uma antes de aplicar.

## Self-Review (já aplicado antes de entregar este plano)

- As 4 tasks de maior risco financeiro/segurança (1-4) vêm primeiro, seguidas da trava operacional (5), depois o bug de layout recorrente (6-9), depois consistência visual (10).
- Task 3 depende de Tasks 1 e 2 terem rodado primeiro pra ter dado real pra mostrar (não é bloqueio técnico — a tela funciona mesmo vazia — mas o teste manual da Task 3 só faz sentido depois das outras duas gerarem eventos).
- Nenhuma task duplica trabalho de outra — cada arquivo/linha aparece em exatamente uma task, exceto `StoreModule.tsx` que é tocado por quase todas (esperado, é o arquivo principal do sistema) em regiões diferentes e sem sobreposição.
- Nenhum placeholder tipo "adicionar validação" sem código exato — os campos de configuração (Tasks 1/2) e o modal de aprovação (Task 1) têm o JSX completo escrito no plano, não descrito.
