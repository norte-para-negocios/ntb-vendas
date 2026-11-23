// rodar com: npx tsx scripts/testes/maquininhaOmie.test.ts
// Maquininha no pagamento de cartão: validação do payment_details, payload do Omie na mesma ordem dos <detPag> e nfeProc completado pela venda.
import assert from 'node:assert/strict';
import { isValidPaymentDetails } from '../../lib/server/detalhesPagamento';
import { montarPayloadIncluirNfce } from '../../lib/omie/nota-fiscal';
import { montarXmlNota, pagamentosDoXml, type MontarXmlParams, type PagamentoNota } from '../../lib/fiscal/xml';
import { payloadOmieDoNfeProc, completarPagamentosComVenda } from '../../lib/fiscal/payloadOmieDoXml';
import { MAQUININHA_LABELS } from '../../lib/labels';

// --- validação -------------------------------------------------------------------------------------------------------------
const det = (methods: unknown[]) => ({ total: 50, methods });
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa', acquirer: 'getnet' }])), true);
assert.equal(isValidPaymentDetails(det([{ method: 'DEBIT', amount: 50, brand: 'elo', acquirer: 'rede' }])), true);
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa' }])), true, 'acquirer é opcional');
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa', acquirer: null }])), true);
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa', acquirer: 'maquininha-fantasma' }])), false, 'fora do catálogo');
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa', acquirer: 7 }])), false, 'tipo errado');
assert.equal(isValidPaymentDetails(det([{ method: 'CREDIT', amount: 50, brand: 'visa', acquirer: 'toString' }])), false, 'chave herdada do Object');
assert.equal(isValidPaymentDetails(det([{ method: 'PIX', amount: 50, acquirer: 'getnet' }])), false, 'maquininha só em crédito/débito');
assert.deepEqual(Object.keys(MAQUININHA_LABELS), ['getnet', 'rede', 'cielo', 'stone', 'pagseguro', 'mercadopago', 'sumup']);

// --- payload do Omie ------------------------------------------------------------------------------------------------------
const itens = [{ cProd: '1', xProd: 'Cerveja', ncm: '22030000', qCom: 2, vUnCom: 20 }]; // 40,00
const pagamentos: PagamentoNota[] = [
  { method: 'COURTESY', amount: 5 },                                  // não vai no XML
  { method: 'PIX', amount: 10 },
  { method: 'CREDIT', amount: 0 },                                     // valor 0: não vai no XML
  { method: 'CREDIT', amount: 20, brand: 'visa', acquirer: 'getnet' },
  { method: 'DEBIT', amount: 14, brand: 'mastercard', acquirer: 'rede' }, // 10 + 20 + 14 = 44: 4,00 de taxa embutida
];
const args = {
  chave: '29261039912717000145650020000013340000940916', numero: 1334, serie: 2, dataEmissao: new Date('2026-11-22T20:00:00-03:00'),
  ambiente: 'producao' as const, itens, pagamentos, nfeProcXml: '<x/>', nfceMd5: 'md5', protocolo: 'prot', valorTotal: 44,
};
const payload = montarPayloadIncluirNfce(args);
assert.deepEqual(payload.pagamentos, [
  { tPag: '17', vPag: 10 },
  { tPag: '03', vPag: 20, method: 'CREDIT', brand: 'visa', acquirer: 'getnet' },
  { tPag: '04', vPag: 14, method: 'DEBIT', brand: 'mastercard', acquirer: 'rede' },
]);

// A lista tem que ser a mesma dos <detPag> do XML (ordem, tPag e valor).
const params: MontarXmlParams = {
  modelo: '65', ambiente: 'producao', serie: 2, numero: 1334, itens, pagamentos,
  emitente: { cnpj: '39912717000145', ie: '123', razaoSocial: 'X', logradouro: 'R', numero: '1', bairro: 'B', municipio: 'M', cMun: '2921005', uf: 'BA', cep: '48280000', cUF: 29, cstCsosnPadrao: '102', cstPisPadrao: '07', cstCofinsPadrao: '07' },
};
const xml = montarXmlNota(params).xml;
const detPags = [...xml.matchAll(/<detPag>[\s\S]*?<\/detPag>/g)].map((m) => ({ tPag: m[0].match(/<tPag>(\d+)/)![1], vPag: Number(m[0].match(/<vPag>([^<]+)/)![1]) }));
assert.deepEqual(detPags, payload.pagamentos.map((p) => ({ tPag: p.tPag, vPag: p.vPag })));

// último pagamento absorve o arredondamento, igual ao XML
const arred = pagamentosDoXml([{ method: 'CASH', amount: 10.004 }, { method: 'CREDIT', amount: 29.99, acquirer: 'rede' }], 40);
assert.equal(arred.lista.reduce((a, p) => a + p.amount, 0).toFixed(2), '40.00');
// cortesia total: uma linha só (tPag 90)
assert.deepEqual(montarPayloadIncluirNfce({ ...args, pagamentos: [{ method: 'COURTESY', amount: 40 }], valorTotal: 40 }).pagamentos, [{ tPag: '90', vPag: 40 }]);
// sem acquirer/brand: nenhum campo extra
assert.deepEqual(montarPayloadIncluirNfce({ ...args, pagamentos: [{ method: 'CREDIT', amount: 44 }] }).pagamentos, [{ tPag: '03', vPag: 44, method: 'CREDIT' }]);

// --- nfeProc completado pela venda -----------------------------------------------------------------------------------------
const CH = '29261039912717000145650020000013340000940916';
const nfeProc =
  `<nfeProc><NFe><infNFe Id="NFe${CH}"><ide><tpAmb>1</tpAmb><dhEmi>2026-11-22T20:00:00-03:00</dhEmi></ide>` +
  `<det nItem="1"><prod><cProd>1</cProd><xProd>Cerveja</xProd><NCM>22030000</NCM><CFOP>5405</CFOP><qCom>2.0000</qCom><vUnCom>20.00</vUnCom></prod></det>` +
  `<total><ICMSTot><vNF>40.00</vNF></ICMSTot></total>` +
  `<pag><detPag><tPag>17</tPag><vPag>10.00</vPag></detPag><detPag><tPag>03</tPag><vPag>30.00</vPag></detPag></pag></infNFe></NFe>` +
  `<protNFe><infProt><nProt>1</nProt></infProt></protNFe></nfeProc>`;
const base = payloadOmieDoNfeProc(nfeProc);
const completo = completarPagamentosComVenda(base, [
  { method: 'COURTESY', amount: 3 }, { method: 'PIX', amount: 10 }, { method: 'CREDIT', amount: 30, brand: 'elo', acquirer: 'getnet' },
]);
assert.deepEqual(completo.pagamentos, [{ tPag: '17', vPag: 10 }, { tPag: '03', vPag: 30, method: 'CREDIT', brand: 'elo', acquirer: 'getnet' }]);
// não casa (quantidade ou tPag diferente, ou venda sem methods): segue sem os campos
assert.deepEqual(completarPagamentosComVenda(base, [{ method: 'CREDIT', amount: 40, acquirer: 'rede' }]), base);
assert.deepEqual(completarPagamentosComVenda(base, [{ method: 'CASH', amount: 10 }, { method: 'CREDIT', amount: 30, acquirer: 'rede' }]), base);
assert.deepEqual(completarPagamentosComVenda(base, null), base);

console.log('maquininhaOmie: ok');
