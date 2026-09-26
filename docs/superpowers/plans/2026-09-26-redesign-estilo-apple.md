# Redesign "estilo Apple" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao NTB Vendas inteiro (painel, entrada, cardápio do cliente, Master Admin) a linguagem visual de app Apple, sem mudar funcionalidade.

**Architecture:** A maior parte do efeito vem da fundação compartilhada (tokens CSS em `app/globals.css`, fonte em `app/layout.tsx`, componentes de `components/ui.tsx`, casca `StoreLayout` em `StoreModule.tsx`). Depois, passes por tela trocam classes pontuais (cores cruas, CAIXA ALTA, bordas tracejadas, tempo em minutos). Sem framework de teste: verificação = `npx tsc --noEmit` + build + prints Playwright antes/depois.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (tokens via CSS vars, tema escuro por classe `.dark` — nunca `dark:`), motion/react, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-26-redesign-estilo-apple-design.md`

## Global Constraints
- Nenhuma mudança de comportamento, dado, rota ou texto funcional (só aparência; exceção: rótulos em CAIXA ALTA viram frase normal).
- Cores sempre por token (`var(--...)`), nunca hex solto em componente (exceção: `AuthBackdrop`/landing, que já têm hex de marca).
- Tema escuro só via tokens em `.dark` (nunca utilitário `dark:`).
- Celular: nada abaixo de 44px de toque que antes tinha 44px; inputs ≥16px no celular (`max-sm:text-base` continua).
- Fonte: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. Números: `font-variant-numeric: tabular-nums`, sem fonte monoespaçada.
- Monoespaçada (`font-mono`) só em código: chave de acesso NFC-e, PIN de mesa, JSON/XML, códigos Omie.
- Rótulos de seção: frase normal, nunca `uppercase`.
- Cada task termina com `npx tsc --noEmit` limpo, commit, `git push`, deploy (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"`) e print "depois" da(s) tela(s) tocada(s) em `~/ClaudeGerado/ntb-redesign-depois/`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. Tema escuro: todo token novo tem par em `.dark` e em `.force-light`; texto sobre superfícies escuras continua legível (contraste ≥ 4.5:1).
2. Classes com cor crua que sobrevivem ao redesign (`bg-blue-*`, `bg-[#...]`, `text-white` em superfície agora clara) — procurar com grep após cada task.
3. Telas de impressão (`lib/print.ts`) NÃO podem mudar (usam HTML próprio): conferir que nenhuma task mexeu em `lib/print.ts`.
4. Sidebar clara: ícones/textos que antes eram `text-white/*` sobre `--ink` precisam virar tokens de texto — senão somem.
5. `.u-glass*`/`.on-glass` (vidro escuro do cardápio do cliente) continuam com contraste certo depois da troca de tokens.

---

### Task 1: Fundação — tokens, fonte, utilitários

**Files:**
- Modify: `app/layout.tsx` (link do Google Fonts e `--font-sans-src`/`--font-mono-src`)
- Modify: `app/globals.css` (`:root`, `.force-light`, `.dark`, `.num`, `.eyebrow`, `body`)

- [ ] **Step 1:** Em `app/layout.tsx`, remover `Atkinson+Hyperlegible` e `JetBrains+Mono` do link do Google Fonts (manter Fredoka/Kalam/Quicksand dos temas do cardápio) e trocar:
```ts
--font-sans-src: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
--font-mono-src: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```
- [ ] **Step 2:** Em `app/globals.css`, `:root` e `.force-light`:
```css
--bg: #f5f5f7; --surface: #ffffff; --surface-2: #f2f2f7;
--text: #1d1d1f; --text-muted: #6e6e73; --border: rgba(60, 60, 67, 0.14);
--brand: #484DB5; --brand-strong: #3A3E91; --brand-soft: #eceefb;
--ok: #248a3d; --warn: #b25000; --err: #d70015; --info: #0066cc;
--r-sm: 0.5rem; --r-md: 0.75rem; --r-lg: 1.125rem; --radius: 0.75rem;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.04);
--shadow-md: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05);
```
(`--ink` continua `#1E1B4B` — usado por AuthBackdrop/vidro.)
- [ ] **Step 3:** `.dark`:
```css
--bg: #000000; --surface: #1c1c1e; --surface-2: #2c2c2e;
--text: #f5f5f7; --text-muted: #98989d; --border: rgba(84, 84, 88, 0.45);
--brand: #8b90ea; --brand-strong: #a6aaf0; --brand-soft: rgba(139, 144, 234, 0.18);
--ok: #30d158; --warn: #ffb340; --err: #ff6961; --info: #409cff;
```
- [ ] **Step 4:** `.num` vira `font-family: inherit; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;`. `.eyebrow` vira `font-size: 13px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text-muted);`. `body` `font-size: 0.9375rem` (15px) e `letter-spacing: -0.005em`.
- [ ] **Step 5:** `grep -rn "font-mono" components app lib --include=*.tsx` e, em cada ocorrência que formata NÚMERO/dinheiro/tempo (não chave/PIN/JSON), trocar `font-mono` por `num`. Registrar no relatório quais ficaram mono e por quê.
- [ ] **Step 6:** `npx tsc --noEmit`; commit "Fundação estilo Apple: fonte do sistema, tokens e números sem monoespaçada"; push; deploy; prints desktop+mobile de Caixa e Cardápio do cliente.

### Task 2: Componentes base (`components/ui.tsx`) + SegmentedControl

**Files:**
- Modify: `components/ui.tsx`

- [ ] **Step 1: Button** — base `rounded-full font-semibold`, sem `whileHover` (só `whileTap={{scale:0.97}}`); tamanhos `sm: h-8 px-3.5 text-[13px]`, `md: h-[38px] px-4 text-[15px]`, `lg: h-11 px-5 text-[16px]`; `primary` sem `shadow-sm`; `secondary: bg-[var(--surface-2)] hover:bg-[var(--border)]`; `outline: border border-[var(--border)] hover:bg-[var(--surface-2)]` (sem trocar cor do texto no hover).
- [ ] **Step 2: Input** — `rounded-[var(--r-md)] border-0 bg-[var(--surface-2)] h-[38px] px-3 text-[15px] max-sm:text-base focus:ring-2 focus:ring-[var(--brand)]/40`; label `text-[13px] font-medium text-[var(--text-muted)]`. Estado de erro: `ring-2 ring-[var(--err)]/50`.
- [ ] **Step 3: Card** — sem `border`, `rounded-[var(--r-lg)]`, sombra `var(--shadow-sm)`; hover interativo `y:-1` + `--shadow-md`. `accentColor` passa a ser ignorado visualmente (faixa lateral removida) — manter a prop pra não quebrar chamadas.
- [ ] **Step 4: Badge** — `normal-case tracking-normal text-[12px] font-medium px-2 py-0.5 rounded-full`.
- [ ] **Step 5: Modal** — raio `22px` (desktop) / folha `rounded-t-[22px]`; cabeçalho sem `border-b`, título `text-[17px] font-semibold`; botão fechar circular `w-8 h-8 rounded-full bg-[var(--surface-2)]`; scrim `bg-black/30 backdrop-blur-sm`.
- [ ] **Step 6: Collapsible** — sem borda, `bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]`, conteúdo sem `border-t` (separador fino só se necessário).
- [ ] **Step 7:** Criar e exportar `SegmentedControl`:
```tsx
export const SegmentedControl: React.FC<{ options: { value: string; label: React.ReactNode }[]; value: string; onChange: (v: string) => void; className?: string }> = ({ options, value, onChange, className = '' }) => {
  const id = React.useId();
  return (
    <div role="tablist" className={`inline-flex p-0.5 rounded-[10px] bg-[var(--surface-2)] ${className}`}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} type="button" onClick={() => onChange(o.value)}
          className={`relative px-3 h-8 max-sm:h-10 text-[13px] font-semibold rounded-[8px] u-motion ${value === o.value ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[8px] bg-[var(--surface)] shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: 'spring', bounce: 0, duration: 0.3 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
};
```
- [ ] **Step 8:** tsc; commit "Componentes base estilo Apple + SegmentedControl"; push; deploy; prints de um modal, um formulário (Configurações) e Histórico.

### Task 3: Casca do painel (menu lateral, cabeçalho, barra do celular) + Master Admin

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`StoreLayout`, ~linhas 947–1360: `<aside ... bg-[var(--ink)]>`, drawer móvel ~1095, tab bar ~1322, cabeçalho ~1340–1360)
- Modify: `components/modules/AdminModule.tsx` (sidebar ~966 e header móvel)

- [ ] **Step 1: Sidebar** — `bg-[var(--surface)]/80 backdrop-blur-xl border-r border-[var(--border)]` (sem `--ink`, sem sombra pesada). Todos `text-white*` da sidebar → `text-[var(--text)]` (itens) / `text-[var(--text-muted)]` (secundários). Item ativo: `bg-[var(--brand-soft)] text-[var(--brand)] font-semibold rounded-[10px]`; inativo hover `bg-[var(--surface-2)]`. Contador vermelho mantém `--err`. Rodapé: tema, "Trocar de Loja" e "Sair" em uma linha só de ícones com `title`/`aria-label` quando não couber (sem quebrar texto em 2 linhas); "Encerrar turno" como linha discreta com ponto verde.
- [ ] **Step 2: Drawer móvel** (~1095) e **tab bar** (~1322): mesmo material claro translúcido (`bg-[var(--surface)]/85 backdrop-blur-xl border-t border-[var(--border)]`), ícone ativo `text-[var(--brand)]`, inativo `text-[var(--text-muted)]`.
- [ ] **Step 3: Cabeçalho da página** — remover a faixa roxa superior de 4px; remover o subtítulo "Gerencie seu estabelecimento"; título `text-[30px] max-sm:text-[26px] font-bold tracking-[-0.02em]`; no canto: status de impressão vira ponto 8px + "Impressão" em `text-[13px] text-[var(--text-muted)]` (verde ok / vermelho quando offline), o quadrado com a inicial vira círculo 32px, data em `text-[13px] text-[var(--text-muted)]`.
- [ ] **Step 4: Master Admin** (`AdminModule.tsx`) — mesma sidebar clara e cabeçalho móvel claro.
- [ ] **Step 5:** grep no trecho alterado por `text-white`/`bg-white/` que sobrou em superfície clara; corrigir. tsc; commit "Casca do painel estilo Apple (menu claro, cabeçalho limpo)"; push; deploy; prints desktop+mobile (Caixa, Mesas, Master).

### Task 4: Mesas (grade, modal da mesa, comanda) + formato de tempo

**Files:**
- Create: `lib/formatDuration.ts`
- Modify: `components/modules/StoreModule.tsx` (TablesView grade ~3600–3800, modal da mesa ~3900–4450, comanda)

- [ ] **Step 1:** `lib/formatDuration.ts`:
```ts
// "2626 min" -> "1 d 19 h"; "125" -> "2 h 5 min"; "8" -> "8 min".
export const formatDuration = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
};
```
Trocar toda exibição `${x}min` / `{x}min` de tempo de mesa/pedido (Caixa, Mesas, Dashboard "sem pedido novo há X min", KDS) por `formatDuration(x)`.
- [ ] **Step 2: Grade** — mesa ocupada: cartão branco sem borda colorida, cabeçalho "Mesa 1" `text-[17px] font-semibold` + status `● Ocupada` (ponto `--brand`), total grande `text-[22px] font-semibold num`, lista de itens em linhas simples; chip de PIN só no hover/foco do cartão ou dentro do modal (manter o botão acessível). Mesa livre: tile compacto (altura ~72px) com "Mesa 5" + `● Livre` (ponto `--ok`), sem ícone grande nem "Disponível". Botões do topo ("Bloqueio PIN Ativo", "Colapsar Cards", "Pedidos do Dia") viram `Button variant="secondary" size="sm"`; o de PIN ativo usa ponto vermelho + texto, não fundo vermelho sólido.
- [ ] **Step 3: Modal da mesa** — título "Mesa 1" + subtítulo com o cliente; status como `● Ocupada`; ações "Adicionar Pedido" (primária, marca) e "Ver Comanda · R$ 27,39" (secundária) lado a lado em pílulas grandes (h-14, raio 16); "Receber e finalizar" primária de largura total na marca (texto em frase normal, não CAIXA ALTA); "Trocar responsável" como linha de lista simples. Nenhum azul `#2563eb` nem verde sólido nesses botões.
- [ ] **Step 4: Comanda** — lista agrupada estilo Ajustes (linhas em bloco branco com separadores finos), total em destaque no rodapé.
- [ ] **Step 5:** tsc; commit; push; deploy; prints (grade, modal, comanda) desktop+mobile.

### Task 5: Caixa (home) + Balcão + estados vazios

**Files:**
- Modify: `components/modules/StoreModule.tsx` (CaixaView ~6300–6700; CounterView; estados vazios com `border-dashed`)

- [ ] **Step 1:** Cartão do turno: avatar círculo, nome, linha secundária cinza (aviso "esqueceu de fechar?" em `--warn` só no texto); botões Sangria/Suprimento/Fechar caixa como `secondary` pílula, ícones de histórico/supervisor como botões circulares 36px.
- [ ] **Step 2:** "Mesas ocupadas (4)" em rótulo de seção normal; cartões de mesa brancos (sem rosa/verde): status por ponto, tempo com `formatDuration`, itens aguardando em lista simples.
- [ ] **Step 3:** Todo estado vazio com `border-2 border-dashed` → cartão sem borda, ícone 40px `text-[var(--text-muted)]/50`, título 17px, texto 13px (grep `border-dashed` em StoreModule/ClientModule/PrinterSettingsView e ajustar os de estado vazio; manter tracejado só onde é "área de soltar/adicionar").
- [ ] **Step 4:** tsc; commit; push; deploy; prints Caixa e Balcão.

### Task 6: Pagamento (Receber) + folha de produto do garçom

**Files:**
- Modify: `components/modules/StoreModule.tsx` (modal de pagamento ~2200–2470 e ~6800; `StoreProductModal` ~1600)

- [ ] **Step 1:** Abas Pagamento/Dividir/Por pessoa/Calculadora → `SegmentedControl`.
- [ ] **Step 2:** "Total a receber" como rótulo normal + valor `text-[40px] font-bold num tracking-[-0.02em]` sem caixa cinza em volta; "Tirar a taxa de 10%" como link/botão secundário pequeno.
- [ ] **Step 3:** Formas de pagamento: tiles `bg-[var(--surface-2)] rounded-[14px]` sem borda; selecionado `ring-2 ring-[var(--brand)] bg-[var(--brand-soft)]`. "Bandeira" como rótulo normal; bandeiras em chips pílula.
- [ ] **Step 4:** Botão final "Finalizar" primário na marca (não verde `--ok` sólido); textos em frase normal.
- [ ] **Step 5:** tsc; commit; push; deploy; prints (pagamento desktop+mobile, folha Pizza Tradicional).

### Task 7: Administração (sub-menu, Dashboard, Histórico, demais abas)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (StoreAdminView ~9620–10500)
- Modify: `components/modules/StoreDashboardView.tsx`
- Modify: `components/modules/PrinterSettingsView.tsx`, `UserManagementView`/`MeuLinkView` se tiverem CAIXA ALTA ou cores cruas

- [ ] **Step 1:** Sub-menu lateral da Administração: estilo lista de Ajustes (grupos com rótulo normal, item ativo em pílula `brand-soft`).
- [ ] **Step 2:** Dashboard: cartões sem faixa colorida lateral; valores `num` grandes na cor do texto (não azul/verde); variação ("-26,3% vs. semana passada") em texto 13px com seta, cor só no número; avisos de "mesa sem pedido novo" agrupados num único cartão-lista com ícone de alerta por linha.
- [ ] **Step 3:** Histórico de Vendas: título + `SegmentedControl` (Por venda / Por produto / Por operador) numa linha; ações (Filtros, Imprimir, Exportar CSV) como botões `secondary sm` com rótulo curto que não quebra; "Zerar vendas" como botão `ghost` vermelho separado à direita; contagem "105 registros" como texto cinza. Tabela: cabeçalho frase normal 13px cinza, linhas 15px, badge "Mesa" normal.
- [ ] **Step 4:** Demais abas (Turnos, Impressão, Usuários, Meu Link, Configurações, Notas Fiscais): tirar CAIXA ALTA de rótulos/badges, trocar cores cruas por tokens, cartões/seções no padrão novo.
- [ ] **Step 5:** tsc; commit; push; deploy; prints de todas as abas.

### Task 8: Cardápio do lojista + KDS

> **Restrição do dono (2026-09-26):** a organização da tela de cadastro do cardápio do lojista está "perfeita" — NÃO mudar estrutura, ordem de seções, fluxo nem onde cada coisa fica. Só o acabamento visual (tipografia, cores, raios, ações em ícone, estados).

**Files:**
- Modify: `components/modules/StoreModule.tsx` (MenuManagementView ~8220–8700; KdsView ~1377–1700)

- [ ] **Step 1:** Cartões de produto: nome 15px semibold, preço cinza escuro `num` (não azul), ações Editar/Pausar/Excluir viram ícones circulares 32px (lápis, pausa, lixeira) com `aria-label`, lixeira `--err` só no ícone.
- [ ] **Step 2:** Barra lateral de categorias: item ativo pílula `brand-soft`; contadores cinza.
- [ ] **Step 3:** KDS: cartões de pedido brancos com status por ponto e tempo `formatDuration`; botão de avançar status primário na marca / `--ok` só para "Pronto"; abas de local no `SegmentedControl` quando couberem, senão chips pílula.
- [ ] **Step 4:** tsc; commit; push; deploy; prints Cardápio lojista e KDS (ZZ Laboratorio).

### Task 9: Cardápio do cliente + telas de entrada + landing

**Files:**
- Modify: `components/modules/ClientModule.tsx`
- Modify: `components/modules/StoreModule.tsx` (`StoreLogin` form e seletor de loja), `components/modules/AdminModule.tsx` (`AdminLogin`), `app/page.tsx`, `app/acesso/page.tsx`

- [ ] **Step 1:** Cliente: cartão da loja sem borda, raio 22; busca em pílula `surface-2`; abas de categoria com sublinhado fino; badges ("Mais vendido") normal-case; botão "+" circular; folha de produto raio 22 com alça.
- [ ] **Step 2:** Formulário de login e seletor de loja: cartão branco raio 22, inputs novos, botão pílula; mesma linguagem da tela "Quem está entrando?".
- [ ] **Step 3:** tsc; commit; push; deploy; prints cliente (topo, barra, folha) e logins.

### Task 10: Movimento estilo Apple

**Files:**
- Modify: `lib/motion.ts` (curvas padrão), `components/ui.tsx` (Modal, Button, Toast), `components/Toast.tsx`, `components/modules/StoreModule.tsx` (StoreLayout, KDS, Caixa, pagamento), `app/globals.css` (reduced motion)

Molas padrão (spec Apple): `SPRING_UI = { type: 'spring', bounce: 0, duration: 0.35 }` (sem sobra), `SPRING_SHEET = { type: 'spring', bounce: 0.12, duration: 0.45 }` (folhas), `SPRING_TAP = { type: 'spring', bounce: 0, duration: 0.2 }`.

- [ ] **Step 1: Toque** — botões/cartões afundam no pointer-down (`whileTap scale 0.97`), sem crescer no hover (Mac não "pula" botão).
- [ ] **Step 2: Menu lateral** — pílula do item ativo desliza entre itens (`motion.div layoutId="nav-ativo"` com `SPRING_UI`); mesma coisa na barra inferior do celular.
- [ ] **Step 3: Troca de aba** — conteúdo entra com fade + subida de 8px em 220ms e sai só com fade 120ms (já existe na Administração; generalizar pro `StoreLayout`).
- [ ] **Step 4: Janelas/folhas** — no computador: scrim 0→30% + janela `scale 0.96→1, opacity 0→1` com `SPRING_UI`, saída pelo mesmo caminho; no celular: folha sobe de baixo com `SPRING_SHEET` e pode ser arrastada pra baixo pra fechar (alça), respeitando velocidade do gesto.
- [ ] **Step 5: Avisos (toast)** — entram de cima como notificação do iPhone (`y:-24→0`, `SPRING_SHEET`), somem subindo; arrastar pra cima dispensa.
- [ ] **Step 6: Listas vivas** — pedido novo no KDS/Caixa entra com `layout` + `initial {opacity:0, y:-12, scale:0.98}`; item que sai colapsa altura (AnimatePresence + `layout`), reorganizando o resto com `SPRING_UI`.
- [ ] **Step 7: Números** — totais (comanda, pagamento, dashboard) animam a troca de valor (contagem rápida 300ms com `useSpring`/`animate`), sem piscar.
- [ ] **Step 8: Confirmação** — ao finalizar pagamento, check desenhado (path `pathLength 0→1`, 400ms) antes de fechar a janela.
- [ ] **Step 9: Mesa** — mudança de status (livre→ocupada) faz o ponto trocar de cor com crossfade e o cartão dar um "respiro" único (`scale 1→1.02→1`).
- [ ] **Step 10: Movimento reduzido** — tudo acima vira fade simples quando `prefers-reduced-motion` (MotionConfig `reducedMotion="user"` na raiz + checagem nas animações de número/check).
- [ ] **Step 11:** tsc; commit; push; deploy; gravar 2-3 GIFs curtos (Playwright video → gif) de troca de aba, abrir janela e finalizar pagamento em `~/ClaudeGerado/ntb-redesign-depois/`.

### Task 11: Tema escuro, varredura final, versão desktop

- [ ] **Step 1:** Prints de 6 telas principais em `.dark` (Caixa, Mesas, modal, Pagamento, Cardápio, Dashboard); corrigir contraste/cores cruas encontradas.
- [ ] **Step 2:** `grep -rn "uppercase" components` e `grep -rn "bg-blue-\|bg-green-\|bg-red-\|text-blue-" components` — revisar cada ocorrência restante (manter só se for intencional e registrar).
- [ ] **Step 3:** Prints "depois" completos (mesmo roteiro do "antes") em `~/ClaudeGerado/ntb-redesign-depois/`.
- [ ] **Step 4:** `desktop/package.json` versão +1 no patch; `cd desktop && npm run dist && bash scripts/publish.sh`; commit/push.
