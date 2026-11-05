// lib/avisoDestino.ts — para onde um aviso do sino leva ao ser tocado. Puro (sem React, sem I/O).
import type { TipoNotificacao } from './notificacoes';
import type { AbaId } from './adminNav';

export interface DestinoAviso {
  tab: 'admin';
  /** Aba interna da Administração. */
  aba: AbaId;
  /** id do elemento onde a tela rola e se destaca (opcional). */
  secao?: string;
  /** Texto para quem não tem acesso à Administração. */
  semAcesso: string;
}

const DESTINOS: Partial<Record<TipoNotificacao, DestinoAviso>> = {
  baixa_estoque_erro: {
    tab: 'admin', aba: 'integracoes', secao: 'baixas-estoque',
    semAcesso: 'Peça ao gerente para conferir em Administração › Configurações › Integrações.',
  },
  nota_rejeitada: {
    tab: 'admin', aba: 'notas',
    semAcesso: 'Peça ao gerente para conferir em Administração › Vendas › Notas fiscais.',
  },
};

export function destinoDoAviso(tipo: TipoNotificacao): DestinoAviso | null {
  return DESTINOS[tipo] ?? null;
}
