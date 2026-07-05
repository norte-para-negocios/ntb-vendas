export const ROLE_LABELS: Record<string, string> = {
    owner: 'Dono / Gerente',
    manager: 'Gerente',
    waiter: 'Garçom',
    cook: 'Cozinheiro',
    attendant: 'Atendente',
    kitchen: 'Cozinha',
    bar: 'Bar',
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
