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

// Documento NOVO (não existia antes): só sai onde alguém marcou. Não entra no padrão por destino, pra
// nenhuma loja passar a imprimir algo que nunca imprimiu só porque atualizou o app.
const SO_ONDE_MARCADO: DocPrint[] = ['fechamento_caixa'];

export function documentosPadrao(destination: string): DocPrint[] {
  if (destination === 'kitchen' || destination === 'bar') return ['comanda'];
  if (destination === 'receipt') return ['pre_conta', 'comprovante', 'cupom_fiscal'];
  return TODOS.filter((d) => !SO_ONDE_MARCADO.includes(d));
}

// `soConfigurado`: exige a marca explícita na impressora (usado na pré-conta AUTOMÁTICA ao pedir conta, que é nova).
export function impressoraRecebe(
  printer: { destination: string; documentos?: string[] | null },
  doc: DocPrint,
  opcoes?: { soConfigurado?: boolean },
): boolean {
  const marcados = printer.documentos && printer.documentos.length > 0 ? printer.documentos : null;
  if (opcoes?.soConfigurado) return Boolean(marcados && marcados.includes(doc));
  return (marcados ?? documentosPadrao(printer.destination)).includes(doc);
}
