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

export const ALL_ON: StoreModules = {
  tables: true, counter: true, kitchen_kds: true,
  bar_kds: true, caixa: true, menu: true, admin: true,
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

// Destino da impressão do ticket de cozinha/bar quando `order_flow ===
// 'direct_print'` (Task 2). Correção de design pedida antes da Task 3: a
// Task 2 sempre imprimia no aparelho de quem lançou o pedido — funciona
// quando o garçom carrega a impressora térmica junto (Bluetooth/USB no
// tablet), mas quebra na loja alvo, onde o garçom anda com o celular e a
// impressora fica fixa na cozinha (o aparelho dele não tem como imprimir
// lá). A Estação de Impressão (Task 3, ainda não construída) resolve isso:
// um aparelho fixo assina os pedidos novos via Realtime e imprime sozinho,
// TODO pedido, de qualquer origem (garçom, QR do cliente, Balcão) — não só
// os lançados por handleAddItem. Se os dois mecanismos dispararem juntos, o
// mesmo pedido sai impresso duas vezes; este campo decide qual dos dois é
// dono da impressão.
//
// Ausência de config = 'device' — preserva EXATAMENTE o que a Task 2 já
// entregou (imprime no aparelho de quem lançou) e mantém intacta a garantia
// de "loja sem config = comportamento de hoje" (nenhuma das 7 lojas reais
// tem isso configurado ainda).
export type PrintTarget = 'device' | 'station';

export const resolvePrintTarget = (store?: { config?: any } | null): PrintTarget =>
  store?.config?.print_target === 'station' ? 'station' : 'device';

// Mapa aba do painel do lojista -> chave do módulo correspondente em
// StoreModules. 'kitchen'/'bar' são os nomes históricos de aba/permissão
// (StoreUserPermissions), que mapeiam pros módulos mais específicos
// kitchen_kds/bar_kds (ver Passo 2 do brief da Task 1). Compartilhado entre
// StoreModule (canAccess, tab ativa) e StoreLayout (sidebar/bottom nav) pra
// não duplicar a regra em dois lugares.
export const TAB_MODULE_KEY: Record<string, keyof StoreModules> = {
  tables: 'tables',
  counter: 'counter',
  kitchen: 'kitchen_kds',
  bar: 'bar_kds',
  menu: 'menu',
  admin: 'admin',
};

// Mesma cascata usada em pickInitialStoreTab/canAccess/visibleTabs — extraída
// pra não duplicar a ordem em 3 lugares (era só um array solto repetido).
export const TAB_IDS = ['tables', 'counter', 'kitchen', 'bar', 'menu', 'admin'] as const;

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

// true quando o perfil bate exatamente com o default "tudo ligado". Usado
// pelo Master Admin (AdminModule.tsx) pra decidir se grava `config.modules`/
// `config.order_flow` ou deixa as chaves ausentes — nunca grava o default
// explícito, porque ausência já SIGNIFICA "tudo ligado" (ver regra acima);
// gravar o default mesmo assim não quebraria nada (resolveStoreModules dá o
// mesmo resultado), mas manteria o config das lojas idêntico ao de hoje
// sempre que o lojista não mexer nos módulos.
export const isDefaultStoreModules = (modules: StoreModules): boolean =>
  (Object.keys(ALL_ON) as (keyof StoreModules)[]).every((k) => modules[k] === ALL_ON[k]);
