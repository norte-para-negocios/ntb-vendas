# Reforma da Aba Administração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a aba Administração do NTB Vendas (hoje 7 sub-abas soltas numa linha, mais "Configurações Gerais" perdida na aba errada) numa navegação por menu lateral com 4 categorias, com o formulário de Notas Fiscais quebrado em seções progressivas, campos financeiros em fonte monoespaçada, e motion mínimo e propositalmente diferente do cardápio do cliente.

**Architecture:** Todo trabalho é dentro de `components/modules/StoreModule.tsx` (arquivo já grande, ~11 mil linhas — nenhuma task tenta quebrá-lo em arquivos menores além do que já está descrito abaixo, isso é fora de escopo). Cada task é aditiva e testável isoladamente: mover um bloco de estado/JSX de um componente pro outro, trocar classes CSS, ou trocar o shell de navegação por cima do conteúdo já existente (o conteúdo interno de cada sub-view não muda de comportamento, só de onde é montado).

**Tech Stack:** Next.js 16, React 19, Tailwind v4, `motion/react` (já importado como `motion`/`AnimatePresence`/`MotionConfig`, é o sucessor do Framer Motion — mesma API), `Collapsible` já existente em `components/ui.tsx` (usado pra progressive disclosure, não precisa criar nada novo).

**Spec:** Não existe spec formal separada — a síntese de design que fundamenta este plano foi produzida nesta mesma sessão, rodando 13 skills de design/motion instaladas (`frontend-design`, `frontend-design-pro`, `distinctive-frontend`, `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`, `apple-design`, `ui-ux-pro-max`, `emil-design-eng`, GSAP, Genjutsu, `motion-design-skill`) isoladamente contra o mesmo problema e comparando os vereditos. Resumo das decisões que este plano implementa (aprovadas pelo dono no chat):
- Navegação: menu lateral fixo com 4 categorias, nunca dropdown (12 de 13 skills convergiram nisso).
- Notas Fiscais tem tratamento visual PRÓPRIO, não diluído dentro de "Loja" ao lado de coisas triviais (achado da `apple-design`: rótulo genérico demais pra dado que quebra emissão fiscal real se errado).
- Números financeiros/CSC em fonte monoespaçada (achado da `design-taste-frontend`: evita ambiguidade 1/l/I, 0/O em dado fiscal).
- Nenhuma cor semântica (`--ok/--warn/--err/--info`) pode ser removida/diluída (várias skills "de marca única" tentariam apagar isso; seria um erro aqui).
- Motion: nada de GSAP (unânime, overkill pra troca de aba). `motion/react`, crossfade curto (100-150ms), sem bounce/stagger, personalidade "Corporate/Profissional" — DIFERENTE de propósito da personalidade "carta de vinhos"/luxuosa do cardápio do cliente final.
- Formulário de Notas Fiscais quebra em seções colapsáveis (progressive disclosure) em vez de uma parede de campos só.

## Global Constraints

- Nunca remover ou trocar de nome as chaves de `stores.config` já existentes (`charge_service_fee`, `service_fee_rate`, `show_bestsellers`, `cash_shift_blind_count`, `printer_paper_width_mm`, `table_alert_occupied_minutes`, `table_alert_no_order_minutes`, `note_suggestions`, `accent_color`, `theme_preset`) — este plano só move ONDE essas configurações são exibidas, nunca como são persistidas (`updateStoreConfig` continua igual).
- Nenhuma task remove ou reescreve lógica de negócio já testada (validação de fiscal, upload de certificado, etc.) — só reorganiza layout/navegação/estilo em cima do que já existe.
- `npm run build` tem que passar limpo (typecheck + build) depois de CADA task antes de comitar.
- Deploy é manual: `git push origin main` seguido de `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"` — rodar isso ao final de cada task, testar ao vivo antes de ir pra próxima (mesmo padrão desta sessão).
- Cores/fontes fora dos tokens já existentes (`--brand`, `--ink`, `--surface`, `--text`, `--border`, `--ok/--warn/--err/--info`) são proibidas — nenhuma task deste plano introduz paleta nova. A fonte de marca (Atkinson Hyperlegible) continua sendo o padrão de texto; só números fiscais/financeiros específicos (Task 2) ganham `font-mono`.
- `motion/react` já é a única biblioteca de animação usada neste arquivo — nenhuma task deste plano adiciona GSAP nem qualquer outra dependência de animação nova.

---

### Task 1: Extrair "Configurações Gerais" de MenuManagementView pra novo componente StoreSettingsView

**Files:**
- Create: `components/modules/StoreSettingsView.tsx`
- Modify: `components/modules/StoreModule.tsx` (dentro de `MenuManagementView`, remover o bloco extraído; dentro de `StoreAdminView`, adicionar a nova sub-aba "Configurações")

**Interfaces:**
- Produz: `StoreSettingsView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void }>` — mesmo par de props que `MenuManagementView` já recebe, sem mudança de assinatura em nenhum dos dois.

**Contexto:** Hoje "Configurações Gerais" (taxa de serviço, mais vendidos automático, contagem cega no fechamento de turno, largura do papel da impressora, avisos de tempo na Gestão de Mesas, capa do cardápio, cor de destaque, identidade visual do cardápio, sugestões de observação) vive dentro de `MenuManagementView` (aba Cardápio) — pedido explícito do dono é que isso pertence a Administração, não a Cardápio. Todo o estado e handlers já existem, prontos e testados; esta task só MOVE, não reescreve nenhuma lógica.

- [ ] **Passo 1: Ler o bloco exato a mover**

Em `components/modules/StoreModule.tsx`, dentro de `MenuManagementView` (a função começa em `const MenuManagementView: React.FC<...> = ({ store, onStoreUpdate }) => {`), leia:
- As declarações de estado de `const [serviceFeeEnabled, ...]` até `const [isSavingThemePreset, ...]` (bloco contíguo de ~14 `useState`, procure pelo comentário `// Capa do cardápio (Task 1 do redesign iFood...`, é o início da região).
- O `useEffect` logo depois que resincroniza esse estado sempre que `store` muda (procure `setCurrentStoreConfig(store.config);` dentro de um `useEffect(() => { ... }, [store]);` — é UM useEffect só, não dividir).
- Todos os handlers entre esse `useEffect` e `handleRemoveNoteSuggestion` (inclusive): `handleSaveThemePreset`, `handleCoverFileChange`, `handleSaveCover`, `handleToggleServiceFee`, `handleToggleBlindCount`, `handleToggleBestsellers`, `handleChangePaperWidth`, `handleChangeTableAlert`, `handleSaveAccentColor`, `persistNoteSuggestions`, `handleAddNoteSuggestion`, `handleRemoveNoteSuggestion`.
- O bloco JSX inteiro: `<section className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm">` (comentário `{/* STORE SETTINGS */}` logo acima) até o `</section>` correspondente (é a única seção com esse comentário no arquivo — procure por ele, não conte chaves manualmente).

- [ ] **Passo 2: Criar o novo arquivo com o bloco movido**

Crie `components/modules/StoreSettingsView.tsx`:

```tsx
'use client';

// Extraído de MenuManagementView (StoreModule.tsx) em 2026-08-29 — pedido
// direto do dono: "Configurações Gerais" (taxa de serviço, largura de
// papel, avisos de mesa, capa, cor de destaque, identidade visual,
// sugestões de observação) estava na aba ERRADA (Cardápio), deveria estar
// em Administração desde sempre. Nenhuma lógica mudou aqui, só o lugar
// onde é montado — mesmo `updateStoreConfig`/`stores.config`, mesmas
// chaves, mesmo comportamento otimista com revert em erro.

import React, { useState, useEffect } from 'react';
import { AlertCircle, Upload } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { Store } from '@/types';
import { updateStoreConfig, updateStoreAccentColor, uploadStoreCover, updateStoreCoverUrl } from '@/lib/api';
import { THEME_PRESETS, resolveThemePreset, ThemePreset } from '@/lib/theme';
import { SERVICE_FEE_RATE, formatServiceFeeRate } from '@/lib/calc';
import { ACCENT_COLOR_DEFAULT } from '@/lib/colorContrast';

const StoreSettingsView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void }> = ({ store, onStoreUpdate }) => {
    // COLE AQUI, sem alterar uma linha, o bloco de useState identificado no Passo 1
    // (de `const [serviceFeeEnabled, ...]` até `const [isSavingThemePreset, ...]`).

    // COLE AQUI, sem alterar uma linha, o useEffect de resync identificado no Passo 1.

    // COLE AQUI, sem alterar uma linha, todos os handlers identificados no Passo 1
    // (handleSaveThemePreset até handleRemoveNoteSuggestion).

    return (
        // COLE AQUI, sem alterar uma linha, o <section>...</section> identificado no Passo 1.
    );
};

export default StoreSettingsView;
```

Confira os imports: alguns símbolos usados dentro do bloco colado (`THEME_PRESETS`, `resolveThemePreset`, `ThemePreset`, `SERVICE_FEE_RATE`, `formatServiceFeeRate`, `ACCENT_COLOR_DEFAULT`, ícones do lucide-react usados nesse trecho, `Button`/`Card`/`Input` de `@/components/ui`) precisam vir de onde já vêm em `StoreModule.tsx` — confira o import de cada símbolo lá antes de assumir o caminho acima; ajuste se algum vier de outro lugar.

- [ ] **Passo 2b: Verificar se `ACCENT_COLOR_DEFAULT` existe**

Rode: `grep -n "ACCENT_COLOR_DEFAULT" "components/modules/StoreModule.tsx" "lib/colorContrast.ts"`

Se não existir em `lib/colorContrast.ts`, veja de onde `StoreModule.tsx` importa esse símbolo hoje (`grep -n "import.*ACCENT_COLOR_DEFAULT" components/modules/StoreModule.tsx`) e use o mesmo caminho no novo arquivo.

- [ ] **Passo 3: Remover o bloco de MenuManagementView**

Em `components/modules/StoreModule.tsx`, dentro de `MenuManagementView`, apague exatamente o que foi copiado no Passo 1 (estado + useEffect + handlers + JSX). `MenuManagementView` continua com o resto do seu conteúdo (categorias, produtos, modal de produto) intacto — só perde a seção "STORE SETTINGS".

- [ ] **Passo 4: Importar e montar `StoreSettingsView` dentro de `StoreAdminView`**

Em `StoreModule.tsx`, adicione o import no topo:

```tsx
import StoreSettingsView from '@/components/modules/StoreSettingsView';
```

Dentro de `StoreAdminView`, ache a barra de abas (procure `{activeTab === 'impressao' && <PrinterSettingsView store={store} />}`) e adicione, imediatamente depois, uma nova aba "Configurações":

```tsx
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`pb-2 text-sm font-medium u-motion u-press-sm ${activeTab === 'settings' ? 'border-b-2 border-[var(--brand)] text-[var(--brand)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                        Configurações
                    </button>
```

(cole esse `<button>` logo depois do `<button>` de "Impressão" na mesma barra) e, junto aos blocos `{activeTab === '...' && (...)}`:

```tsx
            {activeTab === 'settings' && <StoreSettingsView store={store} onStoreUpdate={onStoreUpdate} />}
```

`StoreAdminView` já recebe `store`/`onStoreUpdate` como props — confirme isso lendo a assinatura de `StoreAdminView` (`grep -n "const StoreAdminView" components/modules/StoreModule.tsx`) antes de assumir que as variáveis `store`/`onStoreUpdate` existem nesse escopo.

- [ ] **Passo 5: Typecheck e build**

Rode: `npx tsc --noEmit`
Esperado: sem erros. Se aparecer erro de símbolo não encontrado no novo arquivo, é import faltando do Passo 2b — corrija lá, não em `StoreModule.tsx`.

Rode: `npm run build`
Esperado: build limpo.

- [ ] **Passo 6: Teste manual**

`npm run dev`, logar como lojista numa loja de teste (nunca a Sertão/loja real de cliente em produção — use uma loja de teste local ou `USE_MOCK`). Confirme:
- Aba Cardápio não mostra mais "Configurações Gerais".
- Aba Administração tem uma nova sub-aba "Configurações" com todo o conteúdo (taxa de serviço, papel da impressora, avisos de mesa, capa, cor, identidade visual, sugestões de observação) funcionando igual a antes (testar pelo menos 1 toggle e confirmar que persiste após F5).

- [ ] **Passo 7: Commit**

```bash
git add components/modules/StoreSettingsView.tsx components/modules/StoreModule.tsx
git commit -m "refactor: move Configuracoes Gerais de Cardapio para Administracao"
```

- [ ] **Passo 8: Deploy e teste ao vivo**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

Confirme em produção (`https://testvendase.norteparanegocios.com.br/loja`) que a aba Configurações aparece em Administração antes de seguir pra próxima task.

---

### Task 2: Fonte monoespaçada nos campos financeiros/fiscais

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro do bloco `activeTab === 'fiscal'`, linhas ~8115-8347 no estado atual do arquivo — confirme com `grep -n "activeTab === 'fiscal'" components/modules/StoreModule.tsx` antes de editar, porque a Task 1 pode ter deslocado números de linha)

**Contexto:** Achado da skill `design-taste-frontend`: dado fiscal/financeiro (CSC, CSCID, série, último número, inscrição municipal, CNPJ) deveria usar fonte monoespaçada — evita confundir `1`/`l`/`I` e `0`/`O` em campo que se errado quebra emissão fiscal real. `components/ui.tsx`'s `Input` já aceita uma prop de className extra — confirme isso antes de editar (`grep -n "export const Input" components/ui.tsx` e leia a assinatura).

- [ ] **Passo 1: Confirmar como o `Input` aceita estilo extra no campo**

Rode: `grep -n "export const Input" -A 20 components/ui.tsx`

Confirme se existe uma prop tipo `inputClassName` ou se o `className` passado vai pro `<input>` interno ou pro wrapper. Use a prop certa nos passos abaixo (se não existir nenhuma forma de estilizar só o `<input>`, adicione uma prop `inputClassName?: string` no componente `Input`, aplicada em `className={...inputClassName}` do `<input>` interno — mudança aditiva, nunca quebra os outros ~50 usos existentes do componente, que não vão passar essa prop).

- [ ] **Passo 2: Aplicar `font-mono` nos campos fiscais numéricos**

Dentro do bloco `activeTab === 'fiscal'`, adicione a classe de fonte monoespaçada (via a prop confirmada no Passo 1) nestes campos específicos — são os mesmos já mapeados, use `grep -n` pra achar a linha exata de cada `value={...}` antes de editar:

- `value={fiscalNfeSerie}` / `value={fiscalNfeUltimoNumero}`
- `value={fiscalNfceSerie}` / `value={fiscalNfceUltimoNumero}`
- `value={fiscalCscHomologacao}` / `value={fiscalCscidHomologacao}`
- `value={fiscalCscProducao}` / `value={fiscalCscidProducao}`
- `value={fiscalCteSerie}` / `value={fiscalCteUltimoNumero}`
- `value={fiscalMdfeSerie}` / `value={fiscalMdfeUltimoNumero}`
- `value={fiscalInscricaoMunicipal}`
- `value={fiscalCnpjAutorizado}`
- `value={fiscalInscricaoEstadual}`

Exemplo de como fica um deles (mantenha todos os outros props do `Input` iguais, só adicione a nova prop):

```tsx
<Input type="number" label="Série" inputClassName="font-mono" value={fiscalNfeSerie} onChange={e => setFiscalNfeSerie(e.target.value)} />
```

Não aplique `font-mono` em campos de texto livre (Razão Social, Nome Fantasia, endereço, observações) — só em número de série/protocolo/CSC/inscrição, que é dado onde ambiguidade de caractere importa.

- [ ] **Passo 3: Typecheck, build, commit, deploy**

```bash
npx tsc --noEmit
npm run build
git add components/ui.tsx components/modules/StoreModule.tsx
git commit -m "fix: campos fiscais numericos (CSC/serie/inscricao) em fonte monoespacada"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

Teste ao vivo: abra Administração > Configurações (ou Notas Fiscais, dependendo de quando essa task rodar em relação à Task 3) e confirme visualmente que os campos listados usam fonte monoespaçada.

---

### Task 3: Progressive disclosure no formulário de Notas Fiscais

**Files:**
- Modify: `components/modules/StoreModule.tsx` (bloco `activeTab === 'fiscal'`)

**Contexto:** Hoje existe UM `<Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>` (`components/ui.tsx`, já usado no projeto) envolvendo TODO o formulário fiscal — uma vez aberto, ainda é uma parede única de ~200 linhas de campos (certificado, ambiente, NF-e/NFC-e, CSC, CT-e/MDF-e, dados gerais, identificação da empresa, endereço, padrões de impostos). Esta task quebra isso em `Collapsible`s aninhados, cada um só com o grupo de campos que descreve — nenhuma lógica de validação/salvamento muda, só a organização visual.

- [ ] **Passo 1: Mapear os grupos existentes**

Rode: `grep -n "uppercase tracking-wide\">.*<\/p>" components/modules/StoreModule.tsx` dentro do range de `activeTab === 'fiscal'` pra confirmar os títulos de grupo já existentes no código hoje: "NF-e (com destinatário)", "NFC-e (cupom fiscal)", "CSC — Homologação", "CSC — Produção", "CT-e", "MDF-e", "Dados gerais", "Identificação da empresa", "Endereço", "Padrões de impostos" — mais o bloco de Certificado Digital e o de Ambiente/Modelo de emissão, que não têm esse `<p>` de rótulo mas têm `<label>` próprio.

- [ ] **Passo 2: Remover o `Collapsible` único externo, criar um por grupo**

Troque o `<Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>` externo por `Collapsible`s independentes, na mesma ordem em que os campos já aparecem hoje (não precisa reordenar campo nenhum, só agrupar o que já está adjacente):

```tsx
<div className="space-y-3">
    <Collapsible title="Certificado Digital" defaultOpen={true}>
        {/* aqui vai exatamente o conteúdo que hoje está em
            "Certificado Digital (fiscal)" — upload, validade, senha,
            botão "Salvar Certificado" */}
    </Collapsible>

    <Collapsible title="Ambiente e Emissão Automática" defaultOpen={false}>
        {/* aqui vai o select de Ambiente + select de Modelo de emissão
            automática + o aviso de homologação */}
    </Collapsible>

    <Collapsible title="Numeração (NF-e / NFC-e / CT-e / MDF-e)" defaultOpen={false}>
        {/* aqui vai TUDO que hoje é condicional em fiscalModeloEmissaoAutomatica
            (bloco NF-e, bloco NFC-e com os 2 sub-blocos de CSC dentro,
            e os blocos de CT-e/MDF-e) — a lógica condicional de mostrar só
            o tipo escolhido continua exatamente igual, só muda o
            container em volta */}
    </Collapsible>

    <Collapsible title="Dados Gerais" defaultOpen={false}>
        {/* inscrição municipal, telefone, casas decimais, CNPJ autorizado,
            observação padrão de pedido/orçamento */}
    </Collapsible>

    <Collapsible title="Identificação da Empresa" defaultOpen={false}>
        {/* razão social, nome fantasia, tipo, inscrição estadual, e o
            bloco de Endereço completo (logradouro até CEP) */}
    </Collapsible>

    <Collapsible title="Padrões de Impostos" defaultOpen={false}>
        {/* CST/CSOSN, CST/PIS, CST/COFINS, CST/IPI, frete padrão, tipo de
            pagamento padrão, natureza de operação padrão */}
    </Collapsible>

    <Button variant="secondary" className="w-full" onClick={handleSaveFiscalConfig} isLoading={isSavingFiscalConfig}>
        Salvar Configuração Fiscal
    </Button>
</div>
```

Importante: o botão único "Salvar Configuração Fiscal" continua UM só, fora de todos os `Collapsible`s, salvando tudo de uma vez — não crie um botão de salvar por seção (isso mudaria comportamento, `handleSaveFiscalConfig` já manda o objeto inteiro pra `updateStoreFiscalConfig`, ver `lib/api.ts`). O botão "Salvar Certificado" (dentro de "Certificado Digital") continua separado, é uma chamada diferente (`handleSaveCertificate`) que já existia assim.

`FiscalNotasView` (que fica ANTES desse formulário inteiro, mostrando as notas já emitidas) não faz parte desta reorganização — continua fora de qualquer `Collapsible`, sempre visível.

- [ ] **Passo 3: Typecheck, build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Passo 4: Teste manual**

Abra a aba de Notas Fiscais numa loja de teste. Confirme: "Certificado Digital" vem aberto por padrão, as outras 5 seções vêm fechadas; abrir/fechar cada uma não perde o que já foi digitado nas outras; o botão "Salvar Configuração Fiscal" continua salvando tudo (teste preenchendo um campo em 2 seções diferentes e clicando salvar uma vez só).

- [ ] **Passo 5: Commit e deploy**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: formulario de Notas Fiscais em secoes colapsaveis (progressive disclosure)"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 4: Menu lateral com 4 categorias substituindo as abas soltas

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `StoreAdminView`)

**Interfaces:**
- Consome: os mesmos valores de `activeTab` já usados hoje (`'dashboard' | 'sales' | 'users' | 'link' | 'fiscal' | 'shifts' | 'impressao' | 'settings'`) — nenhum sub-view muda de nome de tab, só a barra de navegação por cima muda de layout.

**Contexto:** Substitui a `<div className="flex space-x-4 border-b ...">` com 8 `<button>` numa linha só por um menu lateral com 4 categorias. Notas Fiscais ganha destaque visual próprio dentro de "Loja" (não é só mais um item da lista — achado da `apple-design`), com um ícone de cadeado e um separador visual antes dela.

- [ ] **Passo 1: Definir a estrutura de categorias**

No topo de `StoreAdminView` (antes do `return`), adicione:

```tsx
const ADMIN_NAV_GROUPS: { label: string; icon: React.ReactNode; tabs: { id: string; label: string; sensitive?: boolean }[] }[] = [
    { label: 'Visão Geral', icon: <LayoutDashboard size={16} />, tabs: [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'sales', label: 'Histórico de Vendas' },
    ]},
    { label: 'Operação', icon: <Wallet size={16} />, tabs: [
        { id: 'shifts', label: 'Turnos' },
        { id: 'impressao', label: 'Impressão' },
    ]},
    { label: 'Time', icon: <Users size={16} />, tabs: [
        { id: 'users', label: 'Gestão de Usuários' },
    ]},
    { label: 'Loja', icon: <StoreIcon size={16} />, tabs: [
        { id: 'link', label: 'Meu Link / QR Code' },
        { id: 'settings', label: 'Configurações' },
        { id: 'fiscal', label: 'Notas Fiscais', sensitive: true },
    ]},
];
```

`LayoutDashboard`, `Wallet`, `Users`, `StoreIcon` (alias de `Store` do lucide-react) já estão importados no topo do arquivo — confirme com `grep -n "LayoutDashboard\|Wallet\|Users,\|Store as StoreIcon" components/modules/StoreModule.tsx` antes de assumir.

- [ ] **Passo 2: Trocar a barra de abas por menu lateral**

Troque a `<div className="flex space-x-4 border-b border-[var(--border)] pb-2">...</div>` (os 8 `<button>` antigos) por:

```tsx
<div className="flex gap-6">
    <nav className="w-56 flex-shrink-0 space-y-5">
        {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.label}>
                <p className="px-3 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    {group.icon} {group.label}
                </p>
                <div className="space-y-0.5">
                    {group.tabs.map((tab) => (
                        <React.Fragment key={tab.id}>
                            {tab.sensitive && <div className="my-1.5 border-t border-[var(--warn)]/30" />}
                            <button
                                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium u-motion u-press-sm flex items-center gap-1.5 ${
                                    activeTab === tab.id
                                        ? 'bg-[var(--brand)]/10 text-[var(--brand)] font-bold'
                                        : tab.sensitive
                                            ? 'text-[var(--warn)] hover:bg-[var(--warn)]/5'
                                            : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                                }`}
                            >
                                {tab.sensitive && <Lock size={12} />}
                                {tab.label}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            </div>
        ))}
    </nav>
    <div className="flex-1 min-w-0">
        {/* todos os blocos {activeTab === '...' && (...)} continuam aqui, sem mudar nada dentro deles */}
    </div>
</div>
```

`setActiveTab` precisa aceitar qualquer uma dessas strings — confirme o tipo declarado de `activeTab`/`setActiveTab` (`grep -n "const \[activeTab, setActiveTab\]" components/modules/StoreModule.tsx`) e ajuste o cast `as typeof activeTab` se o tipo já for uma union literal (nesse caso pode remover o cast, o TypeScript infere sozinho).

`Lock` já está importado (usado no botão de bloquear mesa) — confirme com `grep -n "^import.*Lock" components/modules/StoreModule.tsx`.

- [ ] **Passo 3: Typecheck, build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Passo 4: Teste manual**

Confirme visualmente: 4 grupos no menu lateral, "Notas Fiscais" com separador e ícone de cadeado antes dela dentro de "Loja", clicar em cada item troca o conteúdo à direita exatamente como antes (nenhum sub-view quebrou), item ativo destacado.

- [ ] **Passo 5: Commit e deploy**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: Administracao vira menu lateral com 4 categorias (Visao Geral/Operacao/Time/Loja)"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

### Task 5: Motion mínimo na troca de categoria/aba

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de `StoreAdminView`, envolvendo a área de conteúdo `{activeTab === '...' && (...)}`)

**Contexto:** Achado convergente de GSAP-skills, Genjutsu e `motion-design-skill`: painel usado 50x/dia precisa de motion quase invisível (100-150ms, sem bounce/stagger) — nada de GSAP, `motion/react` (já importado) resolve. Personalidade "Corporate/Profissional", propositalmente mais rápida e mais discreta que a do cardápio do cliente final.

- [ ] **Passo 1: Envolver a área de conteúdo com crossfade**

Dentro do `<div className="flex-1 min-w-0">` criado na Task 4, envolva TODOS os blocos `{activeTab === '...' && (...)}` com:

```tsx
<div className="flex-1 min-w-0">
    <AnimatePresence mode="wait">
        <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
        >
            {activeTab === 'dashboard' && ( /* ... conteúdo já existente, sem mudar ... */ )}
            {activeTab === 'sales' && ( /* ... */ )}
            {/* resto dos blocos, sem alterar o conteúdo interno de nenhum */}
        </motion.div>
    </AnimatePresence>
</div>
```

`motion` e `AnimatePresence` já estão importados no topo do arquivo (`import { motion, AnimatePresence, MotionConfig } from 'motion/react';`) — não precisa de import novo.

Note a exit SEM `y` (só opacity) — regra da skill Genjutsu: "elemento saindo nunca precisa de deslocamento, só o que entra"; e duração da entrada (120ms) igual ou levemente maior que a saída, nunca o contrário.

- [ ] **Passo 2: Indicador deslizante no item ativo do menu (opcional, só se o Passo 1 já estiver aprovado ao vivo)**

No `<button>` de cada item do menu lateral (Task 4, Passo 2), adicione um indicador com `layoutId` compartilhado entre todos os botões do MESMO grupo (não entre grupos diferentes, cada grupo tem seu próprio contexto):

```tsx
<button
    onClick={() => setActiveTab(tab.id as typeof activeTab)}
    className={`relative w-full text-left px-3 py-2 rounded-lg text-sm font-medium u-motion u-press-sm flex items-center gap-1.5 ${/* ...classes já existentes... */}`}
>
    {activeTab === tab.id && (
        <motion.div
            layoutId="admin-nav-active"
            className="absolute inset-0 rounded-lg bg-[var(--brand)]/10 -z-10"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
    )}
    {tab.sensitive && <Lock size={12} />}
    {tab.label}
</button>
```

Remova o `bg-[var(--brand)]/10` fixo da classe condicional do item ativo (Task 4, Passo 2) já que agora o fundo vem do `motion.div` deslizante — mantenha só `text-[var(--brand)] font-bold` na classe de texto.

- [ ] **Passo 3: Typecheck, build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Passo 4: Teste manual**

Clique rapidamente entre 3-4 categorias/abas em sequência (simulando um garçom com pressa). Confirme: nenhum "engasgo" perceptível, nenhuma animação de entrada de mais de ~150ms, o indicador (se implementado no Passo 2) desliza suave entre itens do mesmo grupo sem piscar.

- [ ] **Passo 5: Commit e deploy**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: motion minimo (crossfade 120ms) na troca de aba/categoria em Administracao"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
```

---

## Self-Review (já aplicado antes de entregar este plano)

- Cobertura da síntese de design: navegação lateral (Task 4) ✅, Notas Fiscais com tratamento próprio (Task 4, item `sensitive`) ✅, fonte monoespaçada em dado fiscal (Task 2) ✅, progressive disclosure no formulário fiscal (Task 3) ✅, motion mínimo/Corporate (Task 5) ✅, Configurações Gerais de volta pra Administração (Task 1) ✅, preservar cores semânticas e tokens existentes (Global Constraints) ✅.
- Nenhuma task depende de uma posterior (ordem sugerida acima é a mais segura, mas Task 2 e Task 3 podem trocar de ordem entre si sem problema; Task 1 precisa vir antes das outras porque Task 4 já referencia a aba `'settings'`).
- Nenhum placeholder tipo "adicionar validação" ou "similar ao de cima" sem o código/instrução exata — os passos "cole aqui o bloco X" são extração de código já existente e testado, não implementação nova, por isso citam faixa exata a localizar via `grep`/comentário-âncora em vez de reproduzir centenas de linhas já escritas no arquivo.
