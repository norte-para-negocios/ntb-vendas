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
  if (!m || typeof m !== 'object') return ALL_ON;
  return { ...ALL_ON, ...m };
};

export const resolveOrderFlow = (store?: { config?: any } | null): OrderFlow =>
  store?.config?.order_flow === 'direct_print' ? 'direct_print' : 'kds';

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

// true quando o perfil bate exatamente com o default "tudo ligado". Usado
// pelo Master Admin (AdminModule.tsx) pra decidir se grava `config.modules`/
// `config.order_flow` ou deixa as chaves ausentes — nunca grava o default
// explícito, porque ausência já SIGNIFICA "tudo ligado" (ver regra acima);
// gravar o default mesmo assim não quebraria nada (resolveStoreModules dá o
// mesmo resultado), mas manteria o config das lojas idêntico ao de hoje
// sempre que o lojista não mexer nos módulos.
export const isDefaultStoreModules = (modules: StoreModules): boolean =>
  (Object.keys(ALL_ON) as (keyof StoreModules)[]).every((k) => modules[k] === ALL_ON[k]);
