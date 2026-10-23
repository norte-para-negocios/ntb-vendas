// rodar com: npx tsx scripts/testes/inutilizacao.test.ts
import assert from 'node:assert/strict';
import { montarInutilizacao, parseRespostaInutilizacao } from '../../lib/fiscal/inutilizacao';

const { xml, id } = montarInutilizacao({ modelo: '65', ambiente: 'producao', cUF: '29', ano: 26, cnpj: '39.912.717/0001-45', serie: 2, inicio: 74, fim: 75, justificativa: 'Numeração rejeitada pela SEFAZ por falha no NCM' });
assert.equal(id, 'ID2926399127170001456500200000007400000007 5'.replace(' ', ''));
assert.ok(xml.includes('<tpAmb>1</tpAmb>') && xml.includes('<nNFIni>74</nNFIni><nNFFin>75</nNFFin>'));
assert.ok(xml.includes('<xJust>Numeracao rejeitada pela SEFAZ por falha no NCM</xJust>'));
assert.throws(() => montarInutilizacao({ modelo: '65', ambiente: 'producao', cUF: '29', ano: 26, cnpj: '1', serie: 2, inicio: 5, fim: 4, justificativa: 'justificativa longa ok' }));
assert.throws(() => montarInutilizacao({ modelo: '65', ambiente: 'producao', cUF: '29', ano: 26, cnpj: '1', serie: 2, inicio: 1, fim: 1, justificativa: 'curta' }));
const r = parseRespostaInutilizacao('<retInutNFe><infInut><tpAmb>1</tpAmb><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>129260000000001</nProt></infInut></retInutNFe>');
assert.equal(r.homologada, true);
assert.equal(r.protocolo, '129260000000001');
assert.equal(parseRespostaInutilizacao('<retInutNFe><infInut><cStat>241</cStat><xMotivo>Um numero da faixa ja foi utilizado</xMotivo></infInut></retInutNFe>').homologada, false);
console.log('inutilizacao: ok');
