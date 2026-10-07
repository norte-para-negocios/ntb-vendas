// lib/estoqueConexao.ts — "Testar conexão" da aba Integrações (Administração > Configurações).
// Duas leituras inofensivas ao Estoque, nenhuma cria nada nem chama o Omie:
//   GET /api/integracao/locais-estoque  (valida URL + chave; já existe em qualquer versão do Estoque)
//   GET /api/integracao/status          (nome da loja, se é de teste/simulada, se tem chave Omie; só no Estoque novo)
// Puro (sem rede) para ser testado: scripts/testes/estoqueConexao.test.ts.

import { normalizarModo, type ModoEstoque } from '@/lib/modoEstoque';

export type EstadoConexao = 'ok' | 'chave_invalida' | 'fora_do_ar' | 'url_errada' | 'erro_estoque';

export interface LeituraEstoque { status: number | null; erroRede?: string; json?: unknown }

export interface ResumoConexao {
  estado: EstadoConexao;
  mensagem: string;
  /** Loja do Estoque é de teste/simulada: nada vai ao Omie real. null = não sei (Estoque antigo). */
  simulada: boolean | null;
  /** A loja do Estoque tem chave do Omie real. null = não sei. */
  omieReal: boolean | null;
  nome: string | null;
  versaoAntiga: boolean;
  locais: number;
  /** Modo de estoque da loja ('omie' quando não informado): fora do Omie nenhuma mensagem cita o Omie. */
  modo: ModoEstoque;
}

const base: ResumoConexao = { estado: 'ok', mensagem: '', simulada: null, omieReal: null, nome: null, versaoAntiga: false, locais: 0, modo: 'omie' };

export function resumirConexao(locais: LeituraEstoque, status: LeituraEstoque | null, modoLoja?: unknown): ResumoConexao {
  const modo = normalizarModo(modoLoja);
  const r = resumirConexaoOmie(locais, status);
  if (modo === 'omie') return r;
  // Estoque próprio / sem estoque: o Omie não existe para esta loja (nunca avisa de chave do Omie nem de "Omie real").
  const mensagem = r.estado === 'ok' ? (r.simulada ? 'MODO TESTE — as saídas desta loja são simuladas.' : r.versaoAntiga ? 'Conexão ok (versão antiga do Estoque).' : 'Conexão ok.') : r.mensagem;
  return { ...r, mensagem, omieReal: null, modo };
}

function resumirConexaoOmie(locais: LeituraEstoque, status: LeituraEstoque | null): ResumoConexao {
  if (locais.status === null) return { ...base, estado: 'fora_do_ar', mensagem: `Estoque fora do ar ou URL inacessível${locais.erroRede ? ` (${locais.erroRede})` : ''}.` };
  if (locais.status === 401 || locais.status === 403) return { ...base, estado: 'chave_invalida', mensagem: 'A chave de integração foi recusada pelo Estoque. Gere uma nova no Estoque (Loja → Integração com Norte Vendas) e cole aqui.' };
  if (locais.status === 404) return { ...base, estado: 'url_errada', mensagem: 'O endereço respondeu, mas não é o Norte Estoque (rota de integração não encontrada). Confira a URL.' };
  if (locais.status !== 200) return { ...base, estado: 'erro_estoque', mensagem: `O Estoque respondeu com erro (HTTP ${locais.status}).` };
  const lista = (locais.json as { locais?: unknown } | null)?.locais;
  if (!Array.isArray(lista)) return { ...base, estado: 'url_errada', mensagem: 'O endereço respondeu, mas não parece ser o Norte Estoque. Confira a URL.' };

  const st = status?.status === 200 ? (status.json as { nome?: unknown; simulada?: unknown; omieReal?: unknown } | null) : null;
  if (!st || typeof st.simulada !== 'boolean') {
    return { ...base, locais: lista.length, versaoAntiga: true, mensagem: 'Conexão ok (versão antiga do Estoque, não sei se é teste).' };
  }
  const nome = typeof st.nome === 'string' ? st.nome : null;
  const omieReal = typeof st.omieReal === 'boolean' ? st.omieReal : null;
  const mensagem = st.simulada
    ? 'MODO TESTE — nada vai para o Omie real.'
    : omieReal === false
      ? 'Conexão ok, mas a loja do Estoque está sem chave do Omie: nada vai para o Omie.'
      : 'Conexão ok.';
  return { ...base, locais: lista.length, nome, simulada: st.simulada, omieReal, mensagem };
}
