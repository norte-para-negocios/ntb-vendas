export const ROLE_LABELS: Record<string, string> = {
    owner: 'Dono / Gerente',
    manager: 'Gerente',
    waiter: 'Garçom',
    cook: 'Cozinheiro',
    attendant: 'Atendente',
    kitchen: 'Cozinha',
    bar: 'Bar',
    // Módulo Caixa (Task 4, plano 2026-08-22-perfis-de-loja-e-caixa) — papel
    // novo, além da permissão `caixa` em si (StoreUserPermissions). Um
    // usuário pode ter role='cashier' com a permissão 'caixa' marcada, ou
    // (menos comum) qualquer outro role com a permissão marcada à parte —
    // o role aqui é só rótulo/organização, quem decide poder de finalizar é
    // sempre a permissão (ver lib/storeModules.ts, canFinalizeBill).
    cashier: 'Caixa',
};

export const getRoleLabel = (role: string): string => ROLE_LABELS[role] || role;

export const TABLE_STATUS_LABELS: Record<string, string> = {
    available: 'Livre',
    occupied: 'Ocupada',
    waiting_bill: 'Pediu Conta',
    blocked: 'Bloqueada',
    closed: 'Fechada',
};

export const getTableStatusLabel = (status: string): string => TABLE_STATUS_LABELS[status] || status;

// Jurisdicao de mesas por garcom (Task 3, migration 049) — texto do badge
// mostrado numa mesa fora da area atribuida ao usuario logado (TablesView).
export const TABLE_OUT_OF_JURISDICTION_LABEL = 'Fora da sua área';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
    CREDIT: 'Crédito',
    DEBIT: 'Débito',
    PIX: 'PIX',
    CASH: 'Dinheiro',
    COURTESY: 'Cortesia',
    MULTIPLE: 'Dividido',
};

export const getPaymentMethodLabel = (method?: string | null): string =>
    method ? (PAYMENT_METHOD_LABELS[method] || method) : 'Não especificado';

// Bandeiras de cartão (Task 4, módulo Caixa) — catálogo fechado, mesmo
// princípio de PRODUCT_TAGS abaixo: evita texto livre no comprovante
// impresso (que já é obrigado a escapar campo livre, ver lib/print.ts) e
// mantém consistência visual no modal de pagamento e no relatório de vendas.
// Só se aplica a CREDIT/DEBIT — PIX/CASH/COURTESY nunca têm bandeira.
export const CARD_BRAND_LABELS: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    elo: 'Elo',
    amex: 'Amex',
    hipercard: 'Hipercard',
    outro: 'Outra',
};

export const getCardBrandLabel = (brand?: string | null): string =>
    brand ? (CARD_BRAND_LABELS[brand] || brand) : '';

// Catalogo fixo de etiquetas/badges de produto (migration 019). Armazenado
// como products.tags (text[]) com essas chaves; a UI (lojista e cliente) so'
// oferece este catalogo, nunca texto livre — consistencia visual. Ver
// AGENTS.md (secao cardapio-que-vende). PRODUCT_TAGS e' a fonte unica: o
// seletor de tags do lojista e a exibicao de badges no cardapio leem daqui.
export const PRODUCT_TAGS: Record<string, { label: string; emoji: string }> = {
    picante:      { label: 'Picante',      emoji: '🌶️' },
    vegano:       { label: 'Vegano',       emoji: '🌱' },
    vegetariano:  { label: 'Vegetariano',  emoji: '🥬' },
    sem_gluten:   { label: 'Sem Glúten',   emoji: '🌾' },
    sem_lactose:  { label: 'Sem Lactose',  emoji: '🥛' },
    novo:         { label: 'Novo',         emoji: '✨' },
    da_casa:      { label: 'Da Casa',      emoji: '⭐' },
};

// {label, emoji} de uma chave de tag, com fallback pra chave crua (mesmo
// principio dos getters de enum acima: nunca deixar valor cru vazar pra tela
// sem um formato previsivel). Tag desconhecida (ex.: removida do catalogo mas
// ainda gravada num produto antigo) volta como label = a propria chave e sem
// emoji, em vez de quebrar a UI.
export const getTagDisplay = (tag: string): { label: string; emoji: string } =>
    PRODUCT_TAGS[tag] || { label: tag, emoji: '' };

export const getTagLabel = (tag: string): string => getTagDisplay(tag).label;

// Nome de exibição de um item de PEDIDO (histórico/impressão/KDS), com
// adicionais entre parênteses — nunca travessão (regra do projeto).
// Formato: "Pizza Marguerita (Catupiry)" ou, com múltiplos adicionais,
// "Pizza Quatro Queijos (Catupiry, Bacon Extra)".
export const getOrderItemDisplayName = (
    item: { product?: { name: string } | null; selected_options?: { name: string }[] | null },
    fallback = 'Produto Indisponível',
): string => {
    const base = item.product?.name || fallback;
    const opts = item.selected_options || [];
    return opts.length > 0 ? `${base} (${opts.map(o => o.name).join(', ')})` : base;
};

// Nome de exibição de um item do CARRINHO (antes de virar pedido), mesmo
// formato de getOrderItemDisplayName ("Produto (Adicional1, Adicional2)"),
// mas pro shape de CartItem/SelectedOption — que tem group_id/option_id
// além de name/price_delta, ao contrário de OrderItem.selected_options
// (snapshot pós-pedido, só name/price_delta, sem ids). Ver a nota de
// assimetria proposital em types/index.ts (comentário de SelectedOption):
// são estágios de vida diferentes do mesmo dado, por isso duas funções em
// vez de uma só reaproveitada.
export const getCartItemDisplayName = (
    item: { product?: { name: string } | null; selectedOptions?: { name: string }[] | null },
    fallback = 'Produto Indisponível',
): string => {
    const base = item.product?.name || fallback;
    const opts = item.selectedOptions || [];
    return opts.length > 0 ? `${base} (${opts.map(o => o.name).join(', ')})` : base;
};
