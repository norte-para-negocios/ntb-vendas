// NFC-e em contingência (tpEmis=9) feita NO COMPUTADOR DA LOJA, sem internet (08/10/2026, pedido do dono:
// "gera a nota em contingência e depois lança para a SEFAZ"). Roda no processo principal do app do Windows
// (desktop/electron/fiscal-offline.js é este arquivo empacotado). O "kit" vem do servidor depois de um login
// com internet (/api/fiscal/kit-contingencia) e fica guardado criptografado pelo Windows (DPAPI).
// Cada computador tem SÉRIE PRÓPRIA de contingência (numeração dele, sem colidir com o servidor nem com
// outro PC). Quando a internet volta, o app manda o XML para /api/fiscal/registrar-contingencia, que grava a
// nota como 'contingencia' e a retransmissão de sempre (lib/fiscal/retransmissao.ts) envia à SEFAZ.
import { montarXmlNota, type PagamentoNota, type DestinatarioNota, type ItemNota } from './xml';
import { assinarXmlNota } from './assinatura';
import { montarQrCodeOffline, extrairDigestValue, inserirSuplNoXmlAssinado } from './qrcode';
import { resolverEndpointsNfceConsulta } from './soap';
import { itensDaVenda, montarParamsDaVenda, type ConfigEmitenteVenda, type ItemVenda, type ProdutoTaxaVenda } from './paramsDaVenda';

export interface KitContingencia {
  versao: 1;
  storeId: string;
  deviceId: string;
  nomeLoja: string;
  cnpjLoja: string;
  endereco: string;
  config: ConfigEmitenteVenda;
  produtoTaxa: ProdutoTaxaVenda | null;
  csc: string;
  idCsc: string;
  certPem: string;
  keyPem: string;
  serie: number;
  ultimoNumero: number;
  geradoEm: string;
}

export interface VendaOffline {
  itens: ItemVenda[];
  pagamentos?: PagamentoNota[];
  destinatario?: DestinatarioNota;
}

export interface NotaOffline {
  modelo: '65';
  ambiente: 'homologacao' | 'producao';
  serie: number;
  numero: number;
  chave: string;
  xml: string;
  qrCode: string;
  valorTotal: number;
  dhEmi: string;
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
}

export function emitirNfceOffline(kit: KitContingencia, venda: VendaOffline, numero: number): NotaOffline {
  if (!venda.itens.length) throw new Error('Venda sem itens.');
  const semNcm = venda.itens.find((i) => !String(i.product?.ncm ?? '').replace(/\D/g, '').match(/^\d{8}/));
  if (semNcm) throw new Error(`Produto "${semNcm.product?.name ?? '?'}" sem NCM cadastrado.`);
  const itensXml: ItemNota[] = itensDaVenda(venda.itens);
  const params = montarParamsDaVenda({
    config: kit.config,
    cnpjLoja: kit.cnpjLoja,
    modelo: '65',
    serie: kit.serie,
    numero,
    itensXml,
    produtoTaxa: kit.produtoTaxa,
    destinatario: venda.destinatario,
    pagamentos: venda.pagamentos,
  });
  const montado = montarXmlNota({ ...params, tpEmis: 9 });
  let xml = assinarXmlNota(montado.xml, montado.infNFeId, kit.certPem, kit.keyPem);
  const { urlQrCode, urlChave } = resolverEndpointsNfceConsulta(kit.config.ambiente);
  const { qrCode, supl } = montarQrCodeOffline({
    chave: montado.chave,
    tpAmb: kit.config.ambiente === 'homologacao' ? 2 : 1,
    idCsc: kit.idCsc,
    csc: kit.csc,
    urlQrCode,
    urlChave,
    dhEmi: montado.dhEmi,
    vNF: montado.valorTotalComTaxa,
    digVal: extrairDigestValue(xml),
  });
  xml = inserirSuplNoXmlAssinado(xml, supl);
  return {
    modelo: '65',
    ambiente: kit.config.ambiente,
    serie: kit.serie,
    numero,
    chave: montado.chave,
    xml,
    qrCode,
    valorTotal: montado.valorTotalComTaxa,
    dhEmi: montado.dhEmi,
    itens: itensXml.map((i) => ({ descricao: i.xProd, quantidade: i.qCom, valorUnitario: i.vUnCom, valorTotal: Number((i.qCom * i.vUnCom).toFixed(2)) })),
  };
}

/** Confere que um XML de contingência é desta loja/ambiente e bate com chave/série/número informados. */
export function conferirXmlContingencia(xml: string, esperado: { cnpj: string; ambiente: 'homologacao' | 'producao'; chave: string; serie: number; numero: number }): string | null {
  const chave = esperado.chave;
  if (!/^\d{44}$/.test(chave)) return 'chave inválida';
  if (chave.slice(6, 20) !== esperado.cnpj) return 'chave de outro CNPJ';
  if (chave.slice(20, 22) !== '65') return 'não é NFC-e';
  if (Number(chave.slice(22, 25)) !== esperado.serie || Number(chave.slice(25, 34)) !== esperado.numero) return 'série/número não batem com a chave';
  if (chave.slice(34, 35) !== '9') return 'não é contingência (tpEmis 9)';
  if (!xml.includes(`Id="NFe${chave}"`)) return 'XML de outra chave';
  const tpAmb = xml.match(/<tpAmb>(\d)<\/tpAmb>/)?.[1];
  if (tpAmb !== (esperado.ambiente === 'homologacao' ? '2' : '1')) return 'ambiente do XML diferente do da loja';
  if (!xml.includes('<Signature') || !xml.includes('<infNFeSupl>')) return 'XML sem assinatura/QR';
  return null;
}
