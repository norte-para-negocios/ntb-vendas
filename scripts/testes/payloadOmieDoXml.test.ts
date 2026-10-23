// rodar com: npx tsx scripts/testes/payloadOmieDoXml.test.ts
import assert from 'node:assert/strict';
import { payloadOmieDoNfeProc } from '../../lib/fiscal/payloadOmieDoXml';

const CH = '29261039912717000145650020000003141000940916';
const xml =
  `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${CH}" versao="4.00"><ide><tpAmb>1</tpAmb>` +
  `<dhEmi>2026-10-11T20:49:35-03:00</dhEmi></ide>` +
  `<det nItem="1"><prod><cProd>90560</cProd><cEAN>SEM GTIN</cEAN><xProd>Cerveja Amstel 600 ML</xProd><NCM>22030000</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>16.00</vUnCom></prod><imposto/></det>` +
  `<det nItem="2"><prod><cProd>90875</cProd><xProd>Taxa de Servico (10%)</xProd><NCM>00000000</NCM><CFOP>5102</CFOP><qCom>1.0000</qCom><vUnCom>3.20</vUnCom></prod></det>` +
  `<total><ICMSTot><vProd>35.20</vProd><vNF>35.20</vNF></ICMSTot></total>` +
  `<pag><detPag><tPag>17</tPag><vPag>20.00</vPag></detPag><detPag><tPag>01</tPag><vPag>15.20</vPag></detPag></pag></infNFe></NFe>` +
  `<protNFe versao="4.00"><infProt><chNFe>${CH}</chNFe><nProt>229261327617412</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;

const p = payloadOmieDoNfeProc(xml, { codigoTaxa: '90875' });
assert.equal(p.chNFe, CH);
assert.equal(p.nNF, 314);
assert.equal(p.serie, 2);
assert.equal(p.dEmi, '2026-10-11');
assert.equal(p.hEmi, '20:49:35');
assert.equal(p.tpAmb, 1);
assert.equal(p.nfceProt, '229261327617412');
assert.equal(p.vNF, 35.2);
assert.deepEqual(p.itens, [{ cProd: '90560', xProd: 'Cerveja Amstel 600 ML', ncm: '22030000', cfop: '5405', qCom: 2, vUnCom: 16 }]);
assert.deepEqual(p.pagamentos, [{ tPag: '17', vPag: 20 }, { tPag: '01', vPag: 15.2 }]);
assert.equal(payloadOmieDoNfeProc(xml).itens.length, 2); // sem código de taxa, mantém tudo
assert.throws(() => payloadOmieDoNfeProc('<x/>'));
console.log('payloadOmieDoXml: ok');
