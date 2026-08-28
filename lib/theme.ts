// Fase 5, Task 18 (plano "Fora do Cardápio"): kit de identidade visual do
// cardápio do cliente — 4 presets FECHADOS (não é editor livre de tema,
// decisão consciente do plano: grande demais pra esta rodada). Cada preset
// só muda 3 coisas, sempre as mesmas 3 em todo lugar que usar este arquivo:
// - `displayFont`: fonte de destaque (nome da família + fallback), aplicada
//   via a CSS var `--theme-font-display` (ver app/globals.css).
// - `heroTexture`: `backgroundImage` CSS pro estado vazio da capa do
//   cardápio (ClientModule.tsx) — sempre um SVG/gradiente inline, nunca
//   upload de arquivo.
// - `categoryEmoji`: emoji fixo mostrado antes do nome de CADA aba de
//   categoria (o cardápio do cliente não tem ícone por categoria
//   individual desde o redesign iFood, só texto — isso não reintroduz
//   isso, é um selo do PRESET, igual pra toda categoria da loja).
// `accent_color` (já existente, stores.config) continua sendo a cor —
// tema aqui é só tipografia/textura/emoji, nunca reimplementa cor.
export type ThemePreset = 'classico' | 'pizzaria' | 'boteco' | 'praia';

export interface ThemeDefinition {
  label: string;
  displayFont: string;
  heroBackgroundImage: string;
  // Um valor de background-size por camada de heroBackgroundImage, na mesma
  // ordem — repeating-linear-gradient/SVG já definem o próprio passo de
  // repetição na sintaxe, então usam 'auto' aqui (um `100% 100%` esticaria
  // a textura e quebraria o padrão); só a camada de pontos (clássico)
  // precisa de um tamanho explícito.
  heroBackgroundSize: string;
  categoryEmoji: string | null;
}

const BRAND_WASH = 'linear-gradient(135deg, var(--ink), color-mix(in srgb, var(--ink) 82%, var(--brand)))';

export const THEME_PRESETS: Record<ThemePreset, ThemeDefinition> = {
  // Comportamento de sempre, textura de pontos já existente — nunca muda
  // pra loja que não escolheu nada (fallback natural, ver resolveThemePreset).
  classico: {
    label: 'Clássico',
    displayFont: "var(--font-sans-src)",
    heroBackgroundImage:
      'radial-gradient(circle, color-mix(in srgb, white 14%, transparent) 1px, transparent 1px), ' + BRAND_WASH,
    heroBackgroundSize: '16px 16px, 100% 100%',
    categoryEmoji: null,
  },
  // Trattoria: fonte redonda/robusta (Fredoka) e listras diagonais finas —
  // referência de toldo de pizzaria, sem cair no clichê vermelho/branco
  // literal (continua monocromático via color-mix, combina com qualquer
  // accent_color que a loja escolher).
  pizzaria: {
    label: 'Pizzaria',
    displayFont: "'Fredoka', var(--font-sans-src)",
    heroBackgroundImage:
      'repeating-linear-gradient(45deg, color-mix(in srgb, white 10%, transparent) 0px, color-mix(in srgb, white 10%, transparent) 10px, transparent 10px, transparent 24px), ' + BRAND_WASH,
    heroBackgroundSize: 'auto, 100% 100%',
    categoryEmoji: '🍕',
  },
  // Boteco de esquina: fonte manuscrita (Kalam, quadro-negro de bar) e
  // textura em xadrez cruzado (tampo de mesa/balcão).
  boteco: {
    label: 'Boteco',
    displayFont: "'Kalam', var(--font-sans-src)",
    heroBackgroundImage:
      'repeating-linear-gradient(45deg, color-mix(in srgb, white 8%, transparent) 0px, color-mix(in srgb, white 8%, transparent) 1px, transparent 1px, transparent 14px), ' +
      'repeating-linear-gradient(-45deg, color-mix(in srgb, white 8%, transparent) 0px, color-mix(in srgb, white 8%, transparent) 1px, transparent 1px, transparent 14px), ' + BRAND_WASH,
    heroBackgroundSize: 'auto, auto, 100% 100%',
    categoryEmoji: '🍺',
  },
  // Quiosque de praia: fonte leve/arredondada (Quicksand) e ondas suaves
  // (SVG inline, path senoidal repetido horizontalmente).
  praia: {
    label: 'Praia',
    displayFont: "'Quicksand', var(--font-sans-src)",
    heroBackgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='24'%3E%3Cpath d='M0 12 Q 15 0 30 12 T 60 12 T 90 12 T 120 12' fill='none' stroke='white' stroke-opacity='0.14' stroke-width='2'/%3E%3C/svg%3E\"), " + BRAND_WASH,
    heroBackgroundSize: 'auto, 100% 100%',
    categoryEmoji: '🌴',
  },
};

// `stores.config.theme_preset` é opcional/pode vir com um valor antigo
// inválido (loja nunca configurou, ou um valor futuro que essa versão do
// app ainda não conhece) — sempre cai em 'classico' em vez de quebrar.
export function resolveThemePreset(preset: string | null | undefined): ThemePreset {
  if (preset === 'pizzaria' || preset === 'boteco' || preset === 'praia') return preset;
  return 'classico';
}
