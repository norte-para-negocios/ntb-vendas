# Backlog anotado (2026-08-16) — não implementar ainda, só registrar

> Pedido explícito do usuário nesta sessão: "anota, não faz agora". Este
> arquivo é um registro de 3 itens discutidos, pra retomar em sessão
> futura com o processo completo (brainstorming → plano detalhado →
> execução), sem perder o contexto da conversa que os originou.

---

## 1. Login de Garçom (permissão restrita — só liberar PIN + ver pedidos)

**Origem:** discussão sobre o fluxo de PIN da mesa no cardápio do
cliente. Hoje existe um toggle por loja (`stores.config.require_pin_for_open`,
botão "Bloqueio PIN Inativo/Ativo" em Mesas & Comandas) que decide se
abrir uma mesa livre exige PIN. O usuário quer ir além disso: um **login
próprio de garçom**, separado do login de lojista/admin completo, que:

- Vê as mesas e os pedidos de cada mesa (como quem já tem a permissão
  `tables` hoje).
- Consegue **liberar/revelar o PIN** pra entregar ao cliente.
- **NÃO** tem acesso ao resto (config da loja, cardápio, admin,
  histórico de vendas, etc.) — hoje isso não é possível: a permissão
  `tables` já dá acesso total à aba Mesas inteira (bloquear mesa,
  fechar conta, editar, ver TODOS os PINs sem distinção), não existe
  nenhuma permissão mais granular.

**Estado atual confirmado (leitura de código, sem mudança):**
- `types/index.ts` — `StoreUserPermissions` só tem 6 flags grosseiras:
  `tables, counter, kitchen, bar, menu, admin`. Não tem nada tipo
  `tables_reveal_pin_only`.
- `store_users` (migration 001) + RPCs `security definer` da migration
  014 já cobrem CRUD de usuário por loja — a infraestrutura de "criar
  login de funcionário" já existe, só a granularidade de permissão que
  não cobre esse caso.
- `UserManagementView` (`StoreModule.tsx`) é onde hoje se cria
  usuário/permissão por loja — provável lugar de estender a UI.

**O que precisa ser decidido antes de planejar de verdade (perguntas
pra próxima sessão):**
- É uma permissão nova (`tables_pin_only` ou similar) dentro do modelo
  atual, ou um `role` inteiramente novo (`'waiter'`) com uma tela
  própria mais simples (só a visão de mesas + botão de revelar PIN,
  sem o resto da UI de `TablesView`)?
- O garçom vê o PIN de TODAS as mesas, ou só da mesa que ele está
  atendendo (precisaria de atribuição garçom↔mesa, que não existe
  hoje)?
- Isso substitui o toggle `require_pin_for_open` (some da loja e vira
  sempre obrigatório) ou convive com ele (loja decide se quer PIN
  nenhum, PIN livre, ou PIN só via garçom)?

---

## 2. Reteste ponta a ponta: integração NTB Estoque + emissão fiscal

**Origem:** pedido de confirmar que tudo que já foi construído/testado
em sessões anteriores continua funcionando de verdade em produção —
não é feature nova, é validação.

**O que já está documentado como funcionando (ver `AGENTS.md`, seções
"Integração ntb-vendas ↔ ntb-estoque" e o histórico de atualizações
fiscais de 06/07 a 08/06):**
- Ordem de Produção automática no `ntb-estoque` ao fechar pedido
  (`omie_codigo`, testado ponta a ponta em 2026-07-07 com a Vieras e
  Vinhos).
- NFC-e e NF-e autorizadas em homologação através do pipeline real do
  app (não script solo) — última validação registrada foi 2026-08-06,
  loja de teste (AMJ Santos), removida ao final.
- Bloqueio real pendente registrado em 2026-08-07: a tentativa com a
  loja REAL (Vieras e Vinhos) falhou porque a senha do certificado não
  decripta o `.pfx` — `modelo_emissao_automatica` foi revertido pra
  `'nenhuma'` nessa loja até a senha certa ser confirmada.

**O que fazer na próxima sessão:**
- Confirmar se a senha do certificado da Vieras e Vinhos já foi
  corrigida/confirmada desde 08/07 — sem isso, o teste com loja real
  não avança.
- Reteste ponta a ponta (loja de teste descartável, nunca a loja real,
  sempre homologação — regra crítica já documentada em `AGENTS.md`):
  fechar pedido → confirmar Ordem de Produção no `ntb-estoque` →
  confirmar NFC-e/NF-e autorizada → baixar cupom/DANFE.
- Se a senha da Vieras e Vinhos for corrigida, decidir com o usuário se
  liga `modelo_emissao_automatica` de volta pra essa loja (produção
  real, não é mais teste isolado a partir desse ponto).

---

## 3. Redesign geral do app com animações "estilo Apple"

**Origem:** feedback direto do usuário nesta sessão — já fiz 2 rodadas
rápidas de ajuste visual só no cardápio do cliente (tirar decoração
"de app"/emoji, depois reverter cor pro azul da marca + instalar a lib
`motion` pro acordeão) e ele achou o processo apressado demais
("você tá fazendo uma coisa muito rápida... faz um plano de
superpoderes"). Ele quer uma passada de design **completa**, não mais
ajustes pontuais reativos.

**Escopo maior do que o já feito hoje:** não é só o cardápio do
cliente (`ClientModule.tsx`) — é o app inteiro (painel do lojista,
painel do Master Admin, telas de login) revisado com o mesmo padrão de
qualidade e movimento.

**O que já existe hoje que a próxima sessão deve aproveitar, não
redescobrir:**
- Lib `motion` já instalada (`package.json`) — usada até agora só no
  acordeão de categoria do cardápio (`ClientModule.tsx`, expand/collapse
  com spring + `whileTap`).
- Pesquisa de motion design já feita nesta sessão (skills
  `apple-design` e `motion-design-skill` já consultadas) — a diretriz
  central do `apple-design`: motion baseado em spring
  (`damping`/`response`, não duração fixa), interruptível, feedback no
  toque instantâneo, materiais translúcidos pra hierarquia. Vale reler
  antes de planejar, não redigitar do zero.
- Cor: regra reafirmada nesta sessão — dourado (`WINE_GOLD`) só pra
  preço/valor no cardápio do cliente; ação/CTA é sempre o azul da marca
  (`--brand`), igual ao resto do produto. Não reabrir essa discussão
  sem motivo novo.

**Processo pedido explicitamente pelo usuário pra próxima vez:**
usar o fluxo completo do Superpowers (brainstorming com pesquisa de
verdade antes de qualquer código, plano escrito, execução revisada) —
não patches reativos tela por tela como aconteceu hoje.
