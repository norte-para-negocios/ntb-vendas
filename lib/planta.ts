// lib/planta.ts — planta de mesas: tudo em % do mapa (0–100), mapa em proporção 16:10.
export interface MesaPlanta { id: string; number: number; floor_x?: number | null; floor_y?: number | null; area?: string | null }
export interface Pos { id: string; x: number; y: number }

export const ASPECTO = 1.6;      // largura / altura do mapa (16:10)
export const MARGEM = 4;         // % livre nas bordas
export const CELULA_MIN_PX = 56; // alvo de toque 44 px + respiro

const round2 = (n: number) => Math.round(n * 100) / 100;
const temPos = (m: MesaPlanta) => m.floor_x != null && m.floor_y != null;

export function colunasIdeais(n: number): number {
  return Math.max(6, Math.ceil(Math.sqrt(Math.max(0, n) * ASPECTO)));
}

// Células quadradas em pixels: passo em Y (em % da altura) = passo em X (em % da largura) × ASPECTO.
const passos = (cols: number) => {
  const stepX = (100 - 2 * MARGEM) / cols;
  const stepY = stepX * ASPECTO;
  const linhas = Math.max(1, Math.floor((100 - 2 * MARGEM) / stepY + 1e-9));
  return { stepX, stepY, linhas };
};

export function larguraMinimaPx(cols: number): number {
  return Math.ceil((cols * CELULA_MIN_PX * 100) / (100 - 2 * MARGEM));
}

function tentar(faltam: MesaPlanta[], fixas: { x: number; y: number }[], cols: number): Pos[] | null {
  const { stepX, stepY, linhas } = passos(cols);
  const centro = (r: number, c: number) => ({ x: MARGEM + (c + 0.5) * stepX, y: MARGEM + (r + 0.5) * stepY });
  const ocupada = (r: number, c: number) => {
    const p = centro(r, c);
    return fixas.some((f) => Math.abs(f.x - p.x) < stepX * 0.75 && Math.abs(f.y - p.y) < stepY * 0.75);
  };
  const out: Pos[] = [];
  let r = 0;
  let c = 0;
  let areaAtual: string | undefined;
  for (const m of faltam) {
    const area = m.area ?? '';
    if (areaAtual !== undefined && area !== areaAtual && c > 0) { r += 1; c = 0; }
    areaAtual = area;
    while (ocupada(r, c)) { c += 1; if (c >= cols) { c = 0; r += 1; } }
    if (r >= linhas) return null;
    const p = centro(r, c);
    out.push({ id: m.id, x: round2(p.x), y: round2(p.y) });
    c += 1;
    if (c >= cols) { c = 0; r += 1; }
  }
  return out;
}

// Descobre em quantas colunas a grade salva foi desenhada: o menor nº de colunas em que TODAS as posições salvas
// caem no centro de uma célula (x e y). Sem posições salvas, ou sem grade que explique (arrasto antigo, livre), devolve null.
// Sem isso, o encaixe usava a grade "ideal" pelo nº de mesas, que difere da grade usada ao organizar com áreas.
export function colunasSalvas(mesas: MesaPlanta[]): number | null {
  const salvas = mesas.filter(temPos);
  if (salvas.length === 0) return null;
  const alinha = (v: number, ini: number, step: number) => { const k = (v - ini) / step - 0.5; return Math.abs(k - Math.round(k)) * step < 0.02; };
  // Vale a grade que explica a MAIORIA das posições (uma mesa solta fora de grade não pode derrubar a inferência).
  let melhor: { cols: number; n: number } | null = null;
  for (let cols = 6; cols <= 80; cols += 1) {
    const { stepX, stepY } = passos(cols);
    const n = salvas.filter((m) => alinha(Number(m.floor_x), MARGEM, stepX) && alinha(Number(m.floor_y), MARGEM, stepY)).length;
    if (n > (melhor?.n ?? 0)) melhor = { cols, n };
  }
  return melhor && melhor.n * 2 > salvas.length ? melhor.cols : null;
}

export function autoLayout(mesas: MesaPlanta[], opts: { soFaltantes?: boolean } = {}): { pos: Pos[]; cols: number } {
  const soFaltantes = opts.soFaltantes ?? true;
  const ordenadas = [...mesas].sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '', 'pt-BR') || a.number - b.number);
  const fixas = soFaltantes ? ordenadas.filter(temPos).map((m) => ({ x: Number(m.floor_x), y: Number(m.floor_y) })) : [];
  const faltam = soFaltantes ? ordenadas.filter((m) => !temPos(m)) : ordenadas;
  const base = (soFaltantes ? colunasSalvas(mesas) : null) ?? colunasIdeais(mesas.length);
  if (faltam.length === 0) return { pos: [], cols: base };
  for (let cols = base; cols <= 200; cols += 1) {
    const pos = tentar(faltam, fixas, cols);
    if (pos) return { pos, cols };
  }
  return { pos: [], cols: 200 }; // inalcançável com <= ~2000 mesas
}

export function resolverPosicoes(mesas: MesaPlanta[]): { posicoes: Map<string, { x: number; y: number; salva: boolean }>; cols: number; naoSalvas: number } {
  const { pos, cols } = autoLayout(mesas, { soFaltantes: true });
  const posicoes = new Map<string, { x: number; y: number; salva: boolean }>();
  mesas.filter(temPos).forEach((m) => posicoes.set(m.id, { x: Number(m.floor_x), y: Number(m.floor_y), salva: true }));
  pos.forEach((p) => posicoes.set(p.id, { x: p.x, y: p.y, salva: false }));
  return { posicoes, cols, naoSalvas: pos.length };
}

export function snap(x: number, y: number, cols: number): { x: number; y: number } {
  const { stepX, stepY, linhas } = passos(cols);
  const c = Math.max(0, Math.min(cols - 1, Math.round((x - MARGEM) / stepX - 0.5)));
  const r = Math.max(0, Math.min(linhas - 1, Math.round((y - MARGEM) / stepY - 0.5)));
  return { x: round2(MARGEM + (c + 0.5) * stepX), y: round2(MARGEM + (r + 0.5) * stepY) };
}

// Soltar a mesa `id` em `destino`: encaixa na grade; se já houver outra mesa ali, as duas trocam de lugar.
export function soltar(id: string, destino: { x: number; y: number }, atuais: Pos[], cols: number): Pos[] {
  const alvo = snap(destino.x, destino.y, cols);
  const { stepX, stepY } = passos(cols);
  const origem = atuais.find((p) => p.id === id);
  const ocupante = atuais.find((p) => p.id !== id && Math.abs(p.x - alvo.x) < stepX * 0.5 && Math.abs(p.y - alvo.y) < stepY * 0.5);
  const mov: Pos[] = [{ id, x: alvo.x, y: alvo.y }];
  if (ocupante && origem) mov.push({ id: ocupante.id, x: origem.x, y: origem.y });
  return mov;
}

export function areasDe(mesas: MesaPlanta[]): string[] {
  return Array.from(new Set(mesas.map((m) => (m.area ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Rótulo de cada área no canto superior esquerdo do bloco de mesas dela.
export function rotulosDeArea(mesas: MesaPlanta[], posicoes: Map<string, { x: number; y: number }>): { area: string; x: number; y: number }[] {
  return areasDe(mesas).map((area) => {
    const ps = mesas.filter((m) => (m.area ?? '').trim() === area).map((m) => posicoes.get(m.id)).filter((p): p is { x: number; y: number } => !!p);
    return { area, x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) };
  });
}

export function mesasNoIntervalo(mesas: MesaPlanta[], de: number, ate: number): string[] {
  const [a, b] = de <= ate ? [de, ate] : [ate, de];
  return mesas.filter((m) => m.number >= a && m.number <= b).sort((x, y) => x.number - y.number).map((m) => m.id);
}

export function dividirEmLotes<T>(itens: T[], tamanho = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}
