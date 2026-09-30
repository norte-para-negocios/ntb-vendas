// rodar com: npx tsx scripts/testes/nfceDestNome.test.ts
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
  itens: [{ cProd: '90001', xProd: 'Agua', ncm: '22021000', qCom: 1, vUnCom: 5.4 }],
};
const dest = (r: { xml: string }) => (r.xml.match(/<dest>.*?<\/dest>/) || [''])[0];

// só CPF (nome padrão "Consumidor"): o cupom não pode dizer "não identificado" quando há CPF
let d = dest(montarXmlNota({ ...base, destinatario: { cpfCnpj: '812.827.885-15', nome: 'Consumidor' } }));
assert.equal(d, '<dest><CPF>81282788515</CPF><xNome>CONSUMIDOR</xNome><indIEDest>9</indIEDest></dest>', 'CPF sem nome → xNome CONSUMIDOR');
// com nome digitado
d = dest(montarXmlNota({ ...base, destinatario: { cpfCnpj: '81282788515', nome: 'Ramon & Cia <teste>' } }));
assert.equal(d, '<dest><CPF>81282788515</CPF><xNome>Ramon &amp; Cia &lt;teste&gt;</xNome><indIEDest>9</indIEDest></dest>', 'nome escapado');
// nome enorme é cortado em 60
d = dest(montarXmlNota({ ...base, destinatario: { cpfCnpj: '81282788515', nome: 'A'.repeat(100) } }));
assert.ok(d.includes(`<xNome>${'A'.repeat(60)}</xNome>`) && !d.includes('A'.repeat(61)), 'xNome limitado a 60');
// sem CPF: continua sem <dest> (cupom anônimo)
assert.equal(dest(montarXmlNota({ ...base })), '', 'sem documento = sem <dest>');
console.log('ok');
