// rodar com: npx tsx scripts/testes/nfceTaxaItem.test.ts
// Pedido do Ramon (03/10): a taxa de serviço vai como ITEM PRÓPRIO do cupom (cód. 90875),
// nunca rateada nos itens (vOutro). Sem produto de taxa configurado, o comportamento antigo segue.
import assert from 'node:assert/strict';
import { montarXmlNota } from '../../lib/fiscal/xml';

const base = {
  modelo: '65' as const,
  ambiente: 'producao' as const,
  serie: 2,
  numero: 11,
  emitente: {
    cnpj: '39912717000145', ie: '173747203', razaoSocial: 'AMJ SANTOS RESTAURANTE LTDA', logradouro: 'RUA DA AURORA', numero: 'S/N',
    bairro: 'Praia do Forte', municipio: 'Mata de Sao Joao', cMun: '2921005', uf: 'BA', cep: '48280000', cUF: 29,
    cstCsosnPadrao: '102', cstPisPadrao: '49', cstCofinsPadrao: '49',
  },
  // 2 itens somando 442,80 — o caso real citado pelo Ramon (taxa 44,28)
  itens: [
    { cProd: '90045', xProd: 'Batata Frita (300gr)', ncm: '20041000', qCom: 1, vUnCom: 32.9 },
    { cProd: '90100', xProd: 'Moqueca', ncm: '16041900', qCom: 1, vUnCom: 409.9 },
  ],
  pagamentos: [{ method: 'PIX', amount: 487.08 }],
};
const taxaServico = { cProd: '90875', xProd: 'Taxa de Serviço (10%)', ncm: '00000000' };

// 1) Com produto de taxa: item extra, sem vOutro em item nem no total, vNF igual ao pago
const a = montarXmlNota({ ...base, taxaServico });
assert.equal((a.xml.match(/<det nItem=/g) || []).length, 3, 'itens + 1 item de taxa');
assert.ok(!/<vOutro>[1-9]/.test(a.xml), 'nenhum vOutro > 0 (nem rateado, nem no total)');
assert.ok(a.xml.includes('<vOutro>0.00</vOutro>'), 'total vOutro zerado');
assert.ok(a.xml.includes('<vProd>487.08</vProd>'), 'vProd do total inclui a taxa (442,80 + 44,28)');
assert.ok(a.xml.includes('<vNF>487.08</vNF>'), 'vNF não muda');
assert.equal(a.valorTotalComTaxa, 487.08);
const det3 = (a.xml.match(/<det nItem="3">.*?<\/det>/) || [''])[0];
assert.ok(det3.includes('<cProd>90875</cProd>') && det3.includes('<xProd>Taxa de Serviço (10%)</xProd>'), 'item 3 é a taxa 90875');
assert.ok(det3.includes('<NCM>00000000</NCM>') && det3.includes('<CFOP>5102</CFOP>'), 'NCM 00000000 e CFOP 5102');
assert.ok(det3.includes('<qCom>1.0000</qCom>') && det3.includes('<vProd>44.28</vProd>'), 'qtd 1, valor = 10% exato');
// pagamento soma o vNF
assert.ok(a.xml.includes('<vPag>487.08</vPag>'), 'vPag = vNF');

// 2) Sem produto de taxa: comportamento antigo (rateado em vOutro), nada muda
const b = montarXmlNota({ ...base });
assert.equal((b.xml.match(/<det nItem=/g) || []).length, 2);
assert.ok(b.xml.includes('<vOutro>44.28</vOutro>'), 'rateio antigo preservado sem produto de taxa');

// 3) Venda sem taxa (pago = produtos): nenhum item de taxa mesmo com produto configurado
const c = montarXmlNota({ ...base, pagamentos: [{ method: 'PIX', amount: 442.8 }], taxaServico });
assert.equal((c.xml.match(/<det nItem=/g) || []).length, 2, 'sem taxa cobrada = sem item extra');

// 4) Homologação: o aviso obrigatório continua no 1º item (não na taxa)
const h = montarXmlNota({ ...base, ambiente: 'homologacao', taxaServico });
const det1 = (h.xml.match(/<det nItem="1">.*?<\/det>/) || [''])[0];
assert.ok(det1.includes('HOMOLOGACAO'), 'aviso de homologação no item 1');

console.log('nfceTaxaItem: ok');
