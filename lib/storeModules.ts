// Perfil de módulos por loja (Task 1, plano 2026-08-22-perfis-de-loja-e-caixa)
// — cada loja escolhe quais módulos existem nela (ex.: o Sertão não tem
// Cozinha/Bar, só Caixa/Garçom/Gestão de Mesa). `stores.config` é jsonb já
// existente, sem migration nova.
//
// Regra que não pode quebrar: ausência de `config.modules` significa TODOS os
// módulos ligados e fluxo `kds` — é o comportamento das 6 lojas reais de hoje
// (nenhuma delas tem `modules` configurado). O default é sempre o
// comportamento atual, nunca um estado "tudo desligado".
export type StoreModules = {
  tables: boolean; counter: boolean; kitchen_kds: boolean;
  bar_kds: boolean; caixa: boolean; menu: boolean; admin: boolean;
};
export type OrderFlow = 'kds' | 'direct_print';

// Task 4 (2026-08-22, módulo Caixa): `caixa` é o ÚNICO módulo desta lista que
// não é "tudo ligado" por padrão — default `false`, ao contrário dos outros
// 6. Nome `ALL_ON` mantido (evita renomear em todo lugar que já importa),
// mas não é mais literal pra este campo específico. Motivo: `caixa` é a
// primeira entrada de StoreModules cujo valor `true` MUDA COMPORTAMENTO pra
// um usuário que já existia antes desta feature (quem finaliza uma mesa) —
// diferente de kitchen_kds/bar_kds/etc., cujo "ligado" só decide se uma ABA
// aparece, nunca tira uma capacidade que alguém já tinha. Ligar por padrão
// romperia a garantia central deste plano ("loja sem config = comportamento
// de hoje") pra qualquer waiter futuro cadastrado em qualquer uma das 7
// lojas reais, mesmo sem o Master Admin jamais ter tocado nesta seção —
// exatamente o mesmo cuidado já usado em `resolveOrderFlow` abaixo
// (ausência de config = valor SEGURO, nunca o novo). Ver canFinalizeBill
// mais abaixo pra como isto é consumido.
export const ALL_ON: StoreModules = {
  tables: true, counter: true, kitchen_kds: true,
  bar_kds: true, caixa: false, menu: true, admin: true,
};

export const resolveStoreModules = (store?: { config?: any } | null): StoreModules => {
  const m = store?.config?.modules;
  // Fix round 1 (Task 1 review, Minor #4): `typeof m !== 'object'` sozinho
  // não exclui array (`typeof [] === 'object'`) — inofensivo hoje (espalhar
  // um array em `{...ALL_ON, ...m}` só soma chaves numéricas ('0', '1'...)
  // que ninguém lê), mas não é o que o comentário acima promete ("m não é um
  // objeto de config válido"). `Array.isArray` fecha a lacuna.
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ALL_ON;
  return { ...ALL_ON, ...m };
};

export const resolveOrderFlow = (store?: { config?: any } | null): OrderFlow =>
  store?.config?.order_flow === 'direct_print' ? 'direct_print' : 'kds';

// Removido (redesign 2026-08-23, "caixa como estação de impressão"): existia
// um `print_target: 'device' | 'station'` aqui, decidindo entre imprimir no
// aparelho de quem lança o pedido (garçom) ou numa "Estação de Impressão"
// dedicada (`/estacao`, `EstacaoModule.tsx`) rodando num tablet fixo na
// cozinha. O dono rejeitou esse desenho na prática: *"na cozinha não vai ter
// um tablet, não vai ter um equipamento. O único equipamento vai ter no
// caixa"*. A impressora da cozinha é de rede (IP próprio), configurada como
// padrão no SISTEMA OPERACIONAL do aparelho do caixa (like instalar
// qualquer impressora) — então `window.print()` já sai por ela sem nenhum
// dispositivo/rota dedicados. A reconciliação que a Estação fazia (pedidos
// sem "aparelho próprio" pra imprimir — autoatendimento do cliente via QR e
// Balcão) foi portada pra dentro da própria sessão do Caixa
// (`components/modules/CaixaPrintStation.tsx`), rodando em segundo plano
// enquanto o caixa usa o painel normalmente. `/estacao` e `EstacaoModule.tsx`
// foram apagados — nenhuma loja em produção usava `print_target: 'station'`
// (a Sertão, única candidata, foi revertida pra 'device' antes desta sessão).
// Ver `CaixaPrintStation.tsx` pro porquê de não precisar mais de um "alvo"
// configurável: só existe um alvo agora, sempre.
//
// Mapa aba do painel do lojista -> chave do módulo correspondente em
// StoreModules. 'kitchen'/'bar' são os nomes históricos de aba/permissão
// (StoreUserPermissions), que mapeiam pros módulos mais específicos
// kitchen_kds/bar_kds (ver Passo 2 do brief da Task 1). Compartilhado entre
// StoreModule (canAccess, tab ativa) e StoreLayout (sidebar/bottom nav) pra
// não duplicar a regra em dois lugares.
// 'caixa' (Task 3, 2026-08-23, plano frente-de-caixa): a aba nova do módulo
// Caixa (fila consolidada de recebíveis) usa a MESMA chave de módulo
// `caixa` que já gate-ava 'tables'/'counter' pra quem tem a permissão
// `caixa` (ver `hasTabPermission` abaixo) — não é módulo novo, só mais uma
// superfície gateada pelo mesmo `resolveStoreModules(store).caixa`.
export const TAB_MODULE_KEY: Record<string, keyof StoreModules> = {
  caixa: 'caixa',
  tables: 'tables',
  counter: 'counter',
  kitchen: 'kitchen_kds',
  bar: 'bar_kds',
  menu: 'menu',
  admin: 'admin',
};

// Mesma cascata usada em pickInitialStoreTab/canAccess/visibleTabs — extraída
// pra não duplicar a ordem em 3 lugares (era só um array solto repetido).
// 'caixa' vem PRIMEIRO (Task 3): "é o primeiro lugar que o operador vê ao
// entrar" (brief) — pickInitialStoreTab escolhe o primeiro item acessível
// desta lista, então um usuário com permissão `caixa` numa loja com o
// módulo ligado agora pousa direto na fila de recebíveis/tela de abrir
// caixa, em vez de Mesas. Inofensivo pras 7 lojas reais de hoje: nenhuma
// tem o módulo `caixa` ligado, então 'caixa' nunca é acessível pra elas e
// a ordem efetiva continua idêntica (cai direto em 'tables').
export const TAB_IDS = ['caixa', 'tables', 'counter', 'kitchen', 'bar', 'menu', 'admin'] as const;

// Fix round 1 (Task 1 review, Important #1) — "self-inflicted lockout":
// `pickInitialStoreTab` caía no literal `'admin'` quando `.find(isAccessible)`
// não achava nada, SEM checar se `admin` de fato estava acessível. Se uma
// loja tiver todos os módulos desligados (só alcançável hoje editando o
// perfil manualmente no Master Admin — inatingível pelas 7 lojas reais, mas
// sem nenhuma validação impedindo o Master Admin de salvar assim), o
// dono/conta universal ficava preso: `canAccess(tab)` nega, `visibleTabs` da
// sidebar fica vazio, e não sobra NENHUM jeito de sair dali pelo próprio
// painel.
//
// `admin` é a exceção deliberada: é a única tela capaz de religar um módulo
// desligado, então nunca pode ficar bloqueada pelo próprio perfil que ela
// existiria pra consertar. Com qualquer outra aba ainda acessível, o
// comportamento de hoje (module gate antes do bypass de dono, decisão já
// aprovada na Task 1) continua idêntico — este fallback só age quando
// restaria zero abas alcançáveis, mesmo contando `admin`.
//
// Compartilhada entre pickInitialStoreTab, StoreModule.canAccess e
// StoreLayout.visibleTabs (StoreModule.tsx) pra garantir que os três
// concordem sobre o que está acessível — antes cada um repetia a mesma
// checagem `moduleKey && !modules[moduleKey]` isoladamente.
export const computeAccessibleTabIds = (
  modules: StoreModules,
  hasPermission: (tabId: string) => boolean
): Set<string> => {
  const reachable = TAB_IDS.filter((tabId) => {
    const moduleKey = TAB_MODULE_KEY[tabId];
    if (moduleKey && !modules[moduleKey]) return false;
    return hasPermission(tabId);
  });
  return reachable.length > 0 ? new Set(reachable) : new Set(['admin']);
};

// Permissão mínima que um usuário precisa pra ver uma ABA — não confundir
// com StoreModules acima (que é por LOJA, não por usuário). Consolidada
// aqui porque a mesma checagem (`role==='owner' || permissions[tabId] !==
// false`) estava duplicada em 3 lugares de StoreModule.tsx (StoreLayout,
// pickInitialStoreTab, canAccess) — cada cópia corria o risco de divergir
// silenciosamente (foi exatamente esse tipo de duplicação que motivou
// computeAccessibleTabIds acima).
//
// Módulo Caixa (Task 4): quem tem a permissão `caixa` marcada enxerga a aba
// 'tables' mesmo sem o checkbox "Gestão de Mesas" estar marcado — "Caixa tem
// acesso à gestão de mesa igual ao garçom" (brief da Task 4) não deveria
// depender do Master Admin lembrar de marcar as DUAS caixinhas ao criar um
// caixa novo.
//
// Task 5 (2026-08-22, fecha o gap do Balcão): mesmo raciocínio pra 'counter'
// — um caixa que só fecha comanda de balcão (sem o checkbox "Balcão"
// marcado à parte) não pode ficar sem enxergar a própria aba que ele é
// responsável por fechar. "Um cashier que não consegue ver o Balcão não
// pode ser responsável por ele" (brief da Task 5). Únicos dois casos
// especiais; toda outra aba continua só no padrão permissivo genérico
// (ausência de chave = true, pensado pras 6 permissões que já existem em
// todo store_user real).
//
// Fix round 4 (Group B1): o override acima checava só `permissions.caixa`,
// nunca `resolveStoreModules(store).caixa` — igual ao módulo em si estar
// DESLIGADO, um usuário com a permissão `caixa` marcada em QUALQUER uma das
// 6 lojas reais (nenhuma tem módulo Caixa) já ganharia a aba Balcão, mesmo
// a loja não tendo esse módulo. Inofensivo hoje (confirmado em produção,
// 2026-08-22: só existe UMA conta com `caixa: true`, na loja que abre em
// 01/09 — que vai ter o módulo ligado), mas era "uma caixinha marcada" de
// distância de ficar ativo de verdade numa das 6 lojas KDS, contrariando a
// garantia central deste plano ("loja sem módulo = sem mudança nenhuma").
// `store` é opcional (não `undefined`, ausência de argumento) só pra não
// quebrar nenhuma chamada existente por engano — todo call site real de
// hoje já tem a loja à mão (`user.store`/`u.store`) e deve sempre passá-la.
export const hasTabPermission = (
  user: { role: string; permissions?: Record<string, any> },
  tabId: string,
  store?: { config?: any } | null
): boolean => {
  if (user.role === 'owner') return true;
  if (
    (tabId === 'tables' || tabId === 'counter') &&
    user.permissions?.caixa === true &&
    resolveStoreModules(store).caixa
  ) {
    return true;
  }
  // Task 3 (frente-de-caixa): a aba 'caixa' em si usa comparação ESTRITA
  // (`=== true`), ao contrário do padrão permissivo (`!== false`) usado
  // pelas 6 permissões antigas na linha de baixo. Motivo: `permissions.caixa`
  // é um campo NOVO, ausente em todo store_user real hoje (mesmo raciocínio
  // já documentado no tipo `StoreUserPermissions.caixa` e em
  // `canFinalizeBill` acima) — se caísse no fallback permissivo, QUALQUER
  // usuário sem essa chave explicitamente `false` (ou seja, todo mundo)
  // ganharia a aba assim que o Master Admin ligasse o módulo `caixa` da
  // loja, contrariando o brief ("permissão caixa do usuário logado é
  // true"). O gate de MÓDULO (`resolveStoreModules(store).caixa`) já é
  // checado à parte por quem chama esta função via TAB_MODULE_KEY
  // (computeAccessibleTabIds) — aqui só a permissão do usuário.
  if (tabId === 'caixa') return user.permissions?.caixa === true;
  return user.permissions?.[tabId] !== false;
};

// Quem pode FINALIZAR o pagamento de uma mesa OU de um pedido de balcão
// (Task 4, módulo Caixa; extensão pro balcão na Task 5) — em vez de só pedir
// a conta (mesa) ou deixar qualquer um com a aba Balcão fechar a venda sem
// registrar nada (balcão). Já era genérica o bastante pra cobrir os dois
// (não recebe "table" nem "order" — só `user`/`store`), então a Task 5
// reaproveita esta MESMA função em CounterView em vez de escrever uma
// segunda regra: "one rule, both surfaces" (brief da Task 5). O MÓDULO da
// loja é o interruptor mestre, não a permissão do usuário isolada:
//
// - `modules.caixa === false` (o default — ver comentário de ALL_ON acima):
//   comportamento de hoje pra QUALQUER usuário com acesso à mesa, dono ou
//   não, existente ou futuro — ninguém fica restrito, exatamente como antes
//   desta feature existir. É esta linha (não a ausência de permissão em
//   store_users específicos) que garante "loja sem módulo caixa = sem
//   mudança nenhuma", inclusive pra um waiter que ainda nem foi criado
//   hoje. Confirmado em produção (2026-08-22): nenhuma das 7 lojas reais
//   tem `config.modules` — todas resolvem `caixa: false` por este default,
//   então esta função é sempre `true` nelas, sem depender de quem loga.
// - `modules.caixa === true` (só depois de o Master Admin ligar
//   explicitamente, ex.: Sertão na Task 5): a partir daí, só quem tem a
//   permissão `caixa` marcada (ou é dono/universal, bypass de sempre)
//   finaliza — todo o resto (inclusive um garçom recém-criado sem ninguém
//   pensar nisso) passa a só poder pedir a conta. É o comportamento novo
//   que o brief pede, e só existe onde foi pedido de propósito.
export const canFinalizeBill = (
  user: { role: string; permissions?: { caixa?: boolean } },
  store?: { config?: any } | null
): boolean => {
  if (user.role === 'owner' || user.role === 'universal') return true;
  if (!resolveStoreModules(store).caixa) return true;
  return user.permissions?.caixa === true;
};

// Jurisdicao de mesas por garcom (Task 3, 2026-08-23, migration 049 —
// resolucao-backlog-pendente). Mesmo formato de canFinalizeBill acima:
// restritivo só quando explicitamente configurado, nunca por default.
//
// Duas decisões de desenho já fechadas antes desta função existir (não
// re-derivar): (1) mesa fora da jurisdição continua VISÍVEL — quem chama
// isso decide o visual (opacidade/bloqueio), esta função só diz se a mesa
// é operável por este usuário; (2) mesa sem NENHUM garçom com jurisdição
// atribuída (o estado de toda mesa de toda loja real hoje) fica acessível
// pra todos — jurisdição é opt-in, nunca um buraco que orfanata mesa.
//
// `owner`/`universal` NUNCA são restringidos por jurisdição, mesmo padrão
// já usado em canFinalizeBill (dono/conta universal enxergam e agem em
// tudo, sempre) — jurisdição é um conceito de garçom/caixa em campo, não
// de quem administra a loja inteira.
export const isTableInJurisdiction = (
  user: { role: string; assigned_table_ids?: string[] | null },
  tableId: string
): boolean => {
  if (user.role === 'owner' || user.role === 'universal') return true;
  const ids = user.assigned_table_ids;
  if (!ids || ids.length === 0) return true;
  return ids.includes(tableId);
};

// true quando o perfil bate exatamente com o default "tudo ligado". Usado
// pelo Master Admin (AdminModule.tsx) pra decidir se grava `config.modules`/
// `config.order_flow` ou deixa as chaves ausentes — nunca grava o default
// explícito, porque ausência já SIGNIFICA "tudo ligado" (ver regra acima);
// gravar o default mesmo assim não quebraria nada (resolveStoreModules dá o
// mesmo resultado), mas manteria o config das lojas idêntico ao de hoje
// sempre que o lojista não mexer nos módulos.
export const isDefaultStoreModules = (modules: StoreModules): boolean =>
  (Object.keys(ALL_ON) as (keyof StoreModules)[]).every((k) => modules[k] === ALL_ON[k]);
