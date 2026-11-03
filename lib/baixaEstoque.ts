// lib/baixaEstoque.ts — regras puras do outbox da baixa de estoque (Vendas -> Estoque -> Omie).
//
// POR QUE a regra de reenvio é tão conservadora: a criação da Ordem de Produção no Estoque NÃO é idempotente
// (ntb-estoque lib/vendas-integracao.ts monta cCodIntOP = `NTBV${Date.now()}${i}`; o pedido só entra no texto da
// observação) e a saída de estoque (movimentos) também não deduplica por pedido. Reenviar um item que o Estoque
// chegou a processar cria OP/saída em duplicidade. Por isso:
//   - 'ok'      : o Estoque processou (a fila/cron DELE cuida do que ficou pendente). Nunca reenvia.
//   - 'erro'    : comprovadamente NADA foi gravado (retentavel=true) -> pode reenviar sozinho, com backoff.
//   - 'incerto' : pode ter gravado (timeout, 5xx, OP criada sem a saída...) -> NUNCA reenvia sozinho; o gerente confere.
// Sem dependência de Supabase/Next: testado em scripts/testes/baixaEstoque.test.ts.

export type StatusItem = 'ok' | 'erro' | 'incerto';
export type StatusBaixa = 'pending' | 'ok' | 'parcial' | 'erro' | 'incerto';

/** Tentativas automáticas por baixa; depois disso só o gerente ("Tentar de novo") reabre. */
export const MAX_TENTATIVAS = 6;

/** Item como enviado ao Estoque (mesmo formato de POST /api/integracao/ordem-producao). */
export interface ItemBaixa {
  codigo: string;
  quantidade: number;
  destination?: 'kitchen' | 'bar' | null;
  setor?: string | null;
  localEstoque?: number | null;
  comNota?: boolean;
}

export interface ResultadoItem {
  codigo: string;
  status: StatusItem;
  /** Só 'erro' pode ser reenviado sozinho. */
  retentavel: boolean;
  tentativas: number;
  erro?: string;
  detalhe?: string;
  nCodOP?: number;
  op?: string;
  baixa?: string;
  /** Início do envio que gerou este resultado (02/11/2026; resultados antigos não têm). */
  enviadoEm?: string;
}

/** Item como o Estoque devolve (loja real: com op/baixa; loja de teste: só ok/nCodOP/erro). */
export interface RespostaItemEstoque {
  codigo?: string;
  ok?: boolean;
  nCodOP?: number;
  op?: 'criada' | 'sem_estrutura' | 'na_fila' | 'erro' | 'pulada';
  baixa?: string;
  erro?: string;
}

type Classificacao = Pick<ResultadoItem, 'status' | 'retentavel' | 'erro' | 'detalhe' | 'nCodOP' | 'op' | 'baixa'>;

const SEM_ESTRUTURA = /n.o possui nenhum item na sua estrutura|estrutura preenchida|sem estrutura/i;
const SEM_LOCAL = 'sem local de estoque';

const incerto = (r: RespostaItemEstoque, erro: string, detalhe?: string): Classificacao =>
  ({ status: 'incerto', retentavel: false, erro, detalhe, nCodOP: r.nCodOP, op: r.op, baixa: r.baixa });
const falhaRetentavel = (r: RespostaItemEstoque, erro: string): Classificacao =>
  ({ status: 'erro', retentavel: true, erro, nCodOP: r.nCodOP, op: r.op, baixa: r.baixa });
const certo = (r: RespostaItemEstoque, detalhe?: string): Classificacao =>
  ({ status: 'ok', retentavel: false, detalhe, nCodOP: r.nCodOP, op: r.op, baixa: r.baixa });

export function classificarItemEstoque(r: RespostaItemEstoque): Classificacao {
  const erro = r.erro || undefined;

  // Loja de TESTE do Estoque: resposta sem op/baixa.
  if (r.op === undefined) {
    if (r.ok) return certo(r);
    if (erro && SEM_ESTRUTURA.test(erro)) return certo(r, 'Produto sem estrutura (revenda): só a saída.');
    if (r.nCodOP) return incerto(r, erro ?? 'OP criada mas a conclusão falhou', 'A OP existe no Omie; reenviar duplicaria.');
    return falhaRetentavel(r, erro ?? 'Falha ao baixar o item');
  }

  switch (r.op) {
    case 'pulada':
      // O Estoque nem tentou (produto sem cadastro lá, item inválido): nada foi gravado.
      return falhaRetentavel(r, erro ?? 'O Estoque não processou o item');
    case 'erro':
      // OP recusada SEM nº e sem nenhuma saída (sem local): comprovadamente nada gravado.
      if (!r.nCodOP && r.baixa === SEM_LOCAL && !/n.o retornou a op/i.test(erro ?? '')) return falhaRetentavel(r, erro ?? 'O Omie recusou a OP');
      // Caso contrário a saída pode ter sido gravada, ou a OP criada e não concluída.
      return incerto(r, erro ?? 'Falha na ordem de produção', 'A OP ou a saída podem ter sido gravadas no Estoque; confira antes de reenviar.');
    case 'sem_estrutura':
      // Sem OP (revenda) e sem local: nem OP nem saída foram gravadas.
      if (r.baixa === SEM_LOCAL) return falhaRetentavel(r, 'Sem local de estoque para a saída (configure em Locais de preparo ou no Estoque)');
      return certo(r, 'Produto sem estrutura (revenda): só a saída.');
    case 'criada':
    case 'na_fila':
      // OP criada (ou na fila do Estoque) mas a saída não saiu por falta de local: reenviar criaria outra OP.
      if (r.baixa === SEM_LOCAL) return incerto(r, 'OP criada, mas sem local de estoque para a saída', 'Faça a saída no Estoque ou configure o local; não reenvie (duplicaria a OP).');
      return certo(r, r.op === 'na_fila' ? 'OP na fila do Estoque (ele reenvia sozinho).' : r.baixa && r.baixa !== 'Concluido' ? `Saída em ${r.baixa}: o Estoque tenta de novo sozinho.` : undefined);
    default:
      return incerto(r, erro ?? 'Resposta desconhecida do Estoque');
  }
}

// Falha antes de qualquer resposta HTTP. Só é "não chegou lá" quando a conexão nem foi estabelecida.
const NAO_CHEGOU = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH']);
export function classificarErroDeRede(err: unknown): { ambiguo: boolean; mensagem: string } {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } } | null;
  // localhost/IPv4+IPv6: o undici devolve um AggregateError com um código por endereço; só é "não chegou" se TODOS são.
  const lista = e?.cause?.errors?.map((x) => x.code).filter((c): c is string => !!c) ?? [];
  const code = lista.length && lista.every((c) => NAO_CHEGOU.has(c)) ? lista[0] : (e?.cause?.code ?? (e as { code?: string } | null)?.code);
  const nome = e?.name ?? '';
  if (nome === 'TimeoutError' || nome === 'AbortError') return { ambiguo: true, mensagem: 'O Estoque não respondeu a tempo (pode ter processado)' };
  if (code && NAO_CHEGOU.has(code)) return { ambiguo: false, mensagem: `Estoque fora do ar (${code})` };
  return { ambiguo: true, mensagem: `Falha de rede no meio do envio${code ? ` (${code})` : ''}: ${e?.message ?? 'erro desconhecido'}` };
}

const comTentativa = (c: Classificacao, codigo: string, tentativas: number): ResultadoItem => ({ codigo, tentativas, ...c });

/** Resposta HTTP inteira do Estoque -> resultado por item enviado (mesma ordem de `codigosEnviados`). */
export function interpretarResposta(status: number, json: unknown, codigosEnviados: string[], tentativas = 1): ResultadoItem[] {
  const corpo = (json ?? null) as { resultados?: RespostaItemEstoque[]; error?: string } | null;
  if (status === 200 && Array.isArray(corpo?.resultados)) {
    return codigosEnviados.map((codigo, i) => {
      const r = corpo!.resultados![i];
      if (!r) return comTentativa(incerto({}, 'O Estoque não devolveu o resultado deste item', 'Confira no Estoque antes de reenviar.'), codigo, tentativas);
      return comTentativa(classificarItemEstoque(r), codigo, tentativas);
    });
  }
  const msg = corpo?.error || `O Estoque respondeu HTTP ${status}`;
  if (status === 200) {
    return codigosEnviados.map((codigo) => comTentativa(incerto({}, 'Resposta do Estoque sem a lista de itens', 'Confira no Estoque antes de reenviar.'), codigo, tentativas));
  }
  // 4xx: recusado antes de processar (chave inválida, rota/URL errada): reenviar depois é seguro.
  if (status >= 400 && status < 500) return codigosEnviados.map((codigo) => comTentativa(falhaRetentavel({}, msg), codigo, tentativas));
  // 5xx: a rota pode ter rodado parte dos itens antes de cair.
  return codigosEnviados.map((codigo) => comTentativa(incerto({}, msg, 'O Estoque pode ter processado parte dos itens; confira antes de reenviar.'), codigo, tentativas));
}

/** Falha de transporte (sem resposta HTTP) -> resultado por item. */
export function resultadoDeFalhaDeRede(err: unknown, codigosEnviados: string[], tentativas = 1): ResultadoItem[] {
  const { ambiguo, mensagem } = classificarErroDeRede(err);
  return codigosEnviados.map((codigo) => comTentativa(
    ambiguo ? incerto({}, mensagem, 'Pode ter chegado ao Estoque; confira antes de reenviar.') : falhaRetentavel({}, mensagem),
    codigo, tentativas,
  ));
}

export function mesclarResultados(atual: (ResultadoItem | null)[], indices: number[], novos: ResultadoItem[]): (ResultadoItem | null)[] {
  const out = atual.slice();
  indices.forEach((idx, k) => {
    const n = novos[k];
    if (!n) return;
    const antes = atual[idx];
    out[idx] = { ...n, tentativas: Math.max(n.tentativas, (antes?.tentativas ?? 0) + (antes ? 1 : 0), 1) };
  });
  return out;
}

export function statusDaBaixa(resultado: (ResultadoItem | null)[], totalItens: number): StatusBaixa {
  if (totalItens === 0) return 'ok';
  const itens = Array.from({ length: totalItens }, (_, i) => resultado[i] ?? null);
  if (itens.some((r) => r === null)) return 'pending';
  const lista = itens as ResultadoItem[];
  const erros = lista.filter((r) => r.status === 'erro').length;
  const incertos = lista.filter((r) => r.status === 'incerto').length;
  if (erros === 0 && incertos === 0) return 'ok';
  if (erros === 0) return 'incerto';
  return erros === lista.length ? 'erro' : 'parcial';
}

/** Índices que podem ir ao Estoque agora: nunca enviados, ou com erro comprovadamente não gravado. */
export function indicesParaReenviar(resultado: (ResultadoItem | null)[], totalItens: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < totalItens; i++) {
    const r = resultado[i];
    if (!r || (r.status === 'erro' && r.retentavel)) out.push(i);
  }
  return out;
}

/** Espera até a próxima tentativa automática: 2, 4, 8, 16, 32 e no máximo 60 min. */
export function proximaTentativa(tentativas: number, agora: number = Date.now()): Date {
  const min = Math.min(60, 2 ** Math.max(1, tentativas));
  return new Date(agora + min * 60000);
}

/** O gerente conferiu no Estoque: o que estava incerto passa a ok (fica registrado quem). */
export function marcarIncertosComoConferidos(resultado: (ResultadoItem | null)[], quem: string): (ResultadoItem | null)[] {
  return resultado.map((r) => (r && r.status === 'incerto'
    ? { ...r, status: 'ok' as const, retentavel: false, detalhe: `Conferido no Estoque por ${quem}`, erro: undefined }
    : r));
}

/** O servidor caiu durante um envio: o que estava em voo pode ter sido gravado -> incerto. */
export function marcarEnvioInterrompido(resultado: (ResultadoItem | null)[], indices: number[], itens: { codigo: string }[]): (ResultadoItem | null)[] {
  const out = resultado.slice();
  for (const i of indices) {
    out[i] = {
      codigo: itens[i]?.codigo ?? out[i]?.codigo ?? '?',
      status: 'incerto', retentavel: false, tentativas: Math.max(1, out[i]?.tentativas ?? 0),
      erro: 'O envio foi interrompido (servidor reiniciou); o Estoque pode ter processado',
      detalhe: 'Confira no Estoque antes de reenviar.',
    };
  }
  return out;
}

/** Texto curto do problema da baixa para lista e sino. */
export function resumoDoErro(resultado: (ResultadoItem | null)[]): string {
  const ruins = resultado.filter((r): r is ResultadoItem => !!r && r.status !== 'ok');
  if (!ruins.length) return '';
  const r = ruins[0];
  const prefixo = ruins.length > 1 ? `${ruins.length} itens: ` : `${r.codigo}: `;
  return `${prefixo}${r.erro ?? r.detalhe ?? 'falha'}`.slice(0, 200);
}

// ---------------------------------------------------------------------------------------------- incerto por timeout
// 02/11/2026: 341 baixas do Sertão em 30 dias ficaram 'incerto' porque o Estoque demorou mais que o timeout (150 s) e
// ninguém conferia. O Estoque novo registra cada pedido ANTES de mexer no estoque e responde
// GET /api/integracao/ordem-producao/status?pedidoRef= (ntb-estoque lib/vendas/registro-pedido-venda.ts). Aqui decide,
// item a item, o que fazer com um incerto POR TIMEOUT. Regra de ouro: reenviar só com PROVA de que nada foi gravado
// (reenvio de baixa já processada = baixa em dobro no Omie). Qualquer dúvida = continua incerto.

/** Início da mensagem gravada por classificarErroDeRede para timeout (só esses são conferidos sozinhos). */
export const MSG_INCERTO_TIMEOUT = 'O Estoque não respondeu a tempo';
/** Folga para a diferença de relógio entre o servidor do Vendas e o do Estoque. */
export const MARGEM_RELOGIO_MS = 5 * 60 * 1000;
/** Só confere incerto com mais de 10 min (o Estoque pode ainda estar processando o envio que estourou o tempo). */
export const IDADE_MINIMA_CONFERENCIA_MS = 10 * 60 * 1000;

export function ehIncertoPorTimeout(r: ResultadoItem | null | undefined): boolean {
  return !!r && r.status === 'incerto' && (r.erro ?? '').startsWith(MSG_INCERTO_TIMEOUT);
}

export interface EnvioNoEstoque { recebidoEm: string; concluidoEm: string | null; itens: (RespostaItemEstoque & { codigo: string })[] }
export interface StatusPedidoNoEstoque {
  versao: number; primeiroRegistro: string | null; ultimoRegistro: string | null; envios: EnvioNoEstoque[];
}

export type DecisaoIncerto =
  | { acao: 'ok' | 'erro'; motivo: string; resultado: ResultadoItem }
  | { acao: 'manter'; motivo: string; reverEmMin: number };

const manter = (motivo: string, reverEmMin = 30): DecisaoIncerto => ({ acao: 'manter', motivo, reverEmMin });

function statusValido(s: unknown): s is StatusPedidoNoEstoque {
  const x = s as StatusPedidoNoEstoque | null;
  return !!x && x.versao === 1 && Array.isArray(x.envios)
    && x.envios.every((e) => e && typeof e.recebidoEm === 'string' && Array.isArray(e.itens));
}

/**
 * O que fazer com UM item incerto por timeout, dada a resposta de status do Estoque.
 * `enviadoEm` = início do envio que estourou o tempo (ResultadoItem.enviadoEm ou integracao_baixas.iniciada_em).
 *  - envio do item ainda sem conclusão no Estoque -> manter (processando ou interrompido no meio);
 *  - último envio concluído com o item: resultado ok -> 'ok'; resultado incerto ou sem resultado -> manter;
 *  - resultado de "nada gravado" ou envio não registrado -> 'erro' retentável SÓ se o Estoque registrava pedidos desta
 *    loja antes E depois do envio (prova de que um envio que chegou estaria lá). Senão manter.
 */
export function decidirIncerto(item: ResultadoItem, enviadoEm: string | null | undefined, status: unknown): DecisaoIncerto {
  if (!ehIncertoPorTimeout(item)) return manter('Não é incerto por tempo esgotado', 60 * 24 * 30);
  if (!statusValido(status)) return manter('Resposta do Estoque sem o formato esperado', 60);
  const envio = enviadoEm ? Date.parse(enviadoEm) : NaN;
  if (Number.isNaN(envio)) return manter('Sem a hora do envio', 60 * 24 * 30);

  const comItem = status.envios
    .filter((e) => e.itens.some((i) => i && i.codigo === item.codigo))
    .sort((a, b) => Date.parse(a.recebidoEm) - Date.parse(b.recebidoEm));
  if (comItem.some((e) => !e.concluidoEm)) return manter('O Estoque ainda está processando este envio (ou parou no meio)', 15);

  const ultimo = comItem[comItem.length - 1];
  if (ultimo) {
    const r = ultimo.itens.find((i) => i && i.codigo === item.codigo)!;
    if (typeof r.ok !== 'boolean') return manter('O Estoque registrou o envio mas não o resultado deste item', 60 * 24);
    const c = classificarItemEstoque(r);
    if (c.status === 'ok') {
      return {
        acao: 'ok', motivo: 'O Estoque processou este item',
        resultado: { ...item, ...c, status: 'ok', retentavel: false, erro: undefined, detalhe: `Conferido sozinho no Estoque${c.detalhe ? `: ${c.detalhe}` : ''}` },
      };
    }
    if (c.status === 'incerto') return manter(`O Estoque processou com dúvida: ${c.erro ?? 'confira no Estoque'}`, 60 * 24 * 30);
    // c.status === 'erro' (nada gravado naquele envio): cai na prova abaixo, porque pode ser um envio ANTERIOR.
  }

  const primeiro = status.primeiroRegistro ? Date.parse(status.primeiroRegistro) : NaN;
  const ultimoReg = status.ultimoRegistro ? Date.parse(status.ultimoRegistro) : NaN;
  if (Number.isNaN(primeiro) || primeiro > envio - MARGEM_RELOGIO_MS) {
    // O Estoque só começou a registrar depois deste envio: nunca vai dar para provar. Fica para o gerente.
    return manter('O envio é de antes de o Estoque registrar os pedidos', 60 * 24 * 30);
  }
  if (Number.isNaN(ultimoReg) || ultimoReg < envio + MARGEM_RELOGIO_MS) {
    return manter('Ainda sem prova de que o Estoque registrava pedidos nessa hora', 30);
  }
  return {
    acao: 'erro', motivo: ultimo ? 'O Estoque não gravou este item' : 'O envio não chegou ao Estoque',
    resultado: {
      ...item, status: 'erro', retentavel: true,
      erro: ultimo ? 'O Estoque confirmou que não baixou este item' : 'O envio não chegou ao Estoque (conferido)',
      detalhe: 'Conferido sozinho no Estoque: reenvio seguro',
    },
  };
}

/**
 * Junta as decisões de uma baixa. Se algum item incerto por timeout fica 'manter', só os 'ok' são aplicados: assim
 * nenhum reenvio acontece enquanto sobra item do MESMO envio sem resposta (o reenvio troca a hora de envio da linha).
 */
export function aplicarDecisoesIncerto(resultado: (ResultadoItem | null)[], decisoes: Map<number, DecisaoIncerto>): { resultado: (ResultadoItem | null)[]; mudou: boolean; reverEmMin: number | null } {
  const algumManter = [...decisoes.values()].some((d) => d.acao === 'manter');
  const out = resultado.slice();
  let mudou = false;
  let reverEmMin: number | null = null;
  for (const [i, d] of decisoes) {
    if (d.acao === 'manter') { reverEmMin = reverEmMin == null ? d.reverEmMin : Math.min(reverEmMin, d.reverEmMin); continue; }
    if (d.acao === 'erro' && algumManter) { reverEmMin = reverEmMin == null ? 15 : Math.min(reverEmMin, 15); continue; }
    out[i] = d.resultado;
    mudou = true;
  }
  return { resultado: out, mudou, reverEmMin };
}
