// Onde cada documento imprime: cada impressora recebe só os tipos de documento marcados nela.
// `documentos` vazio/NULL = padrão pelo destino (a loja nunca fica sem imprimir um documento por config incompleta).
export type DocPrint = 'comanda' | 'pre_conta' | 'comprovante' | 'cupom_fiscal' | 'fechamento_caixa';

export const DOCS_IMPRESSAO: { id: DocPrint; rotulo: string }[] = [
  { id: 'comanda', rotulo: 'Comanda (pedidos)' },
  { id: 'pre_conta', rotulo: 'Pré-conta' },
  { id: 'comprovante', rotulo: 'Comprovante de pagamento' },
  { id: 'cupom_fiscal', rotulo: 'Cupom fiscal (nota)' },
  { id: 'fechamento_caixa', rotulo: 'Fechamento de caixa' },
];

const TODOS: DocPrint[] = DOCS_IMPRESSAO.map((d) => d.id);

export function documentosPadrao(destination: string): DocPrint[] {
  if (destination === 'kitchen' || destination === 'bar') return ['comanda'];
  if (destination === 'receipt') return ['pre_conta', 'comprovante', 'cupom_fiscal', 'fechamento_caixa'];
  return [...TODOS];
}

export function impressoraRecebe(printer: { destination: string; documentos?: string[] | null }, doc: DocPrint): boolean {
  const lista = printer.documentos && printer.documentos.length > 0 ? printer.documentos : documentosPadrao(printer.destination);
  return lista.includes(doc);
}
