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
// 24/10/2026: a cor da loja virou a cor dos BOTÕES e detalhes (substitui o azul da marca), com letra branca dentro do
// botão; o texto do cardápio continua preto. A trava agora confere a letra branca sobre a cor (3:1, texto de botão em
// negrito); antes testava a cor como texto sobre fundo escuro e recusava vermelho.
export const MIN_BOTAO_CONTRAST_RATIO = 3;
export function checkAccentColorContrast(hex: string): AccentColorCheck {
  if (!isValidHexColor(hex)) {
    return { legible: false, ratio: 0, message: 'Cor inválida. Use o seletor de cor.' };
  }
  // Cor clara não é mais recusada: corParaBotao escurece no mesmo tom até a letra branca ficar legível.
  return { legible: true, ratio: contrastRatio(corParaBotao(hex), '#ffffff') };
}

// Cor que vai de verdade nos botões: a escolhida, escurecida no mesmo tom só até a letra branca ficar legível (3:1).
// 24/10/2026: em vez de recusar cor clara (bege recusado na ODARA), ajusta sozinho.
export function corParaBotao(hex: string): string {
  if (!isValidHexColor(hex)) return hex;
  let [r, g, b] = hexToRgb(hex);
  const paraHex = (x: number, y: number, z: number) => '#' + [x, y, z].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 40 && contrastRatio(paraHex(r, g, b), '#ffffff') < MIN_BOTAO_CONTRAST_RATIO; i++) {
    r *= 0.94; g *= 0.94; b *= 0.94;
  }
  return paraHex(r, g, b);
}
