// rodar com: npx tsx scripts/testes/consultaSituacaoSefaz.test.ts
// Consulta de chave na SEFAZ (incidente Sertão out/2026: timeout online autorizado + contingência 539).
import assert from 'node:assert/strict';
import { parseConsultaSituacao, chaveDaDuplicidade } from '../../lib/fiscal/soap';

const CH = '29261039912717000145650020000003141000940916';
const env = (corpo: string) => `<soap:Envelope><soap:Body><nfeResultMsg><retConsSitNFe versao="4.00"><tpAmb>1</tpAmb>${corpo}</retConsSitNFe></nfeResultMsg></soap:Body></soap:Envelope>`;

// autorizada
let r = parseConsultaSituacao(env(`<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><chNFe>${CH}</chNFe><protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${CH}</chNFe><nProt>229261327617412</nProt><digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`));
assert.equal(r.situacao, 'autorizada');
assert.equal(r.protocolo, '229261327617412');
assert.ok(r.protNFe?.startsWith('<protNFe'));

// não consta
r = parseConsultaSituacao(env(`<cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo>`));
assert.equal(r.situacao, 'nao_existe');
assert.equal(r.protocolo, null);

// cancelada (cStat geral 101 mesmo com protNFe 100 dentro)
r = parseConsultaSituacao(env(`<cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo><protNFe><infProt><nProt>1</nProt><cStat>100</cStat></infProt></protNFe>`));
assert.equal(r.situacao, 'cancelada');

// SEFAZ fora / corpo vazio
assert.equal(parseConsultaSituacao('').situacao, 'sem_resposta');
assert.equal(parseConsultaSituacao(env('<cStat>108</cStat><xMotivo>Servico Paralisado</xMotivo>')).situacao, 'sem_resposta');

// 100 sem protocolo não conta como autorizada
assert.equal(parseConsultaSituacao(env('<cStat>100</cStat>')).situacao, 'outra');

// chave citada na 539
assert.equal(chaveDaDuplicidade(`Rejeicao: Duplicidade de NF-e, com diferença na Chave de Acesso [chNFe:${CH}]`), CH);
assert.equal(chaveDaDuplicidade('cStat=539 sem chave'), null);
assert.equal(chaveDaDuplicidade(null), null);

console.log('consultaSituacaoSefaz: ok');
