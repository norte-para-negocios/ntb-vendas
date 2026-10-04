# Administração em 5 áreas + Configurações organizadas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os 11 botões soltos da Administração por 5 áreas (Vendas, Caixa, Cardápio, Equipe, Configurações), com sub-abas, busca de ajustes, Configurações em seções com índice, status resumido por cartão e, no celular, lista de cartões com entrada e volta, sem mudar o comportamento de nenhuma tela, só o lugar dela.

**Architecture:** Toda a navegação vira dados puros em `lib/adminNav.ts` (áreas, abas, seções, ajustes, visibilidade por função, busca), testados com `npx tsx`. `StoreAdminView` (components/modules/StoreModule.tsx:11073) continua dono do estado `activeTab` (os ids antigos seguem valendo, então nenhum efeito de carregamento quebra); o menu atual (`ADMIN_NAV_GROUPS`, :11755–:11850) sai e entra um `AdminNavShell` novo, em arquivo próprio. `StoreSettingsView.tsx` (771 linhas, 14 ajustes em fila) é fatiado em seções por arquivo; os 9 handlers quase idênticos viram um hook único com "Desfazer".

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 com tokens (`var(--surface)`, `--brand`, `--ok`, `--warn`, `--err`), `motion/react` (já usado no menu atual), `lucide-react`, `toast.undo` (components/Toast.tsx:24), testes `npx tsx scripts/testes/*.test.ts` + `node:assert`.

**Spec:** conversa com o dono em 04/10/2026 ("tá cheia de botão… tá tudo confuso… a gente precisa de uma coisa melhor pras pessoas verem"; "as 5 áreas") + `docs/superpowers/plans/2026-10-04-mesa-cardapio-permissoes.md` (Task 3 = view de permissões, Task 2 = auditoria do cardápio) + plano de tema `docs/superpowers/plans/2026-10-04-tema-e-pedidos-do-dia.md` (janelas sólidas, só a preferência da pessoa decide claro/escuro).

## Global Constraints

- Português do Brasil na UI. Sem `window.confirm`/`alert`. Alvo de toque mínimo de 44 px no celular (`max-sm:min-h-11`, mesmo padrão de StoreSettingsView.tsx:464).
- **Nada muda de comportamento, só de lugar.** Os ids de aba antigos (`dashboard, sales, shifts, relatorios, excecoes, impressao, users, link, settings, cupons, precos, fiscal`) continuam existindo e continuam sendo o valor de `activeTab`; os efeitos que dependem deles (`loadSales` em :11418, :11431, `shifts` em :11444, `setActiveTab('sales')` em :11869) não são tocados.
- **NÃO é redesign.** Decisão do dono: manter a identidade visual atual (tokens de `app/globals.css`, `components/ui.tsx`, sidebar azul, cartões `bg-[var(--surface)] rounded-[14px] shadow-[var(--shadow-sm)]`, pílulas `rounded-full` com `bg-[var(--brand-fill)]` na ativa, `Button`/`Card`/`Input` existentes). A navegação em 5 áreas tem que parecer evolução do menu de hoje (:11755–:11850), não outra tela: mesmas alturas (`h-9` no computador, `min-h-11` no celular), mesmo tamanho de texto (15 px), mesmos raios e sombras, mesmo cabeçalho de grupo em `text-[13px] var(--text-muted)`.
- **Animação: reaproveitar, não inventar.** Ficam como estão o crossfade de 120 ms na troca de aba (`AnimatePresence mode="wait"`, `opacity` + `y: 4`, `easeOut`, :11843–:11850), o indicador ativo por `layoutId` com mola `{ stiffness: 400, damping: 30 }` (:11823–:11829) e as classes `u-motion`, `u-press`, `u-press-sm`. Transições novas (home do celular → área, volta) são curtas (120–160 ms), só `opacity` e deslocamento ≤ 8 px, mesma curva `easeOut`; sem mola nova, sem bounce, sem escalonamento; respeitam `prefers-reduced-motion` (como o resto do app). Tela usada dezenas de vezes por dia: o movimento tem que ser quase invisível, só dar noção de lugar.
- Só tokens de cor (`var(--…)`); nenhuma cor fixa, nenhum `on-glass`. Nada de `dark:` solto: o tema vem dos tokens (regra do plano de tema).
- Permissões: o que a função não pode usar **some** do menu. Hoje só `excecoes` tem trava (`podeVerCaixasDaEquipe`, lib/caixasAoVivo.ts:34); `saude`, `precos`, `permissoes` passam a respeitar `roleCan` quando o plano de permissões existir. Dono e conta universal veem tudo.
- Configurar módulos/mesas continua exclusivo do Master Admin (AGENTS.md, "Configurar operação da loja é EXCLUSIVO do Master Admin"); este plano não cria nenhum controle de módulo para o lojista.
- QA **só** em loja de teste: ZZ Laboratório ou Donana. **Nunca "O Sertão Vai Virar Mar"** (produção). Apagar o que criar. Sem nota fiscal real, sem chamada em massa ao Omie.
- Deploy só com a loja fechada, `deploy.sh` manual; sem migration neste plano (tudo em `stores.config`, chaves que já existem).
- Cada task termina com `npx tsc --noEmit` limpo, testes da task passando e commit. Mensagem de commit termina com:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7`.

## Review Focus

1. **Aba ativa some por permissão** (ex.: o usuário estava em `excecoes` e perdeu a função): a tela cai na primeira aba visível, nunca fica em branco. Teste na Task 1 (`corrigirAba`).
2. **Área sem nenhuma aba visível** (função com pouco acesso) não aparece no menu nem no celular. Teste na Task 1.
3. **Busca com acento, caixa alta e várias palavras** ("Tolerância", "TOLERANCIA caixa") acha o ajuste certo; busca vazia ou sem resultado não quebra. Teste na Task 1.
4. **Salvar na hora falha** (rede caiu): o interruptor volta ao valor anterior e aparece erro; "Desfazer" depois de um salvar não vira laço infinito. Testes na Task 3 (`aplicarPatch`) e QA offline na Task 9.
5. **Chave de configuração ausente** (loja que nunca salvou nada): cada ajuste mostra o mesmo padrão de hoje (`client_ordering` ausente = ligado, `pedido_pede_senha` ausente = desligado). Teste na Task 3.
6. **Status do cartão com dado ainda carregando ou falho**: o cartão mostra só o título, sem "undefined" nem "NaN". Teste na Task 2.
7. **A cara continua a mesma**: lado a lado com as capturas de antes (Task 4, Step 1), o menu novo usa os mesmos tokens, alturas, raios e animações; ninguém precisa "reaprender" o visual, só encontra as coisas num lugar mais lógico. Verificação visual na Task 10.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/adminNav.ts` (novo) | `AREAS`, `AJUSTES`, `abasVisiveis`, `areasVisiveis`, `areaDaAba`, `corrigirAba`, `buscarAjustes` |
| `lib/adminStatus.ts` (novo) | frases de status por cartão + tom (`ok`/`atencao`/`erro`/`neutro`) |
| `lib/configPatch.ts` (novo) | `aplicarPatch(config, patch)` puro (usado pelo salvar/desfazer) |
| `components/modules/settings/SettingsConfigContext.tsx` (novo) | contexto + `useSetting` (otimista, reverte, Desfazer) |
| `components/modules/settings/SettingRow.tsx` (novo) | linha título + explicação + controle (interruptor, número, segmentos) |
| `components/modules/settings/SecaoAtendimento.tsx`, `SecaoPedidoCliente.tsx`, `SecaoAparencia.tsx`, `SecaoImpressao.tsx`, `SecaoAplicativo.tsx` (novos) | blocos movidos de `StoreSettingsView.tsx` |
| `components/modules/admin/RegrasCaixaView.tsx` (novo) | tolerância, contagem cega, alerta de sangria (saem de Configurações) |
| `components/modules/StoreSettingsView.tsx` (editar) | vira casca: provedor + índice lateral + seções |
| `components/modules/admin/AdminNavShell.tsx` (novo) | trilho de áreas (desktop), cabeçalho com sub-abas, busca, home em cartões (celular) |
| `components/modules/admin/useAdminStatus.ts` (novo) | carrega o necessário para os status dos cartões |
| `components/modules/StoreModule.tsx` (editar) | `StoreAdminView`: troca o menu pelo `AdminNavShell`; liga as abas novas |

---

### Task 1: Navegação como dado puro (`lib/adminNav.ts`)

**Files:**
- Create: `lib/adminNav.ts`, `scripts/testes/adminNav.test.ts`

**Interfaces:**
- Produces:
  - `type AreaId = 'vendas' | 'caixa' | 'cardapio' | 'equipe' | 'config'`
  - `type AbaId = 'dashboard' | 'sales' | 'relatorios' | 'excecoes' | 'shifts' | 'regras_caixa' | 'saude' | 'precos' | 'cupons' | 'link' | 'users' | 'permissoes' | 'settings' | 'impressao' | 'fiscal'`
  - `type SecaoId = 'atendimento' | 'pedido_cliente' | 'impressao' | 'aparencia' | 'aplicativo' | 'regras'`
  - `interface AbaDef { id: AbaId; label: string; sensitive?: boolean }`, `interface AreaDef { id: AreaId; label: string; descricao: string; abas: AbaDef[] }`
  - `interface NavCtx { user: { role: string }; podeVerExcecoes: boolean; can?: (acao: 'editar_cardapio' | 'editar_precos_horario' | 'ver_permissoes') => boolean }`
  - `const ABAS_EM_BREVE: Set<AbaId>` (começa com `saude`, `permissoes`; a Task 9 esvazia)
  - `abasVisiveis(ctx): Set<AbaId>`, `areasVisiveis(ctx): AreaDef[]` (cada área já com as abas filtradas), `areaDaAba(id): AreaId`, `abaInicial(area, ctx): AbaId | null`, `corrigirAba(atual, ctx): AbaId`
  - `interface Ajuste { id: string; titulo: string; descricao: string; secao: SecaoId; aba: AbaId; palavras: string[] }`, `const AJUSTES: Ajuste[]`, `buscarAjustes(q: string, lista?: Ajuste[]): Ajuste[]`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/adminNav.test.ts
import assert from 'node:assert/strict';
import { AREAS, AJUSTES, ABAS_EM_BREVE, abasVisiveis, areasVisiveis, areaDaAba, abaInicial, corrigirAba, buscarAjustes, type NavCtx } from '../../lib/adminNav';

const dono: NavCtx = { user: { role: 'owner' }, podeVerExcecoes: true };
const garcom: NavCtx = { user: { role: 'waiter' }, podeVerExcecoes: false, can: () => false };
const semEmBreve = () => ABAS_EM_BREVE.clear(); // o teste olha a regra de permissão, não o "em breve"
semEmBreve();

// estrutura: as 12 abas antigas continuam, cada uma em exatamente uma área
const antigas = ['dashboard', 'sales', 'shifts', 'relatorios', 'excecoes', 'impressao', 'users', 'link', 'settings', 'cupons', 'precos', 'fiscal'];
const todas = AREAS.flatMap((a) => a.abas.map((b) => b.id));
antigas.forEach((id) => assert.equal(todas.filter((x) => x === id).length, 1, `${id} em exatamente uma área`));
assert.equal(new Set(todas).size, todas.length, 'ids de aba únicos');
assert.deepEqual(AREAS.map((a) => a.id), ['vendas', 'caixa', 'cardapio', 'equipe', 'config']);

// dono vê tudo; garçom perde exceções, saúde, preço por horário
assert.equal(abasVisiveis(dono).size, todas.length);
const g = abasVisiveis(garcom);
assert.equal(g.has('excecoes'), false);
assert.equal(g.has('saude'), false);
assert.equal(g.has('precos'), false);
assert.equal(g.has('dashboard'), true, 'o que não tem trava continua visível');

// Review Focus 2: área sem aba visível some
const nada: NavCtx = { user: { role: 'waiter' }, podeVerExcecoes: false, can: () => false };
assert.ok(areasVisiveis(nada).every((a) => a.abas.length > 0));
assert.equal(areasVisiveis(dono).length, 5);

// areaDaAba / abaInicial
assert.equal(areaDaAba('regras_caixa'), 'caixa');
assert.equal(areaDaAba('fiscal'), 'config');
assert.equal(abaInicial('vendas', dono), 'dashboard');
assert.equal(abaInicial('cardapio', garcom), 'cupons', 'primeira aba que a função enxerga');

// Review Focus 1: aba ativa que sumiu cai na primeira visível
assert.equal(corrigirAba('excecoes', garcom), 'dashboard');
assert.equal(corrigirAba('sales', garcom), 'sales');

// "em breve" esconde sem quebrar
ABAS_EM_BREVE.add('saude');
assert.equal(abasVisiveis(dono).has('saude'), false);
ABAS_EM_BREVE.clear();

// Review Focus 3: busca com acento, caixa alta, várias palavras, vazio
assert.equal(buscarAjustes('taxa')[0].id, 'taxa_servico');
assert.equal(buscarAjustes('TOLERANCIA')[0].id, 'tolerancia_caixa');
assert.equal(buscarAjustes('tolerância caixa')[0].id, 'tolerancia_caixa');
assert.ok(buscarAjustes('papel').some((a) => a.id === 'largura_papel'));
assert.deepEqual(buscarAjustes('   '), []);
assert.deepEqual(buscarAjustes('xyzqwerty'), []);
// título pesa mais que descrição
assert.equal(buscarAjustes('senha')[0].id, 'pedido_pede_senha');

// consistência do registro: id único, aba existe, ajuste de caixa mora em Caixa
assert.equal(new Set(AJUSTES.map((a) => a.id)).size, AJUSTES.length);
AJUSTES.forEach((a) => assert.ok(todas.includes(a.aba), `aba ${a.aba} do ajuste ${a.id} existe`));
assert.equal(AJUSTES.find((a) => a.id === 'contagem_cega')!.aba, 'regras_caixa');
assert.equal(AJUSTES.length, 14);
console.log('adminNav: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/adminNav.test.ts` → `Cannot find module '../../lib/adminNav'`

- [ ] **Step 3: Implementação**

```ts
// lib/adminNav.ts — navegação da Administração como dado puro (sem React, sem I/O).
export type AreaId = 'vendas' | 'caixa' | 'cardapio' | 'equipe' | 'config';
export type AbaId =
  | 'dashboard' | 'sales' | 'relatorios' | 'excecoes'
  | 'shifts' | 'regras_caixa'
  | 'saude' | 'precos' | 'cupons' | 'link'
  | 'users' | 'permissoes'
  | 'settings' | 'impressao' | 'fiscal';
export type SecaoId = 'atendimento' | 'pedido_cliente' | 'impressao' | 'aparencia' | 'aplicativo' | 'regras';

export interface AbaDef { id: AbaId; label: string; sensitive?: boolean }
export interface AreaDef { id: AreaId; label: string; descricao: string; abas: AbaDef[] }

export const AREAS: AreaDef[] = [
  { id: 'vendas', label: 'Vendas', descricao: 'O que a loja vendeu', abas: [
    { id: 'dashboard', label: 'Resumo' },
    { id: 'sales', label: 'Histórico' },
    { id: 'relatorios', label: 'Relatórios' },
    { id: 'excecoes', label: 'Exceções' },
  ] },
  { id: 'caixa', label: 'Caixa', descricao: 'Turnos e regras do caixa', abas: [
    { id: 'shifts', label: 'Turnos' },
    { id: 'regras_caixa', label: 'Regras do caixa' },
  ] },
  { id: 'cardapio', label: 'Cardápio', descricao: 'Saúde, preços, cupons e link', abas: [
    { id: 'saude', label: 'Saúde do cardápio' },
    { id: 'precos', label: 'Preço por horário' },
    { id: 'cupons', label: 'Cupons' },
    { id: 'link', label: 'Link e QR code' },
  ] },
  { id: 'equipe', label: 'Equipe', descricao: 'Pessoas e o que cada função pode', abas: [
    { id: 'users', label: 'Pessoas' },
    { id: 'permissoes', label: 'Permissões' },
  ] },
  { id: 'config', label: 'Configurações', descricao: 'Atendimento, impressão e notas', abas: [
    { id: 'settings', label: 'Geral' },
    { id: 'impressao', label: 'Impressão' },
    { id: 'fiscal', label: 'Notas fiscais', sensitive: true },
  ] },
];

// Abas cujas telas ainda não existem; a Task 9 do plano esvazia este conjunto.
export const ABAS_EM_BREVE = new Set<AbaId>(['saude', 'permissoes']);

export interface NavCtx {
  user: { role: string };
  podeVerExcecoes: boolean;
  can?: (acao: 'editar_cardapio' | 'editar_precos_horario' | 'ver_permissoes') => boolean;
}

const EXIGE: Partial<Record<AbaId, (c: NavCtx) => boolean>> = {
  excecoes: (c) => c.podeVerExcecoes,
  saude: (c) => (c.can ? c.can('editar_cardapio') : true),
  precos: (c) => (c.can ? c.can('editar_precos_horario') : true),
  permissoes: (c) => (c.can ? c.can('ver_permissoes') : true),
};

export function abasVisiveis(ctx: NavCtx): Set<AbaId> {
  const out = new Set<AbaId>();
  AREAS.forEach((a) => a.abas.forEach((b) => {
    if (ABAS_EM_BREVE.has(b.id)) return;
    const ok = EXIGE[b.id];
    if (!ok || ok(ctx)) out.add(b.id);
  }));
  return out;
}

export function areasVisiveis(ctx: NavCtx): AreaDef[] {
  const v = abasVisiveis(ctx);
  return AREAS.map((a) => ({ ...a, abas: a.abas.filter((b) => v.has(b.id)) })).filter((a) => a.abas.length > 0);
}

export function areaDaAba(id: AbaId): AreaId {
  return AREAS.find((a) => a.abas.some((b) => b.id === id))!.id;
}

export function abaInicial(area: AreaId, ctx: NavCtx): AbaId | null {
  return areasVisiveis(ctx).find((a) => a.id === area)?.abas[0]?.id ?? null;
}

export function corrigirAba(atual: AbaId, ctx: NavCtx): AbaId {
  if (abasVisiveis(ctx).has(atual)) return atual;
  return areasVisiveis(ctx)[0]?.abas[0]?.id ?? 'dashboard';
}

export interface Ajuste { id: string; titulo: string; descricao: string; secao: SecaoId; aba: AbaId; palavras: string[] }

export const AJUSTES: Ajuste[] = [
  { id: 'client_ordering', titulo: 'Clientes podem fazer pedido pelo celular', descricao: 'Liga ou desliga o pedido pelo QR da mesa; desligado, o cardápio vira só consulta.', secao: 'pedido_cliente', aba: 'settings', palavras: ['qr', 'cardapio', 'vitrine', 'cliente', 'pin'] },
  { id: 'pedido_pede_senha', titulo: 'Pedir a senha de quem lança o pedido', descricao: 'A cada pedido de mesa o garçom digita a própria senha e o pedido sai no nome dele.', secao: 'atendimento', aba: 'settings', palavras: ['garcom', 'login', 'operador'] },
  { id: 'taxa_servico', titulo: 'Cobrar taxa de serviço', descricao: 'Soma a taxa de serviço na conta das mesas.', secao: 'atendimento', aba: 'settings', palavras: ['10%', 'gorjeta', 'servico'] },
  { id: 'contagem_cega', titulo: 'Contagem cega no fechamento de caixa', descricao: 'O operador conta o dinheiro sem ver o valor esperado.', secao: 'regras', aba: 'regras_caixa', palavras: ['fechamento', 'turno', 'dinheiro'] },
  { id: 'mais_vendidos', titulo: 'Mostrar mais vendidos automaticamente no cardápio', descricao: 'Marca com um selo os produtos que mais saíram nos últimos 30 dias.', secao: 'pedido_cliente', aba: 'settings', palavras: ['destaque', 'popular', 'selo'] },
  { id: 'largura_papel', titulo: 'Largura do papel da impressora', descricao: 'Escolha 48, 58 ou 80 mm conforme a bobina.', secao: 'impressao', aba: 'settings', palavras: ['bobina', 'termica', 'comanda', 'mm'] },
  { id: 'avisos_tempo', titulo: 'Avisos de tempo na gestão de mesas', descricao: 'Minutos para a mesa ficar em alerta por demora ou sem pedido.', secao: 'atendimento', aba: 'settings', palavras: ['alerta', 'demora', 'minutos', 'mesa'] },
  { id: 'tolerancia_caixa', titulo: 'Tolerância no fechamento de caixa', descricao: 'Diferença acima do valor exige aprovação de um supervisor para fechar o turno.', secao: 'regras', aba: 'regras_caixa', palavras: ['diferenca', 'supervisor', 'quebra'] },
  { id: 'alerta_sangria', titulo: 'Alertar sangria acima de', descricao: 'Sangria igual ou maior que o valor gera um registro de auditoria.', secao: 'regras', aba: 'regras_caixa', palavras: ['retirada', 'auditoria', 'valor'] },
  { id: 'cor_destaque', titulo: 'Cor de destaque da tela de identificação', descricao: 'Cor da marca da loja na tela em que o cliente se identifica.', secao: 'aparencia', aba: 'settings', palavras: ['marca', 'azul', 'tema'] },
  { id: 'identidade_visual', titulo: 'Identidade visual do cardápio', descricao: 'Escolha o estilo do cardápio que o cliente vê.', secao: 'aparencia', aba: 'settings', palavras: ['tema', 'estilo', 'visual', 'preset'] },
  { id: 'observacoes_rapidas', titulo: 'Sugestões de observação rápida', descricao: 'Atalhos de texto para o cliente anotar no pedido (ex.: sem cebola).', secao: 'pedido_cliente', aba: 'settings', palavras: ['nota', 'observacao', 'atalho', 'chips'] },
  { id: 'capa_cardapio', titulo: 'Imagem de capa do cardápio', descricao: 'Foto do topo do cardápio do cliente (paisagem, ideal 1200x600).', secao: 'aparencia', aba: 'settings', palavras: ['foto', 'banner', 'hero'] },
  { id: 'baixar_app', titulo: 'Baixar o aplicativo', descricao: 'Instaladores do Norte Vendas para o computador e o celular.', secao: 'aplicativo', aba: 'settings', palavras: ['download', 'desktop', 'apk', 'instalar'] },
];

export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function buscarAjustes(q: string, lista: Ajuste[] = AJUSTES): Ajuste[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const pontuados = lista.map((a, i) => {
    const t = norm(a.titulo), p = a.palavras.map(norm).join(' '), d = norm(a.descricao);
    let score = 0;
    for (const tk of tokens) {
      const s = (t.includes(tk) ? 3 : 0) + (p.includes(tk) ? 2 : 0) + (d.includes(tk) ? 1 : 0);
      if (s === 0) return { a, score: 0, i };
      score += s;
    }
    return { a, score, i };
  });
  return pontuados.filter((x) => x.score > 0).sort((x, y) => y.score - x.score || x.i - y.i).map((x) => x.a);
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/adminNav.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/adminNav.ts scripts/testes/adminNav.test.ts
git commit -m "feat(admin): navegação da Administração em 5 áreas como dado puro, com busca de ajustes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 2: Status por cartão (`lib/adminStatus.ts`)

**Files:**
- Create: `lib/adminStatus.ts`, `scripts/testes/adminStatus.test.ts`

**Interfaces:**
- Produces: `type Tom = 'ok' | 'atencao' | 'erro' | 'neutro'`; `interface Status { texto: string; tom: Tom }`; `statusVendas(contasHoje: number | null)`, `statusCaixa(abertos: number | null)`, `statusCardapio(alertasAltos: number | null)`, `statusEquipe(pessoas: number | null)`, `statusConfig(impressoras: { is_active: boolean }[] | null, fiscal: Prontidao | null, ambiente: 'homologacao' | 'producao' | null)`; todas devolvem `Status | null` (null = ainda carregando/falhou, o cartão mostra só o título); `const TOM_COR: Record<Tom, string>` com `'var(--ok)' | 'var(--warn)' | 'var(--err)' | 'var(--text-muted)'`; `interface Prontidao { certificadoValido: boolean; cscHomologacao: boolean; cscProducao: boolean }`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/adminStatus.test.ts
import assert from 'node:assert/strict';
import { statusVendas, statusCaixa, statusCardapio, statusEquipe, statusConfig, TOM_COR } from '../../lib/adminStatus';

// Review Focus 6: carregando/falho = null, nunca "undefined"/"NaN"
assert.equal(statusVendas(null), null);
assert.equal(statusCaixa(null), null);
assert.equal(statusCardapio(null), null);
assert.equal(statusEquipe(null), null);
assert.equal(statusConfig(null, null, null), null);
assert.equal(statusVendas(Number.NaN), null);

assert.deepEqual(statusVendas(0), { texto: 'Sem vendas hoje', tom: 'neutro' });
assert.deepEqual(statusVendas(1), { texto: '1 conta hoje', tom: 'ok' });
assert.deepEqual(statusVendas(12), { texto: '12 contas hoje', tom: 'ok' });
assert.deepEqual(statusCaixa(0), { texto: 'Nenhum caixa aberto', tom: 'neutro' });
assert.deepEqual(statusCaixa(2), { texto: '2 caixas abertos', tom: 'ok' });
assert.deepEqual(statusCaixa(1), { texto: '1 caixa aberto', tom: 'ok' });
assert.deepEqual(statusCardapio(0), { texto: 'Cardápio em ordem', tom: 'ok' });
assert.deepEqual(statusCardapio(3), { texto: '3 alertas no cardápio', tom: 'atencao' });
assert.deepEqual(statusCardapio(1), { texto: '1 alerta no cardápio', tom: 'atencao' });
assert.deepEqual(statusEquipe(1), { texto: '1 pessoa', tom: 'neutro' });
assert.deepEqual(statusEquipe(5), { texto: '5 pessoas', tom: 'neutro' });

const ok = { certificadoValido: true, cscHomologacao: true, cscProducao: true };
// Configurações: impressora + fiscal numa frase só, tom pelo pior caso
assert.deepEqual(statusConfig([{ is_active: true }, { is_active: true }], ok, 'producao'), { texto: '2 impressoras ativas · Produção', tom: 'ok' });
assert.deepEqual(statusConfig([{ is_active: true }], ok, 'homologacao'), { texto: '1 impressora ativa · Homologação', tom: 'atencao' });
assert.deepEqual(statusConfig([], ok, 'producao'), { texto: 'Nenhuma impressora · Produção', tom: 'atencao' });
assert.deepEqual(statusConfig([{ is_active: false }], ok, 'producao'), { texto: 'Nenhuma impressora ativa · Produção', tom: 'atencao' });
assert.equal(statusConfig([{ is_active: true }], { ...ok, certificadoValido: false }, 'producao')!.tom, 'erro');
assert.equal(statusConfig([{ is_active: true }], { ...ok, cscProducao: false }, 'producao')!.tom, 'erro');
assert.equal(statusConfig([{ is_active: true }], null, null)!.texto, '1 impressora ativa');

// cores só por token
Object.values(TOM_COR).forEach((c) => assert.match(c, /^var\(--/));
console.log('adminStatus: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — módulo inexistente.

- [ ] **Step 3: Implementação**

```ts
// lib/adminStatus.ts — frase curta de estado de cada área (cartão do celular e trilho do computador).
export type Tom = 'ok' | 'atencao' | 'erro' | 'neutro';
export interface Status { texto: string; tom: Tom }
export interface Prontidao { certificadoValido: boolean; cscHomologacao: boolean; cscProducao: boolean }

export const TOM_COR: Record<Tom, string> = { ok: 'var(--ok)', atencao: 'var(--warn)', erro: 'var(--err)', neutro: 'var(--text-muted)' };

const valido = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export const statusVendas = (contasHoje: number | null): Status | null =>
  !valido(contasHoje) ? null : contasHoje === 0 ? { texto: 'Sem vendas hoje', tom: 'neutro' } : { texto: `${qtd(contasHoje, 'conta', 'contas')} hoje`, tom: 'ok' };

export const statusCaixa = (abertos: number | null): Status | null =>
  !valido(abertos) ? null : abertos === 0 ? { texto: 'Nenhum caixa aberto', tom: 'neutro' } : { texto: qtd(abertos, 'caixa aberto', 'caixas abertos'), tom: 'ok' };

export const statusCardapio = (alertasAltos: number | null): Status | null =>
  !valido(alertasAltos) ? null : alertasAltos === 0 ? { texto: 'Cardápio em ordem', tom: 'ok' } : { texto: `${qtd(alertasAltos, 'alerta', 'alertas')} no cardápio`, tom: 'atencao' };

export const statusEquipe = (pessoas: number | null): Status | null =>
  !valido(pessoas) ? null : { texto: qtd(pessoas, 'pessoa', 'pessoas'), tom: 'neutro' };

export function statusConfig(impressoras: { is_active: boolean }[] | null, fiscal: Prontidao | null, ambiente: 'homologacao' | 'producao' | null): Status | null {
  if (!impressoras && !fiscal) return null;
  const partes: string[] = [];
  let tom: Tom = 'ok';
  if (impressoras) {
    const ativas = impressoras.filter((i) => i.is_active).length;
    if (impressoras.length === 0) { partes.push('Nenhuma impressora'); tom = 'atencao'; }
    else if (ativas === 0) { partes.push('Nenhuma impressora ativa'); tom = 'atencao'; }
    else partes.push(qtd(ativas, 'impressora ativa', 'impressoras ativas'));
  }
  if (fiscal && ambiente) {
    partes.push(ambiente === 'producao' ? 'Produção' : 'Homologação');
    if (!fiscal.certificadoValido || (ambiente === 'producao' && !fiscal.cscProducao) || (ambiente === 'homologacao' && !fiscal.cscHomologacao)) tom = 'erro';
    else if (ambiente === 'homologacao' && tom === 'ok') tom = 'atencao';
  }
  return { texto: partes.join(' · '), tom };
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/adminStatus.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit** — `git add lib/adminStatus.ts scripts/testes/adminStatus.test.ts && git commit -m "feat(admin): frases de status por área com tom de cor por token" ` (+ as duas linhas de atribuição, como na Task 1).

---

### Task 3: Salvar na hora com Desfazer (`aplicarPatch` + contexto + `useSetting`)

**Files:**
- Create: `lib/configPatch.ts`, `scripts/testes/configPatch.test.ts`, `components/modules/settings/SettingsConfigContext.tsx`, `components/modules/settings/SettingRow.tsx`

**Interfaces:**
- Produces:
  - `aplicarPatch(config: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown>` — copia o config, aplica o patch e **remove** a chave cujo valor no patch é `undefined` (é como o "Desfazer" volta uma chave que não existia).
  - `SettingsConfigProvider` (props `{ store: Store; onStoreUpdate?: (s: Store) => void; children }`), `useSettingsConfig(): { config: StoreConfig | undefined; salvar(patch, rotulo, opts?: { semDesfazer?: boolean }): Promise<boolean> }`
  - `useSetting<T>(chave: string, padrao: T, rotulo: string): [valor: T, definir: (novo: T) => Promise<void>]`
  - `SettingRow` props `{ titulo: string; descricao: string; children: React.ReactNode; id?: string }`; `Switch` props `{ ligado: boolean; onChange(): void; rotulo: string }`; `NumberField` props `{ valor: number; onChange(n: number): void; prefixo?: string; rotulo: string }`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/configPatch.test.ts
import assert from 'node:assert/strict';
import { aplicarPatch } from '../../lib/configPatch';

assert.deepEqual(aplicarPatch(undefined, { a: 1 }), { a: 1 });                       // loja sem config salva (Review Focus 5)
assert.deepEqual(aplicarPatch({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
const orig = { a: 1 };
aplicarPatch(orig, { a: 2 });
assert.deepEqual(orig, { a: 1 }, 'não muta o original');
// desfazer de uma chave que não existia: undefined remove
assert.deepEqual(aplicarPatch({ a: 1, charge_service_fee: true }, { charge_service_fee: undefined }), { a: 1 });
assert.equal('charge_service_fee' in aplicarPatch({ charge_service_fee: true }, { charge_service_fee: undefined }), false);
// false é valor, não remoção (client_ordering=false precisa ficar gravado)
assert.deepEqual(aplicarPatch({}, { client_ordering: false }), { client_ordering: false });
// ida e volta
const antes = { x: 1 };
const depois = aplicarPatch(antes, { x: 2, y: 5 });
assert.deepEqual(aplicarPatch(depois, { x: antes.x, y: undefined }), antes);
console.log('configPatch: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — módulo inexistente.

- [ ] **Step 3: Implementação pura**

```ts
// lib/configPatch.ts
export function aplicarPatch(config: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(config ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/configPatch.test.ts`

- [ ] **Step 5: Contexto + hook** (mesmo padrão otimista dos handlers de StoreSettingsView.tsx:183–330, agora num lugar só)

```tsx
// components/modules/settings/SettingsConfigContext.tsx
'use client';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { updateStoreConfig } from '@/lib/api';
import { aplicarPatch } from '@/lib/configPatch';
import { toast } from '@/components/Toast';
import type { Store } from '@/types';

type Cfg = Record<string, unknown>;
interface Ctx { config: Cfg | undefined; salvar: (patch: Cfg, rotulo: string, opts?: { semDesfazer?: boolean }) => Promise<boolean> }
const SettingsCtx = createContext<Ctx | null>(null);

export const useSettingsConfig = (): Ctx => {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettingsConfig fora do SettingsConfigProvider');
  return c;
};

export const SettingsConfigProvider: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void; children: React.ReactNode }> = ({ store, onStoreUpdate, children }) => {
  const [config, setConfig] = useState<Cfg | undefined>(store.config as Cfg | undefined);
  const ref = useRef(config);
  ref.current = config;

  const salvar = useCallback<Ctx['salvar']>(async (patch, rotulo, opts) => {
    const anterior = ref.current;
    const novo = aplicarPatch(anterior, patch);
    try {
      await updateStoreConfig(store.id, novo as never);
      setConfig(novo);
      onStoreUpdate?.({ ...store, config: novo as never });
      if (!opts?.semDesfazer) {
        // volta só as chaves que este salvar tocou (chave que não existia volta a não existir)
        const volta: Cfg = {};
        Object.keys(patch).forEach((k) => { volta[k] = anterior ? (anterior as Cfg)[k] : undefined; });
        toast.undo(`${rotulo} atualizado.`, 'Desfazer', async () => { await salvar(volta, rotulo, { semDesfazer: true }); });
      }
      return true;
    } catch (e) {
      console.error('salvar configuração falhou:', rotulo, e);
      toast.error(`Erro ao atualizar ${rotulo.toLowerCase()}.`);
      return false;
    }
  }, [store, onStoreUpdate]);

  const value = useMemo(() => ({ config, salvar }), [config, salvar]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
};

export function useSetting<T>(chave: string, padrao: T, rotulo: string): [T, (novo: T) => Promise<void>] {
  const { config, salvar } = useSettingsConfig();
  const [otimista, setOtimista] = useState<{ v: T } | null>(null);
  const atual = ((config as Cfg | undefined)?.[chave] ?? padrao) as T;
  const valor = otimista ? otimista.v : atual;
  const definir = useCallback(async (novo: T) => {
    setOtimista({ v: novo });
    await salvar({ [chave]: novo }, rotulo);   // falhou: salvar já avisou, e voltamos ao valor salvo abaixo
    setOtimista(null);
  }, [chave, rotulo, salvar]);
  return [valor, definir];
}
```

- [ ] **Step 6: Linha de ajuste e controles** (mesmas classes de StoreSettingsView.tsx:440–452 e :464, agrupadas)

```tsx
// components/modules/settings/SettingRow.tsx
'use client';
import React from 'react';

export const SettingRow: React.FC<{ titulo: string; descricao: React.ReactNode; children: React.ReactNode; id?: string }> = ({ titulo, descricao, children, id }) => (
  <div id={id} className="flex items-center justify-between gap-4 p-4 bg-[var(--surface-2)] rounded-[14px] scroll-mt-24 max-sm:flex-col max-sm:items-stretch">
    <div className="min-w-0">
      <h4 className="font-semibold text-[15px] text-[var(--text)]">{titulo}</h4>
      <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{descricao}</p>
    </div>
    <div className="flex-shrink-0 max-sm:self-end">{children}</div>
  </div>
);

export const Switch: React.FC<{ ligado: boolean; onChange: () => void; rotulo: string }> = ({ ligado, onChange, rotulo }) => (
  <button
    type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 max-sm:min-h-11 max-sm:items-center ${ligado ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);

export const NumberField: React.FC<{ valor: number; onChange: (n: number) => void; prefixo?: string; rotulo: string }> = ({ valor, onChange, prefixo, rotulo }) => (
  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
    {prefixo}
    <input
      type="number" min={0} step={5} value={valor} aria-label={rotulo}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-20 h-9 max-sm:h-11 px-2 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] text-[15px] max-sm:text-base font-semibold num text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40"
    />
  </label>
);
```

Observação de comportamento: `NumberField` salva a cada tecla, como hoje (StoreSettingsView.tsx:588–596); o "Desfazer" fica por conta do último valor, e o toast anterior é substituído pelo novo (o `toast` já empilha um por vez).

- [ ] **Step 7: Verificar e commitar** — `npx tsc --noEmit`; `git add lib/configPatch.ts scripts/testes/configPatch.test.ts components/modules/settings && git commit -m "feat(config): salvar na hora com Desfazer num hook único (substitui 9 handlers repetidos)"` (+ atribuição).

---

### Task 4: Fatiar `StoreSettingsView` em seções (sem mudar o comportamento)

**Files:**
- Create: `components/modules/settings/SecaoAtendimento.tsx`, `SecaoPedidoCliente.tsx`, `SecaoAparencia.tsx`, `SecaoImpressao.tsx`, `SecaoAplicativo.tsx`, `components/modules/admin/RegrasCaixaView.tsx`
- Modify: `components/modules/StoreSettingsView.tsx` (771 linhas → casca)

**Interfaces:**
- Consumes: `SettingsConfigProvider`, `useSetting`, `SettingRow`, `Switch`, `NumberField` (Task 3).
- Produces: cada seção é `React.FC<{ store: Store }>` e traz um `<section id="sec-<SecaoId>">` com `<h3>` próprio; `RegrasCaixaView: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void }>` (cria o próprio `SettingsConfigProvider`).

Mapa do que vai para onde (linhas de `StoreSettingsView.tsx` antes da mudança):

| Origem | Destino | Chave de config (não muda) |
|---|---|---|
| capa do cardápio (:397–:430), cor de destaque (:630), identidade visual (:672) | `SecaoAparencia` | `cover_url` (coluna própria), `accent_color`, `theme_preset` |
| cliente pede pelo celular (:433), mais vendidos (:507), observações rápidas (:699) | `SecaoPedidoCliente` | `client_ordering` (padrão `true`), `show_bestsellers`, `note_suggestions` |
| senha de quem lança (:457), taxa de serviço (:477), avisos de tempo (:548) | `SecaoAtendimento` | `pedido_pede_senha`, `charge_service_fee`, `table_alert_occupied_minutes`/`table_alert_no_order_minutes` |
| largura do papel (:527) | `SecaoImpressao` | `printer_paper_width_mm` |
| baixar o aplicativo (:743) | `SecaoAplicativo` | — |
| contagem cega (:492), tolerância (:583), sangria (:604) | `RegrasCaixaView` | `cash_shift_blind_count`, `cash_shift_max_tolerance`, `sangria_alert_threshold` |

(Conferir cada chave no handler correspondente de StoreSettingsView.tsx:183–330 antes de mover; a lista acima vem dos nomes dos handlers.)

- [ ] **Step 1: Registrar o comportamento atual** — antes de mexer, em loja de teste (ZZ Laboratório), tirar capturas de Administração → Configurações (computador, tema claro) e anotar o valor de cada ajuste. É a referência do "nada muda".

- [ ] **Step 2: Mover `SecaoAtendimento`** (exemplo completo; as outras seguem o mesmo molde)

```tsx
// components/modules/settings/SecaoAtendimento.tsx
'use client';
import React from 'react';
import { useSetting } from './SettingsConfigContext';
import { SettingRow, Switch } from './SettingRow';
import { formatServiceFeeRate } from '@/lib/calc';
import { SERVICE_FEE_RATE } from '@/lib/calc';
import type { Store } from '@/types';

export const SecaoAtendimento: React.FC<{ store: Store }> = ({ store }) => {
  const [pedeSenha, setPedeSenha] = useSetting<boolean>('pedido_pede_senha', false, 'Pedir senha de quem lança');
  const [taxa, setTaxa] = useSetting<boolean>('charge_service_fee', false, 'Taxa de serviço');
  return (
    <section id="sec-atendimento" className="space-y-3 scroll-mt-24">
      <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Atendimento</h3>
      <SettingRow
        id="aj-pedido_pede_senha"
        titulo="Pedir a senha de quem lança o pedido"
        descricao={pedeSenha ? 'Ligado: a cada pedido de mesa, o garçom digita a própria senha e o pedido sai no nome dele, mesmo se o aparelho estiver logado com outra pessoa.' : 'Desligado: o pedido sai no nome de quem está logado no aparelho.'}
      >
        <Switch ligado={pedeSenha} onChange={() => setPedeSenha(!pedeSenha)} rotulo="Pedir a senha de quem lança o pedido" />
      </SettingRow>
      <SettingRow id="aj-taxa_servico" titulo={`Cobrar taxa de serviço (${formatServiceFeeRate(store.config?.service_fee_rate ?? SERVICE_FEE_RATE)})`} descricao={/* texto atual de StoreSettingsView.tsx:477–489, copiado literal */ 'Soma a taxa de serviço na conta das mesas.'}>
        <Switch ligado={taxa} onChange={() => setTaxa(!taxa)} rotulo="Cobrar taxa de serviço" />
      </SettingRow>
      {/* avisos de tempo: dois NumberField (occupied / no_order), movidos de :548–:581 com o mesmo texto e os mesmos limites */}
    </section>
  );
};
```

Regra do movimento: **copiar os textos literais** de descrição de `StoreSettingsView.tsx` para a `SettingRow` (o exemplo acima abrevia só a taxa de serviço; no arquivo real, usar o texto integral de :477–:489) e manter `aria-label`. O `id="aj-<ajuste>"` casa com `AJUSTES[].id` do Task 1 (é o alvo do "ir para o ajuste" da Task 6).

- [ ] **Step 3: Mover as demais seções** — `SecaoPedidoCliente`, `SecaoAparencia` (capa e cor de destaque mantêm seus próprios botões "Salvar capa"/"Salvar cor": não são ajustes de salvar na hora, têm trava própria em :97 e :164), `SecaoImpressao`, `SecaoAplicativo`, e `RegrasCaixaView` (envolvido em `SettingsConfigProvider`, com `<section id="sec-regras">`). Cada ajuste ganha `id="aj-<id do AJUSTES>"`.

- [ ] **Step 4: A casca nova de `StoreSettingsView.tsx`**

```tsx
// components/modules/StoreSettingsView.tsx (depois)
'use client';
import React from 'react';
import type { Store } from '@/types';
import { SettingsConfigProvider } from './settings/SettingsConfigContext';
import { SecaoAtendimento } from './settings/SecaoAtendimento';
import { SecaoPedidoCliente } from './settings/SecaoPedidoCliente';
import { SecaoAparencia } from './settings/SecaoAparencia';
import { SecaoImpressao } from './settings/SecaoImpressao';
import { SecaoAplicativo } from './settings/SecaoAplicativo';

export const SETTINGS_SECOES = [
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'pedido_cliente', label: 'Pedido do cliente' },
  { id: 'impressao', label: 'Impressão' },
  { id: 'aparencia', label: 'Aparência do cardápio' },
  { id: 'aplicativo', label: 'Aplicativo' },
] as const;

const StoreSettingsView: React.FC<{ store: Store; onStoreUpdate?: (store: Store) => void; secaoAlvo?: string | null }> = ({ store, onStoreUpdate }) => (
  <SettingsConfigProvider store={store} onStoreUpdate={onStoreUpdate}>
    <div className="lg:grid lg:grid-cols-[180px_1fr] lg:gap-8">
      <nav aria-label="Seções de configurações" className="max-lg:hidden sticky top-4 self-start space-y-1">
        {SETTINGS_SECOES.map((s) => (
          <a key={s.id} href={`#sec-${s.id}`} className="block px-3 h-9 leading-9 rounded-[10px] text-[15px] text-[var(--text)] hover:bg-[var(--surface-2)]">{s.label}</a>
        ))}
      </nav>
      <div className="space-y-8 min-w-0">
        <SecaoAtendimento store={store} />
        <SecaoPedidoCliente store={store} />
        <SecaoImpressao store={store} />
        <SecaoAparencia store={store} onStoreUpdate={onStoreUpdate} />
        <SecaoAplicativo />
      </div>
    </div>
  </SettingsConfigProvider>
);
export default StoreSettingsView;
```

- [ ] **Step 5: Conferir que nada mudou** — `npx tsc --noEmit` limpo; abrir a mesma loja de teste e comparar, ajuste por ajuste, com as capturas do Step 1 (mesmo valor inicial, mesmo texto). Alternar cada interruptor/numero uma vez e conferir em `stores.config` (REST com service key da loja de teste) que a **mesma chave** mudou para o **mesmo valor** de antes.

- [ ] **Step 6: Commit** — `git add components/modules && git commit -m "refactor(config): Configurações em seções por arquivo; regras do caixa saem para a área Caixa"` (+ atribuição).

---

### Task 5: Casca de navegação (`AdminNavShell`) no computador

**Files:**
- Create: `components/modules/admin/AdminNavShell.tsx`
- Modify: `components/modules/StoreModule.tsx` — `StoreAdminView` (:11073): estado `activeTab` (:11353) e o bloco do menu (:11749–:11850)

**Interfaces:**
- Consumes: `areasVisiveis`, `areaDaAba`, `abaInicial`, `corrigirAba`, `type AbaId`, `type AreaId`, `type NavCtx` (Task 1); `type Status`, `TOM_COR` (Task 2).
- Produces: `AdminNavShell` props `{ ctx: NavCtx; activeTab: AbaId; onTab(id: AbaId): void; status: Partial<Record<AreaId, Status | null>>; children: React.ReactNode }`.

- [ ] **Step 1: Trocar o tipo de `activeTab`** em StoreModule.tsx:11353 por `useState<AbaId>('dashboard')` (importar `AbaId` de `@/lib/adminNav`). Os ids antigos são um subconjunto; `tsc` aponta o que sobrar.

- [ ] **Step 2: Componente do computador** (trilho de áreas + sub-abas; no celular a Task 7 troca a casca)

```tsx
// components/modules/admin/AdminNavShell.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Wallet, UtensilsCrossed, Users, SlidersHorizontal, Lock, Search } from 'lucide-react';
import { areasVisiveis, areaDaAba, abaInicial, corrigirAba, buscarAjustes, type AbaId, type AreaId, type NavCtx } from '@/lib/adminNav';
import { TOM_COR, type Status } from '@/lib/adminStatus';

const ICONE: Record<AreaId, React.ReactNode> = {
  vendas: <BarChart3 size={18} />, caixa: <Wallet size={18} />, cardapio: <UtensilsCrossed size={18} />, equipe: <Users size={18} />, config: <SlidersHorizontal size={18} />,
};

interface Props { ctx: NavCtx; activeTab: AbaId; onTab: (id: AbaId, secaoAlvo?: string) => void; status: Partial<Record<AreaId, Status | null>>; children: React.ReactNode }

export const AdminNavShell: React.FC<Props> = ({ ctx, activeTab, onTab, status, children }) => {
  const areas = areasVisiveis(ctx);
  // Review Focus 1: se a aba ativa deixou de ser permitida, cai na primeira visível.
  const corrigida = corrigirAba(activeTab, ctx);
  useEffect(() => { if (corrigida !== activeTab) onTab(corrigida); }, [corrigida, activeTab, onTab]);

  const areaAtiva = areaDaAba(corrigida);
  const abas = areas.find((a) => a.id === areaAtiva)?.abas ?? [];
  const [q, setQ] = useState('');
  const achados = buscarAjustes(q).slice(0, 6);

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <nav aria-label="Administração" className="w-full md:w-60 flex-shrink-0 space-y-3 max-md:hidden">
        <label className="relative block">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ajuste…" aria-label="Buscar ajuste"
            className="w-full h-10 pl-9 pr-3 rounded-[12px] bg-[var(--surface)] text-[15px] text-[var(--text)] shadow-[var(--shadow-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40" />
        </label>
        {q.trim() && (
          <ul className="bg-[var(--surface)] rounded-[14px] shadow-[var(--shadow-sm)] p-1">
            {achados.length === 0 && <li className="px-3 py-2 text-[13px] text-[var(--text-muted)]">Nenhum ajuste encontrado.</li>}
            {achados.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => { setQ(''); onTab(a.aba, `aj-${a.id}`); }} className="w-full text-left px-3 py-2 rounded-[10px] hover:bg-[var(--surface-2)]">
                  <span className="block text-[15px] text-[var(--text)]">{a.titulo}</span>
                  <span className="block text-[12px] text-[var(--text-muted)]">{areas.find((x) => x.abas.some((b) => b.id === a.aba))?.label} › {a.secao}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="bg-[var(--surface)] rounded-[14px] shadow-[var(--shadow-sm)] p-1 space-y-0.5">
          {areas.map((a) => {
            const ativa = a.id === areaAtiva;
            const st = status[a.id];
            return (
              <button key={a.id} type="button" aria-current={ativa ? 'page' : undefined} onClick={() => onTab(abaInicial(a.id, ctx) ?? corrigida)}
                className={`relative isolate w-full text-left px-3 py-2 rounded-[10px] u-motion u-press-sm flex items-start gap-2.5 ${ativa ? 'text-[var(--brand)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
                {ativa && <motion.div layoutId="admin-area-ativa" className="absolute inset-0 rounded-[10px] bg-[var(--brand-soft)] -z-10" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                <span className="mt-0.5">{ICONE[a.id]}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{a.label}</span>
                  <span className="block text-[12px] truncate" style={{ color: st ? TOM_COR[st.tom] : 'var(--text-muted)' }}>{st ? st.texto : a.descricao}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-w-0">
        {abas.length > 1 && (
          <div role="tablist" aria-label={areas.find((a) => a.id === areaAtiva)?.label} className="mb-5 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {abas.map((b) => (
              <button key={b.id} role="tab" aria-selected={b.id === corrigida} onClick={() => onTab(b.id)}
                className={`shrink-0 h-9 px-4 rounded-full text-[15px] font-medium flex items-center gap-1.5 u-motion ${b.id === corrigida ? 'bg-[var(--brand-fill)] text-white font-semibold' : 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]'}`}>
                {b.sensitive && <Lock size={12} />}{b.label}
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Ligar em `StoreAdminView`** — remover `ADMIN_NAV_GROUPS` e os dois blocos de `nav` (:11755–:11840) e envolver o `<AnimatePresence>…{tabs}…</AnimatePresence>` existente em:

```tsx
const ctx: NavCtx = { user: loggedUser, podeVerExcecoes: podeVerCaixasDaEquipe(loggedUser) };
const [secaoAlvo, setSecaoAlvo] = useState<string | null>(null);
const irPara = useCallback((id: AbaId, alvo?: string) => { setActiveTab(id); setSecaoAlvo(alvo ?? null); }, []);
// ...
<AdminNavShell ctx={ctx} activeTab={activeTab} onTab={irPara} status={status}>
  {/* AnimatePresence + motion.div key={activeTab} + todos os {activeTab === '…' && …} existentes, intocados */}
</AdminNavShell>
```

E `onNavigateToOperatorHistory={() => { irPara('sales'); setHistoryView('operator'); }}` (:11869). `status` fica `{}` por enquanto (Task 8 preenche).

- [ ] **Step 4: Rolagem até o ajuste achado na busca** — efeito em `StoreAdminView`:

```tsx
useEffect(() => {
  if (!secaoAlvo) return;
  const t = setTimeout(() => {
    const el = document.getElementById(secaoAlvo);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('ring-2', 'ring-[var(--brand)]/50');
    setTimeout(() => el?.classList.remove('ring-2', 'ring-[var(--brand)]/50'), 1800);
    setSecaoAlvo(null);
  }, 200); // espera o crossfade de 120 ms da troca de aba (:11850)
  return () => clearTimeout(t);
}, [secaoAlvo, activeTab]);
```

- [ ] **Step 5: Verificar** — `npx tsc --noEmit`; em loja de teste, computador, tema claro: as 5 áreas aparecem, cada sub-aba abre a tela de antes (Resumo = dashboard, Histórico = sales, etc.), `Exceções` some para um usuário sem a permissão, "Buscar ajuste" com "tolerância" leva a Caixa › Regras do caixa e destaca a linha.

- [ ] **Step 6: Commit** — `git add components/modules/admin components/modules/StoreModule.tsx && git commit -m "feat(admin): menu em 5 áreas com sub-abas e busca de ajustes"` (+ atribuição).

---

### Task 6: Regras do caixa e novas abas ligadas

**Files:**
- Modify: `components/modules/StoreModule.tsx` (área de render das abas, :11863–:12252)

**Interfaces:**
- Consumes: `RegrasCaixaView` (Task 4), `AbaId` com `regras_caixa` (Task 1).

- [ ] **Step 1: Render da aba nova**, junto das demais (:12247–:12252):

```tsx
{activeTab === 'regras_caixa' && <RegrasCaixaView store={store} onStoreUpdate={onStoreUpdate} />}
```

- [ ] **Step 2: Conferir o efeito de `shifts`** (:11444): continua dependendo só de `activeTab === 'shifts'`; "Regras do caixa" não carrega turnos, não precisa.

- [ ] **Step 3: Verificar** — loja de teste: Caixa › Regras do caixa mostra contagem cega, tolerância e alerta de sangria com os mesmos valores de antes; alterar a tolerância para 5 e conferir `stores.config.cash_shift_max_tolerance`; tocar em Desfazer volta ao valor anterior; fechar um turno de teste respeita a tolerância (a regra é lida de `store.config`, já atualizada por `onStoreUpdate`).

- [ ] **Step 4: Commit** — `git commit -am "feat(admin): Regras do caixa como aba da área Caixa"` (+ atribuição).

---

### Task 7: Celular — lista de cartões com entrada e volta

**Files:**
- Modify: `components/modules/admin/AdminNavShell.tsx`

**Interfaces:**
- Produces: dentro de `AdminNavShell`, no breakpoint `max-md`: tela "home" (cartões das áreas) e tela de área (cabeçalho com voltar + lista de abas ou o conteúdo, quando a área tem uma aba só). Estado local `mobileArea: AreaId | null` (`null` = home).

- [ ] **Step 1: Estado e regras**

```tsx
const [mobileArea, setMobileArea] = useState<AreaId | null>(null);
// sincronia: se a aba ativa mudou por fora (ex.: onNavigateToOperatorHistory), entra na área dela
useEffect(() => { setMobileArea((m) => (m === null ? m : areaDaAba(corrigida))); }, [corrigida]);
```

- [ ] **Step 2: Home em cartões** — `md:hidden`, grade de uma coluna, cada cartão com ícone, nome, status (cor por token, mesma fonte da Task 2) e seta; alvo mínimo 56 px.

```tsx
<div className="md:hidden">
  {mobileArea === null ? (
    <ul className="space-y-3">
      {areas.map((a) => {
        const st = status[a.id];
        return (
          <li key={a.id}>
            <button type="button" onClick={() => { const unica = a.abas.length === 1; setMobileArea(a.id); onTab(unica ? a.abas[0].id : abaInicial(a.id, ctx)!); }}
              className="w-full min-h-14 px-4 py-3 rounded-[16px] bg-[var(--surface)] shadow-[var(--shadow-sm)] flex items-center gap-3 text-left u-press">
              <span className="text-[var(--brand)]">{ICONE[a.id]}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[17px] font-semibold text-[var(--text)]">{a.label}</span>
                <span className="block text-[13px] truncate" style={{ color: st ? TOM_COR[st.tom] : 'var(--text-muted)' }}>{st ? st.texto : a.descricao}</span>
              </span>
              <ChevronRight size={18} className="text-[var(--text-muted)]" />
            </button>
          </li>
        );
      })}
    </ul>
  ) : (
    <div>
      <button type="button" onClick={() => setMobileArea(null)} className="mb-3 min-h-11 -ml-1 px-1 flex items-center gap-1 text-[15px] font-medium text-[var(--brand)]">
        <ChevronLeft size={18} /> Administração
      </button>
      <h2 className="text-[22px] font-semibold text-[var(--text)] mb-3">{areas.find((a) => a.id === mobileArea)?.label}</h2>
      {abas.length > 1 && (
        <div role="tablist" className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {abas.map((b) => (
            <button key={b.id} role="tab" aria-selected={b.id === corrigida} onClick={() => onTab(b.id)}
              className={`shrink-0 min-h-11 px-4 rounded-full text-[15px] font-medium flex items-center gap-1.5 ${b.id === corrigida ? 'bg-[var(--brand-fill)] text-white font-semibold' : 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]'}`}>
              {b.sensitive && <Lock size={12} />}{b.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  )}
</div>
```

**Transição home ↔ área (curta, reaproveitando o que existe):** envolver a home e a tela de área num `AnimatePresence mode="wait"` com `initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12, ease: 'easeOut' }}` — exatamente a mesma receita do crossfade de :11843–:11850 (não criar variante nova). Cartões da home usam `u-press` no toque, como os botões do menu de hoje. Com `prefers-reduced-motion`, sem deslocamento (só `opacity`).

O `children` do desktop (`flex-1`) e o do celular são o **mesmo** nó (não duplicar o conteúdo): renderizar `children` uma única vez, escolhendo o contêiner por classe (`md:block` / `max-md:hidden` quando `mobileArea === null`), para as abas pesadas (Histórico, Fiscal) não montarem duas vezes.

- [ ] **Step 3: Verificar** — emular 390×844 (chrome-devtools `emulate viewport "390x844x3,mobile,touch"`): home mostra 5 cartões; tocar em "Caixa" abre Turnos com as pílulas Turnos/Regras; "Voltar" volta à home; área de aba única (nenhuma hoje com permissão total, mas `Equipe` para um usuário sem `permissoes`) abre direto o conteúdo; nenhum alvo de toque abaixo de 44 px (`scripts/auditoria/medir-alvos.js`, Task do plano `2026-10-04-alvos-de-toque-44px.md`); sem rolagem horizontal na página.

- [ ] **Step 4: Commit** — `git commit -am "feat(admin): no celular, Administração vira lista de cartões com entrada e volta"` (+ atribuição).

---

### Task 8: Status reais nos cartões (`useAdminStatus`)

**Files:**
- Create: `components/modules/admin/useAdminStatus.ts`
- Modify: `components/modules/StoreModule.tsx` (`StoreAdminView`: troca `status = {}`)

**Interfaces:**
- Consumes: `fetchPrinterConfigs(storeId)` (lib/api.ts:2802), `fetchOpenCashShifts(storeId)` (lib/api.ts, usado por StoreDashboardView), `sales` e `prontidao` já existentes em `StoreAdminView` (:11353–:11441), e o wrapper de usuários da loja usado por `UserManagementView` (descobrir com `grep -n "fetch_all_store_users_secure" lib/api.ts`); funções da Task 2.
- Produces: `useAdminStatus(args): Partial<Record<AreaId, Status | null>>`

- [ ] **Step 1: Implementação** (cada fonte falha sozinha: o cartão daquela área mostra só o título)

```ts
// components/modules/admin/useAdminStatus.ts
import { useEffect, useState } from 'react';
import { fetchPrinterConfigs, fetchOpenCashShifts } from '@/lib/api';
import { statusVendas, statusCaixa, statusConfig, statusEquipe, statusCardapio, type Status, type Prontidao } from '@/lib/adminStatus';
import type { AreaId } from '@/lib/adminNav';

interface Args {
  storeId: string;
  contasHoje: number | null;
  prontidao: Prontidao | null;
  ambiente: 'homologacao' | 'producao' | null;
  pessoas: number | null;
  alertasCardapio: number | null;   // preenchido pela auditoria (plano de permissões, Task 2); null = sem status
}

export function useAdminStatus(a: Args): Partial<Record<AreaId, Status | null>> {
  const [impressoras, setImpressoras] = useState<{ is_active: boolean }[] | null>(null);
  const [abertos, setAbertos] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    fetchPrinterConfigs(a.storeId).then((l) => vivo && setImpressoras(l)).catch(() => {});
    fetchOpenCashShifts(a.storeId).then((l) => vivo && setAbertos(l.length)).catch(() => {});
    return () => { vivo = false; };
  }, [a.storeId]);
  return {
    vendas: statusVendas(a.contasHoje),
    caixa: statusCaixa(abertos),
    cardapio: statusCardapio(a.alertasCardapio),
    equipe: statusEquipe(a.pessoas),
    config: statusConfig(impressoras, a.prontidao, a.ambiente),
  };
}
```

- [ ] **Step 2: `contasHoje`** — contar contas do dia a partir de `sales` (já carregado em `StoreAdminView` quando a aba `dashboard` abre, :11418): usar o agrupamento existente de contas (mesma regra de `groupSales`: uma conta = mesa + mesmo pagamento) e fuso `America/Bahia` (`localDayAndMinutes` de lib/priceSchedule.ts). Enquanto `sales` não chegou, `null`.

- [ ] **Step 3: Verificar** — loja de teste: o cartão Caixa mostra "1 caixa aberto" depois de abrir um turno de teste e "Nenhum caixa aberto" depois de fechar; Configurações mostra "N impressoras ativas · Homologação" na ZZ; derrubar a rede (emulação Offline) não gera texto quebrado nos cartões.

- [ ] **Step 4: Commit** — `git add components/modules && git commit -m "feat(admin): status resumido nos cartões das áreas"` (+ atribuição).

---

### Task 9: Ligar Equipe › Permissões e Cardápio › Saúde (depende do plano `2026-10-04-mesa-cardapio-permissoes.md`)

**Files:**
- Modify: `lib/adminNav.ts` (esvaziar `ABAS_EM_BREVE`), `components/modules/StoreModule.tsx`, `components/modules/admin/useAdminStatus.ts`
- Consumes (já existentes depois daquele plano): `RolePermissionsView` e `roleCan` (Task 3 dele), `auditarCardapio` (Task 2 dele).

**Interfaces:**
- Produces: `NavCtx.can` preenchido com `roleCan`.

- [ ] **Step 1: Pré-condição** — conferir que `lib/rolePermissions.ts` e `lib/cardapioIntegridade.ts` existem (`ls lib | grep -E "rolePermissions|cardapioIntegridade"`). Se não, **parar** e executar antes as Tasks 2 e 3 daquele plano.

- [ ] **Step 2: `can` da navegação**

```tsx
const ctx: NavCtx = {
  user: loggedUser,
  podeVerExcecoes: roleCan(loggedUser, store, 'ver_excecoes'),
  can: (acao) =>
    acao === 'editar_cardapio' ? roleCan(loggedUser, store, 'editar_cardapio')
    : acao === 'editar_precos_horario' ? roleCan(loggedUser, store, 'editar_precos_horario')
    : loggedUser.role === 'owner' || loggedUser.role === 'universal' || loggedUser.role === 'manager',   // 'ver_permissoes': gerente vê (só leitura), dono edita
};
```

(`podeVerCaixasDaEquipe` continua valendo para o resto do app; aqui a aba Exceções passa a obedecer também à matriz. Padrão do plano de permissões já reproduz o comportamento de hoje.)

- [ ] **Step 3: Renderizar as telas** junto das demais abas:

```tsx
{activeTab === 'permissoes' && <RolePermissionsView store={store} loggedUser={loggedUser} onStoreUpdate={onStoreUpdate} />}
{activeTab === 'saude' && <CardapioSaudeView storeId={storeId} />}
```

`CardapioSaudeView` (novo, `components/modules/admin/CardapioSaudeView.tsx`): busca categorias/produtos com `fetchMenu(storeId, false, true)`, roda `auditarCardapio`, lista os achados por severidade (alta com `var(--err)`, média `var(--warn)`, baixa `var(--text-muted)`) e a ação "Abrir no cardápio" que navega para a aba Cardápio do painel principal. Estado vazio: "Tudo certo: nenhum problema encontrado."

- [ ] **Step 4: Esvaziar o "em breve"** — em `lib/adminNav.ts`: `export const ABAS_EM_BREVE = new Set<AbaId>();`. Em `adminNav.test.ts`, remover a linha `semEmBreve();` e a chamada (o teste "em breve esconde sem quebrar" passa a usar `.add` e `.clear()` como já faz). Rodar `npx tsx scripts/testes/adminNav.test.ts`.

- [ ] **Step 5: Status do cardápio** — passar `alertasCardapio` = quantidade de achados de severidade `alta` ao `useAdminStatus` (calculada uma vez ao abrir Administração, com `fetchMenu`; falha = `null`).

- [ ] **Step 6: Verificar e commitar** — `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`; em loja de teste: gerente vê Permissões em leitura, dono edita; garçom não vê Cardápio › Saúde nem Preço por horário (matriz padrão). `git commit -am "feat(admin): Permissões na Equipe e Saúde do cardápio, ligadas à matriz por função"` (+ atribuição).

---

### Task 10: Design pass, tema e QA completo

**Files:**
- Modify (conforme achados): `components/modules/admin/*`, `components/modules/settings/*`, e as views existentes quando o achado for delas (ReportsView, StoreDashboardView, CouponManagementView, PriceSchedulesView, PrinterSettingsView, MeuLinkView, UserManagementView, FiscalNotasView em StoreModule.tsx)

Escopo do pass: **ajuste fino dentro da identidade atual**, não redesenho. Nada de nova paleta, fonte, raio ou componente de base; só corrigir o que destoa dos tokens e de `components/ui.tsx`.

Princípios (cada um vira item de verificação, não opinião):
1. **Um botão principal por tela.** `Button` primário (azul cheio) no máximo um por aba; o resto `variant="secondary"`. Auditar: `grep -n "<Button" components/modules/{ReportsView,CouponManagementView,PriceSchedulesView,PrinterSettingsView,MeuLinkView}.tsx` e, em StoreModule.tsx, dentro das abas `shifts`, `fiscal`, `sales`.
2. **Hierarquia.** Título da área `text-[22px]` no celular / `text-[17px]` nos cartões de seção; descrição `text-[13px] var(--text-muted)`; dado importante `num font-semibold`. Nenhum bloco com tudo no mesmo peso.
3. **Cores de status com um significado só.** verde `var(--ok)` = em ordem/ligado, laranja `var(--warn)` = atenção, vermelho `var(--err)` = problema/bloqueia, cinza `var(--text-muted)` = neutro. Trocar qualquer verde/laranja/vermelho fixo das abas por esses tokens (`grep -nE "#[0-9a-fA-F]{6}|bg-(red|green|amber|yellow)-" components/modules/{admin,settings}`: deve voltar vazio).
4. **Tema coerente.** Nenhum componente novo usa `on-glass`, `u-glass-modal` ou cor fixa; janelas abertas a partir das abas (confirmação, reimpressão, motivo) seguem o plano de tema (sólidas). Conferir em claro e escuro.
5. **Celular.** Alvo ≥ 44 px, sem rolagem horizontal da página, rótulos não cortados (nomes longos quebram linha), linhas de ajuste empilham (`max-sm:flex-col`, já em `SettingRow`).

- [ ] **Step 1: Auditoria automática** — rodar `node scripts/auditoria/medir-alvos.js` no navegador de QA (celular emulado) em cada área e anotar o que ficou abaixo de 44 px; corrigir.

- [ ] **Step 2: QA ao vivo em loja de teste** (ZZ Laboratório; repetir um fluxo em Donana). Criar um usuário QA temporário com cada função (gerente, caixa, garçom) e apagar no fim.

| Cenário | Esperado |
|---|---|
| Computador, tema claro e escuro, as 5 áreas e todas as sub-abas | abre a tela de antes, sem texto ilegível, sem janela escura sobre tela clara |
| Busca "papel", "tolerância", "senha" | leva ao ajuste certo e o destaca |
| Interruptor de taxa de serviço: ligar, Desfazer | valor volta; `stores.config` confere |
| Derrubar a rede e mexer num ajuste | erro visível, interruptor volta ao valor salvo |
| Garçom | só vê o que a matriz permite; área sem aba some |
| Celular 390×844 | home em cartões, entra, volta, pílulas por área, sem rolagem horizontal |
| Deep link interno (Resumo → "ver histórico por operador") | cai em Vendas › Histórico, visão por operador |
| Loja nunca configurada | todos os ajustes com o padrão de hoje |
| **Continuidade visual** (computador e celular, claro e escuro): capturas lado a lado com as de antes | mesma sidebar azul, mesmos cartões/pílulas/botões/tokens; o menu novo parece o de hoje reorganizado, sem estilo novo |
| **Animação**: trocar de aba, de área, entrar/voltar no celular | crossfade de 120 ms e indicador por `layoutId` iguais aos de hoje; sem mola nova, sem tranco, sem tela piscando; com "reduzir movimento" ligado, só troca de opacidade |
| Medir tempo de transição (DevTools, Performance) numa troca de aba e numa entrada de área | ≤ 160 ms, sem layout shift ao entrar (altura do cabeçalho de sub-abas não pula) |

- [ ] **Step 3: Capturas** — enviar ao dono captura de cada área (computador claro/escuro + celular) **antes** do deploy.

- [ ] **Step 4: Suíte completa** — `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`

- [ ] **Step 5: Deploy** — só com a loja fechada, `deploy.sh` manual no Contabo (sem migration); depois do deploy, abrir Administração numa loja de teste em produção e repetir o fluxo de busca e o de Desfazer. Nunca testar no Sertão.

- [ ] **Step 6: Commit final do pass** — `git commit -am "polish(admin): hierarquia, cores de status por token, alvos de 44px e tema coerente"` (+ atribuição).

---

## Self-review

- **Cobertura do pedido:** 5 áreas com sub-abas (Task 1, 5), busca de ajustes e índice lateral (Task 1, 4, 5), linha título+explicação+controle e salvar na hora com Desfazer (Task 3, 4), status resumido por cartão (Task 2, 8), celular em cartões com entrada e volta (Task 7), esconder o que a função não pode usar (Task 1, 9), `setActiveTab` e dependências preservados (Task 5), fatiar `StoreSettingsView` (Task 4), design pass e tema (Task 10), QA em loja de teste nos dois temas e no celular (Task 10).
- **Nada muda de comportamento:** ids de aba e efeitos intactos; chaves de `stores.config` conferidas ajuste a ajuste na Task 4, Step 5. A única mudança funcional declarada é a nova: Desfazer depois de salvar um ajuste (pedido do dono).
- **Dependências entre planos:** Tasks 1–8 não dependem de nada (as abas `saude`/`permissoes` ficam escondidas por `ABAS_EM_BREVE`); Task 9 exige as Tasks 2 e 3 do plano de permissões; Task 10 segue o plano de tema.
- **Tipos:** `AbaId`, `AreaId`, `NavCtx`, `Status`, `Tom`, `useSetting`, `SettingsConfigProvider` usados com os mesmos nomes em todas as tasks.
- **Review Focus:** 1, 2, 3 testados na Task 1; 4 e 5 na Task 3 (+ QA offline na 10); 6 na Task 2.
