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
