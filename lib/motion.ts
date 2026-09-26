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

// SPRING_UI (redesign estilo Apple, plano aprovado pelo dono em 2026-09-26 —
// docs/superpowers/plans/2026-09-26-redesign-estilo-apple.md, Task 10):
// mola SEM sobra pra movimento de interface que não é folha — pílula do
// menu deslizando, janela no computador (scale 0.96→1), listas vivas se
// reorganizando. Folhas continuam com SPRING_SHEET (quique leve).
export const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.35 };

// Entrada/saída de item em lista viva (KDS, Balcão, fila do Caixa, Mesas).
// Chave estável por item é obrigatória: com polling/realtime, só o que
// entra ou sai anima — o resto só se reorganiza via `layout`.
export const LIST_ITEM_MOTION = {
  layout: true,
  initial: { opacity: 0, y: -12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: SPRING_UI,
} as const;
