// Presets de spring validados com o usuário no companion visual de
// brainstorming (2026-08-16, cardápio do cliente) e agora compartilhados
// com o resto do app (lojista/admin, 2026-08-16). Não são valores
// arbitrários — não criar um terceiro preset sem passar pelo mesmo
// processo de validação visual.
// SPRING_TAP: feedback de toque, sem bounce (damping 1.0 da Apple — botão
// não carrega momentum de gesto).
// SPRING_SHEET: abrir/fechar/arrastar de folha e acordeão, bounce leve
// (~damping 0.82, bate com o valor que a Apple documenta pra drawer/sheet).
export const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 };
export const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 };
