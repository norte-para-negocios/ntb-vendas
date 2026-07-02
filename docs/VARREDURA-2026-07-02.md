# Varredura completa do ntb-vendas — 2026-07-02

Auditoria de leitura (frontend, backend, dados, segurança, performance,
gaps de produto) feita com 5 agentes paralelos cobrindo o repo inteiro:
`StoreModule.tsx` (leitura completa, 3357 linhas), todas as migrations,
`lib/api.ts` inteiro, `ClientModule.tsx`, `ui.tsx`, `globals.css`.

**Status:** a maior parte dos achados de segurança/bugs/performance/UX já
foi corrigida e commitada no `main` (ver
`docs/plans/2026-07-02-varredura-correcoes-plan.md` pro plano de
implementação e o `git log` do dia pros commits). As 15 ideias de produto
no final deste doc seguem em **standby**, não iniciadas. Este arquivo é o
registro bruto da varredura em si — antes de virar plano.

---

## 🔴 Segurança

| # | Achado | Onde | Severidade | Status |
|---|---|---|---|---|
| 1 | PIN de mesa (4 dígitos) sem rate limit no RPC | `003_secure_table_pin.sql`, `open_table_session` | Alta | ✅ Corrigido (migration 007, rate-limit 5 tentativas/5min) |
| 2 | `createOrder` confia no preço mandado pelo client | `lib/api.ts:527` (linha na época da varredura) | Alta | ✅ Corrigido (RPC `create_order_secure`, migration 007) |
| 3 | `BillSplitter` vaza o PIN da mesa pra qualquer convidado | `ClientModule.tsx:631` | Alta | ✅ Corrigido |
| 4 | XSS armazenado via nome/observação nos documentos impressos | `lib/print.ts` | Média-Alta | ✅ Corrigido (`escapeHtml` + `noopener`) |
| 5 | Login (admin/lojista) sem rate limit nem lockout | `lib/api.ts:4-52` | Média | ✅ Corrigido (migration 008) |
| 6 | Sem `CHECK` no banco pra preço/quantidade não-negativos | migration 001 | Média | ✅ Corrigido (migration 007) |
| 7 | Pedidos ativos podem sumir sem aviso numa loja grande | `lib/api.ts:294-311` | Média | ✅ Corrigido (`.order('created_at')` antes do limit) |
| 8 | Histórico de vendas sem filtro de data / índice composto | `lib/api.ts:382-409` | Média | ✅ Corrigido (índice migration 009; filtro de data suportado na função, falta UI) |
| 9 | Upload preset do Cloudinary é público e não-assinado | `lib/api.ts:720-738` | Média | ⚠️ Não resolvido por código — precisa checar/restringir no console da Cloudinary (sem backend pra assinar upload) |
| 10 | Certificado `.pfx` fica órfão no Storage ao excluir loja | `lib/api.ts:918-949` | Baixa | ✅ Corrigido (policy de DELETE + `deleteStore` limpa o bucket) |
| 11 | `deleteStore` era hard-delete em cascata, sem log de quem apagou | `lib/api.ts:918-949` | Baixa | ✅ Corrigido — virou soft-delete (`is_active = false`) |
| 12 | Sem estratégia de backup documentada | — | Baixa | ⚠️ Não resolvido — confirmar plano Supabase cobre Storage, não só Postgres |

**⚠️ Pendência crítica:** as migrations 006/007/008/009 que implementam as
correções acima **ainda não foram aplicadas em nenhum banco** (falta
`.env.local`/`SUPABASE_DB_URL` no ambiente onde isso foi feito). Ver
`docs/PENDENTE-aplicar-migrations.md` pro passo a passo.

## 🐛 Bugs / comportamento arriscado (painel do lojista)

| # | Achado | Onde | Severidade | Status |
|---|---|---|---|---|
| 1 | Avanço de status na cozinha/bar é otimista e ignora falha de escrita | `StoreModule.tsx` (`KitchenView`/`BarView`, na época) | Alta | ✅ Corrigido |
| 2 | Excluir categoria deixa produtos órfãos e invisíveis na UI | `StoreModule.tsx`, `lib/api.ts:201-203` | Alta | ✅ Corrigido (seção "Sem categoria") |
| 3 | "Abrir Mesa Manualmente" sem tratamento de erro | `StoreModule.tsx:1564-1578` | Média-Alta | ✅ Corrigido |
| 4 | Sem cálculo de troco no pagamento em dinheiro | `StoreModule.tsx:1185-1197` | Média-Alta | ✅ Corrigido (`lib/calc.ts`) |
| 5 | "Finalizar Mesa" sem guarda contra duplo clique | `StoreModule.tsx:1844-1850` | Média | ✅ Corrigido |
| 6 | Sem persistência de sessão do lojista — F5 derruba o login | `StoreModule.tsx:3298` | Média | ✅ Corrigido (localStorage) |
| 7 | Cozinha/bar sem alerta sonoro de pedido novo | `StoreModule.tsx` | Média | ✅ Corrigido (`lib/audioAlert.ts` reaproveitado) |
| 8 | `KitchenView`/`BarView` ~150 linhas quase idênticas duplicadas | `StoreModule.tsx:433-780` | Média | ✅ Corrigido — unificados em `KdsView` |
| 9 | Realtime de mesas/pedidos não filtra por loja (fan-out global na plataforma) | `StoreModule.tsx:1088-1093` | Média-Alta | ✅ Corrigido (migration 009, `order_items.store_id`) |
| 10 | Sem atribuição de qual garçom fez a ação (tudo grava `[Lojista]` fixo) | `StoreModule.tsx:1295, 1567` | Média | ✅ Corrigido |
| 11 | Sem indicador de "pedido atrasado" no KDS apesar de `prep_time_minutes` existir | `StoreModule.tsx:516-592` | Baixa-Média | ✅ Corrigido |

## ⚡ Performance / Arquitetura

| # | Achado | Onde | Severidade | Status |
|---|---|---|---|---|
| 1 | Fan-out global de Realtime (mesmo achado #9 acima) | vários | Alta | ✅ Corrigido |
| 2 | Zero uso de `next/image` | `ClientModule.tsx`, `StoreModule.tsx` | Alta | ✅ Corrigido |
| 3 | `AppContext` sem `useMemo` no value — re-render amplo no carrinho | `context/AppContext.tsx:60-69` | Alta | ✅ Corrigido |
| 4 | Taxa de serviço (10%) hardcoded e duplicada em 7 lugares | `StoreModule.tsx` + `ClientModule.tsx` | Alta | ✅ Corrigido (`lib/calc.ts`) |
| 5 | Split de conta por pessoa sem função pura testável | `StoreModule.tsx:980-1004` | Alta | ✅ Corrigido (`lib/calc.ts`) |
| 6 | `recharts` sempre no bundle inicial | `StoreModule.tsx:2994` | Média | ✅ Corrigido (`next/dynamic`) |
| 7 | Cardápio do cliente sem `React.memo` por card | `ClientModule.tsx:1413` | Média | ✅ Corrigido (`ProductCard`) |
| 8 | `StoreModule.tsx`: baixa razão de memoização (103 useState/useEffect vs 7 hooks de memo) | `StoreModule.tsx` | Média | Parcialmente endereçado (itens 3, 4, 7 acima cobrem os pontos de maior impacto) |
| 9 | `fetchStoreById` chamado redundantemente em 3+ pontos | vários | Média | ✅ Corrigido |
| 10 | Duas implementações paralelas de "somar total do pedido" | `lib/api.ts` vs UI | Média | ✅ Corrigido (`lib/calc.ts` como fonte única) |

## 🎨 UX / Acessibilidade / Mobile (cliente final)

| # | Achado | Onde | Severidade | Status |
|---|---|---|---|---|
| 1 | Cards de produto não navegáveis por teclado/leitor de tela | `ClientModule.tsx:1414-1419` | Alta | ✅ Corrigido (`ProductCard` como `<button>`) |
| 2 | Modais sem `role="dialog"`, sem focus trap, sem Esc | `components/ui.tsx:86-113` | Alta | ✅ Corrigido |
| 3 | Cores de status abaixo do contraste WCAG AA no modo claro | `app/globals.css:50-53` | Alta | ✅ Corrigido |
| 4 | Erro de rede vira silenciosamente "loja não encontrada" | `lib/api.ts:117-192` | Alta | ✅ Corrigido |
| 5 | Adicionar ao carrinho sem confirmação visual | `ClientModule.tsx:1494-1500` | Média | ✅ Corrigido (toast) |
| 6 | Cardápio mostra "nenhum produto encontrado" durante o loading (falso negativo) | `ClientModule.tsx:1057-1073` | Média | ✅ Corrigido |
| 7 | Botões só-ícone quase todos sem `aria-label` | vários | Média | Parcialmente — `Toast`/`Modal` corrigidos; varredura ampla de todos os ícones não foi item isolado do plano |
| 8 | `<label>` não associado ao `<input>` via `htmlFor`/`id` | `components/ui.tsx:47-62` | Média | ✅ Corrigido (componente `Input` compartilhado) |
| 9 | Alvos de toque abaixo de 44px em pontos de uso repetido | `ClientModule.tsx:576,578,959,961` | Média | ✅ Corrigido |
| 10 | Não instalável como PWA — sem `manifest.json` | `app/layout.tsx` | Média | ✅ Corrigido |
| 11 | Toast sem `aria-live`/`role="status"` | `components/Toast.tsx:50` | Média | ✅ Corrigido |
| 12 | 100% pt-BR hardcoded, sem camada de i18n | todo `ClientModule.tsx` | Baixa | Standby — atrelado à feature "multi-idioma" da lista de produto abaixo |

*(nota: dark mode já funcionava corretamente no fluxo do cliente — não era um achado, foi só confirmado durante a varredura)*

## 🚀 Gaps de produto / novas features — STANDBY

Não iniciadas por decisão explícita do usuário (2026-07-02: "as novas
features só depois"). Nenhuma linha de código escrita pra nenhum destes.

| # | Feature | Categoria | Esforço | Por quê |
|---|---|---|---|---|
| 1 | Percentual de taxa de serviço configurável por loja (hoje é 10% fixo em código) | Operação | Baixo | UI de split/gorjeta já existe, é só parametrizar |
| 2 | Exportar relatório em CSV além de imprimir A4 | Operação | Baixo | `printSalesReport` já filtra por período |
| 3 | Comparação "vs. período anterior" (%) no dashboard | Analytics | Baixo | Cálculo já existe (`periodStats`), só falta o range deslocado |
| 4 | Avaliação pós-refeição (estrelas + comentário) | Retenção | Baixo-médio | Tela final "Obrigado" já existe |
| 5 | Identidade do cliente por telefone/WhatsApp | Retenção/Infra | Médio | Pré-requisito técnico de fidelidade, cupom e LGPD |
| 6 | Delivery/retirada com endereço e taxa de entrega | Receita | Médio | Hoje só existe consumo local + balcão |
| 7 | Cupom de desconto | Receita/Retenção | Médio | Pedido explícito do mercado, ausente hoje |
| 8 | Multi-idioma no cardápio (PT/EN/ES) | Receita | Médio | Diferencial pra restaurante turístico/litoral |
| 9 | Notificação push real pro lojista (Service Worker + VAPID) | Operação | Médio-alto | Base sonora (`audioAlert.ts`) já existe |
| 10 | Programa de fidelidade (carimbo/pontos) | Retenção | Médio-alto | Depende do item 5 |
| 11 | Dashboard cross-loja pro Master Admin (hoje é só CRUD) | Produto interno | Médio | Norte não tem visão agregada da carteira de clientes |
| 12 | Campo de custo/margem por produto → CMV real no dashboard | Analytics | Médio | Hoje só mostra faturamento bruto, nunca lucro |
| 13 | Reserva de mesa antecipada | Receita | Alto | Foge do modelo atual (sessão só abre com PIN físico) |
| 14 | Integração com o Norte Estoque (ntb-estoque) — baixa de ingrediente via ficha técnica | Sinergia de produto | Alto | Cruza dois repos/times, mas é a sinergia óbvia entre os dois produtos da mesma empresa |
| 15 | LGPD — exportação/exclusão de dados do cliente | Compliance | Baixo-médio | Baixo risco hoje, vira obrigatório assim que 5/7/10 existirem |

### Se fosse escolher os próximos 5

1. **#5 identidade por telefone** — destrava 6, 7, 10, 15 de uma vez.
2. **#1 taxa de serviço configurável** — baixo esforço, resolve uma limitação real hoje.
3. **#6 delivery/retirada** — maior gap de receita citado no mercado.
4. **#11 dashboard cross-loja** — a própria Norte sente falta disso pra gerenciar a carteira.
5. **#14 integração com Norte Estoque** — maior esforço da lista, mas é o argumento de venda casada mais forte do ecossistema.

---

## Documentos relacionados neste repo

- `docs/plans/2026-07-01-alerta-cliente-e-certificado-fiscal-design.md` —
  design do alerta ativo no cliente + espaço do certificado digital.
- `docs/plans/2026-07-01-alerta-cliente-e-certificado-fiscal-plan.md` —
  plano de implementação dessas duas features (já implementadas).
- `docs/plans/2026-07-02-varredura-correcoes-plan.md` — plano de
  implementação de TODAS as correções desta varredura (22 tasks, todas
  já implementadas e commitadas).
- `docs/PENDENTE-aplicar-migrations.md` — checklist pra aplicar as
  migrations 006/007/008/009 assim que houver acesso a
  `SUPABASE_DB_URL`. **Isso é o próximo passo real.**
- `AGENTS.md` — visão geral do sistema pra qualquer agente/dev que for
  mexer no repo; já atualizado com tudo desta varredura.
