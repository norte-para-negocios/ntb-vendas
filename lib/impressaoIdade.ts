// Teto ABSOLUTO de idade para IMPRESSÃO AUTOMÁTICA (incidente de 04/10/2026).
//
// O que aconteceu: a impressão de itens de Pizzaria do Sertão ficou parada por
// um dia; depois do conserto a Estação de Impressão (CaixaPrintStation.tsx) viu
// todos os itens "não impressos" desde o corte de ativação antigo e imprimiu o
// backlog de ONTEM horas depois. A cozinha poderia preparar pedido de ontem.
// O catch-up de backlog existe de propósito (queda curta, reload do app), mas
// precisa de um limite que não dependa de corte salvo, dedupe ou ociosidade.
//
// Regra: item cujo `created_at` (relógio do SERVIDOR) é mais velho que
// MAX_IDADE_AUTOIMPRESSAO_MIN minutos NUNCA sai sozinho, em nenhum caminho
// automático. Ele continua listado em Pedidos do Dia / KDS como "Sem registro
// de impressão" e o botão manual Reimprimir continua funcionando (gesto humano
// decide). Esta função é pura: sem relógio, sem localStorage, sem rede.

export const MAX_IDADE_AUTOIMPRESSAO_MIN = 60;
export const MAX_IDADE_AUTOIMPRESSAO_MS = MAX_IDADE_AUTOIMPRESSAO_MIN * 60 * 1000;

export type MotivoIdade = 'ok' | 'antigo' | 'invalido';

export interface AvaliacaoIdade {
  pode: boolean;
  motivo: MotivoIdade;
  // Idade em ms já corrigida pelo offset do servidor; null quando o created_at é inválido.
  idadeMs: number | null;
}

// `offsetServidorMs` = (relógio do servidor) - (relógio do aparelho). Aparelho
// adiantado => offset negativo. Ausente/inválido = 0 (sem correção).
// "Mais velho que o teto" é estritamente maior: exatamente 60 min ainda imprime.
// created_at no futuro (aparelho atrasado) é recente: imprime.
// created_at inválido nunca imprime sozinho (não dá pra provar que é recente).
export function avaliarIdadeAutoImpressao(createdAtIso: unknown, agoraMs: number, offsetServidorMs?: number): AvaliacaoIdade {
  if (typeof createdAtIso !== 'string' || createdAtIso.trim() === '') return { pode: false, motivo: 'invalido', idadeMs: null };
  const criadoMs = Date.parse(createdAtIso);
  if (!Number.isFinite(criadoMs) || !Number.isFinite(agoraMs)) return { pode: false, motivo: 'invalido', idadeMs: null };
  const offset = typeof offsetServidorMs === 'number' && Number.isFinite(offsetServidorMs) ? offsetServidorMs : 0;
  const idadeMs = agoraMs + offset - criadoMs;
  return idadeMs > MAX_IDADE_AUTOIMPRESSAO_MS ? { pode: false, motivo: 'antigo', idadeMs } : { pode: true, motivo: 'ok', idadeMs };
}

export function podeImprimirAuto(createdAtIso: unknown, agoraMs: number, offsetServidorMs?: number): boolean {
  return avaliarIdadeAutoImpressao(createdAtIso, agoraMs, offsetServidorMs).pode;
}

export function particionarPorIdade<T extends { created_at?: unknown }>(
  itens: T[],
  agoraMs: number,
  offsetServidorMs?: number,
): { recentes: T[]; antigos: T[]; invalidos: T[] } {
  const recentes: T[] = [];
  const antigos: T[] = [];
  const invalidos: T[] = [];
  for (const it of itens) {
    const { motivo } = avaliarIdadeAutoImpressao(it.created_at, agoraMs, offsetServidorMs);
    if (motivo === 'ok') recentes.push(it);
    else if (motivo === 'antigo') antigos.push(it);
    else invalidos.push(it);
  }
  return { recentes, antigos, invalidos };
}
