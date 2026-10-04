// Permissões configuráveis por função (Gerente, Caixa, Garçom) — 04/10/2026.
// A matriz fica em stores.config.role_permissions (jsonb, sem migration).
// Sem configuração salva, os padrões reproduzem o comportamento de antes.
export type RoleKey = 'manager' | 'cashier' | 'waiter';
export type ActionKey =
  | 'cancelar_item' | 'trocar_mesa' | 'mover_item' | 'cancelar_pedido' | 'esgotar'
  | 'editar_planta' | 'ver_excecoes' | 'editar_cardapio' | 'editar_precos_horario';

export const ROLE_KEYS: RoleKey[] = ['manager', 'cashier', 'waiter'];
export const ROLE_TITLES: Record<RoleKey, string> = { manager: 'Gerente', cashier: 'Caixa', waiter: 'Garçom' };

export const ACTIONS: { key: ActionKey; label: string; desc: string }[] = [
  { key: 'cancelar_item', label: 'Cancelar item da comanda', desc: 'Remove um item já lançado (pede o motivo).' },
  { key: 'trocar_mesa', label: 'Trocar de mesa', desc: 'Move a conta inteira para outra mesa.' },
  { key: 'mover_item', label: 'Mover item para outra mesa', desc: 'Passa só um item para outra mesa, sem reimprimir.' },
  { key: 'cancelar_pedido', label: 'Cancelar o pedido da mesa', desc: 'Cancela todos os itens ainda não pagos.' },
  { key: 'esgotar', label: 'Marcar produto como esgotado', desc: 'Tira o produto do lançamento na hora.' },
  { key: 'editar_planta', label: 'Editar a planta de mesas', desc: 'Posiciona as mesas no mapa.' },
  { key: 'ver_excecoes', label: 'Ver exceções por operador', desc: 'Cancelamentos, taxas editadas, estornos e notas canceladas.' },
  { key: 'editar_cardapio', label: 'Editar o cardápio', desc: 'Produtos, preços, categorias e adicionais.' },
  { key: 'editar_precos_horario', label: 'Editar preço por horário', desc: 'Regras de happy hour.' },
];

const GERENTE: Record<ActionKey, boolean> = { cancelar_item: true, trocar_mesa: true, mover_item: true, cancelar_pedido: true, esgotar: true, editar_planta: true, ver_excecoes: true, editar_cardapio: true, editar_precos_horario: true };
const NADA: Record<ActionKey, boolean> = { cancelar_item: false, trocar_mesa: false, mover_item: false, cancelar_pedido: false, esgotar: false, editar_planta: false, ver_excecoes: false, editar_cardapio: false, editar_precos_horario: false };
export const DEFAULT_ROLE_PERMS: Record<RoleKey, Record<ActionKey, boolean>> = { manager: { ...GERENTE }, cashier: { ...NADA }, waiter: { ...NADA } };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizarMatriz(raw: unknown): Record<RoleKey, Record<ActionKey, boolean>> {
  const out = { manager: { ...DEFAULT_ROLE_PERMS.manager }, cashier: { ...DEFAULT_ROLE_PERMS.cashier }, waiter: { ...DEFAULT_ROLE_PERMS.waiter } };
  if (!isRecord(raw)) return out;
  ROLE_KEYS.forEach((r) => {
    const linha = raw[r];
    if (!isRecord(linha)) return;
    ACTIONS.forEach((a) => { if (typeof linha[a.key] === 'boolean') out[r][a.key] = linha[a.key] as boolean; });
  });
  return out;
}

// Valor salvo explicitamente (boolean) para função+ação, ou undefined se não há.
export function valorSalvo(raw: unknown, role: RoleKey, action: ActionKey): boolean | undefined {
  if (!isRecord(raw)) return undefined;
  const linha = raw[role];
  if (!isRecord(linha)) return undefined;
  return typeof linha[action] === 'boolean' ? (linha[action] as boolean) : undefined;
}

type UserLike = { role: string; permissions?: { trocas?: boolean; supervisiona_caixa?: boolean } & Record<string, any> };
type StoreLike = { config?: any } | null | undefined;

// Permissões por usuário que já existiam e continuam valendo para as ações que cobrem.
const COBERTAS: Record<string, ActionKey[]> = {
  trocas: ['cancelar_item', 'trocar_mesa', 'mover_item'],
  supervisiona_caixa: ['cancelar_pedido', 'ver_excecoes'],
};

function coberta(user: UserLike, action: ActionKey): boolean {
  return Object.keys(COBERTAS).some((k) => user.permissions?.[k] === true && COBERTAS[k].includes(action));
}

export function roleCan(user: UserLike, store: StoreLike, action: ActionKey): boolean {
  if (user.role === 'owner' || user.role === 'universal') return true;
  if (user.role === 'open') return false;
  if (coberta(user, action)) return true;
  if (!ROLE_KEYS.includes(user.role as RoleKey)) return false;
  return normalizarMatriz(store?.config?.role_permissions)[user.role as RoleKey][action];
}

// Para ações cujo comportamento de hoje depende de outra regra (ex.: permissão de aba):
// valor salvo na matriz vence; sem valor salvo, vale o comportamento legado informado.
export function roleCanOr(user: UserLike, store: StoreLike, action: ActionKey, legado: boolean): boolean {
  if (user.role === 'owner' || user.role === 'universal') return true;
  if (user.role === 'open') return false;
  if (coberta(user, action)) return true;
  if (ROLE_KEYS.includes(user.role as RoleKey)) {
    const salvo = valorSalvo(store?.config?.role_permissions, user.role as RoleKey, action);
    if (salvo !== undefined) return salvo;
  }
  return legado;
}

// ---- Matriz exibida e gravada na tela de Permissões ----
// Estas três, sem valor salvo, seguem a permissão de aba de cada pessoa (quem tem a aba Cardápio edita).
// Na matriz aparecem ligadas, que é o que acontece na prática para quem tem a aba.
export const SEGUE_ABA: ActionKey[] = ['esgotar', 'editar_cardapio', 'editar_precos_horario'];

const padraoEfetivo = (role: RoleKey, action: ActionKey): boolean => (SEGUE_ABA.includes(action) ? true : DEFAULT_ROLE_PERMS[role][action]);

export function matrizEfetiva(raw: unknown): Record<RoleKey, Record<ActionKey, boolean>> {
  const out = { manager: {} as Record<ActionKey, boolean>, cashier: {} as Record<ActionKey, boolean>, waiter: {} as Record<ActionKey, boolean> };
  ROLE_KEYS.forEach((r) => ACTIONS.forEach((a) => { out[r][a.key] = valorSalvo(raw, r, a.key) ?? padraoEfetivo(r, a.key); }));
  return out;
}

// Novo valor de stores.config.role_permissions depois de mudar UMA permissão.
// Grava só o que difere do efetivo; devolve undefined quando não sobra nada (a chave deve ser removida da config).
export function alterarPermissaoEsparso(raw: unknown, role: RoleKey, action: ActionKey, valor: boolean): Record<string, Record<string, boolean>> | undefined {
  const out: Record<string, Record<string, boolean>> = {};
  ROLE_KEYS.forEach((r) => {
    const linha: Record<string, boolean> = {};
    ACTIONS.forEach((a) => { const v = valorSalvo(raw, r, a.key); if (v !== undefined) linha[a.key] = v; });
    if (Object.keys(linha).length > 0) out[r] = linha;
  });
  const linha = { ...(out[role] ?? {}) };
  if (valor === padraoEfetivo(role, action)) delete linha[action]; else linha[action] = valor;
  if (Object.keys(linha).length > 0) out[role] = linha; else delete out[role];
  return Object.keys(out).length > 0 ? out : undefined;
}
