// Trava de contraste da cor de destaque por loja (Task 6, stores.config.accent_color).
//
// O cardápio do cliente (ClientModule.tsx) só usa WINE_GOLD (dourado, '#D4AF5C')
// sobre um fundo que é sempre a superfície `.on-glass` — `--surface: #15171d`
// (ver app/globals.css), tanto no overlay de login (`rgba(10,13,19,0.8)` por
// trás do Card com `u-glass-modal`, que herda `.on-glass`) quanto no carrinho
// (`BottomSheet` com `u-glass-modal on-glass`). Não é uma suposição — é o valor
// real do token nesse contexto específico, por isso MENU_DARK_BG_HEX é esse hex
// fixo, não `--bg`/`--ink` do tema claro/escuro do resto do app.
//
// Fórmula: luminância relativa e razão de contraste do WCAG 2.1 (SC 1.4.3
// "Contrast Minimum"), não uma heurística aproximada tipo "soma RGB > X".
// Limiar escolhido: 4.5:1 — o mínimo da WCAG AA pra TEXTO NORMAL. O preço em
// destaque (`ClientModule.tsx`, `font-semibold text-sm`) é 14px, abaixo do
// corte de "texto grande" da WCAG (≥18.66px em negrito ou ≥24px normal, que
// permitiria relaxar pra 3:1) — então 4.5:1 é o piso correto pra esse uso, não
// um exagero de segurança.

export const MENU_DARK_BG_HEX = '#15171d';
export const MIN_ACCENT_CONTRAST_RATIO = 4.5;

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function isValidHexColor(hex: string): boolean {
  return HEX_RE.test(hex.trim());
}

function hexToRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex.trim());
  if (!m) throw new Error('Cor hex inválida.');
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// sRGB -> linear-light, por canal (WCAG 2.1 fórmula oficial de luminância relativa).
function channelToLinear(c8bit: number): number {
  const c = c8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [rl, gl, bl] = [r, g, b].map(channelToLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

// (L1 + 0.05) / (L2 + 0.05), com L1 sendo a luminância mais clara das duas —
// fórmula oficial WCAG 2.1, devolve sempre >= 1.
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface AccentColorCheck {
  legible: boolean;
  ratio: number;
  message?: string;
}

// Usado por `updateStoreAccentColor` (lib/api.ts) ANTES de persistir — recusa
// salvar, não é só um aviso visual no picker.
export function checkAccentColorContrast(hex: string): AccentColorCheck {
  if (!isValidHexColor(hex)) {
    return { legible: false, ratio: 0, message: 'Cor inválida. Use o seletor de cor.' };
  }
  const ratio = contrastRatio(hex, MENU_DARK_BG_HEX);
  if (ratio < MIN_ACCENT_CONTRAST_RATIO) {
    return {
      legible: false,
      ratio,
      message: `Essa cor fica pouco legível sobre o fundo escuro do cardápio (contraste ${ratio.toFixed(2)}:1 — mínimo exigido ${MIN_ACCENT_CONTRAST_RATIO}:1). Escolha uma cor mais clara ou mais saturada.`,
    };
  }
  return { legible: true, ratio };
}
