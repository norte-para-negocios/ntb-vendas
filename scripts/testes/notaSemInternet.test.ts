// rodar com: npx tsx scripts/testes/notaSemInternet.test.ts
// NFC-e em contingência feita no computador sem internet (08/10/2026): monta, assina, QR offline e a conferência
// do servidor (/api/fiscal/registrar-contingencia). Certificado de teste gerado na hora (sem valor nenhum).
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { emitirNfceOffline, conferirXmlContingencia, type KitContingencia } from '../../lib/fiscal/emitirOffline';

const chaves = forge.pki.rsa.generateKeyPair(1024);
const cert = forge.pki.createCertificate();
cert.publicKey = chaves.publicKey; cert.serialNumber = '01';
cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 86400000);
cert.setSubject([{ name: 'commonName', value: 'TESTE:12345678000195' }]); cert.setIssuer(cert.subject.attributes);
cert.sign(chaves.privateKey, forge.md.sha256.create());
const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyToPem(chaves.privateKey);

const kit: KitContingencia = {
  versao: 1, storeId: 's', deviceId: 'd', nomeLoja: 'Loja Teste', cnpjLoja: '12345678000195', endereco: '',
  config: { ambiente: 'homologacao', inscricao_estadual: '123', razao_social: 'TESTE LTDA', endereco_logradouro: 'Rua A', endereco_numero: '1', endereco_bairro: 'Centro', endereco_cidade: 'Mata de Sao Joao', endereco_uf: 'BA', endereco_cep: '48280000', cst_csosn_padrao: '102', cst_pis_padrao: '07', cst_cofins_padrao: '07', cnpj_autorizado: null, telefone: null },
  produtoTaxa: { name: 'Taxa de Servico (10%)', omie_codigo: '90875', ncm: '00000000' },
  csc: 'CSCTESTE', idCsc: '000001', certPem, keyPem, serie: 70, ultimoNumero: 0, geradoEm: new Date().toISOString(),
};

const nota = emitirNfceOffline(kit, {
  itens: [{ quantity: 2, price_at_time: 34.9, product: { id: 'p', name: 'Batata Frita', ncm: '2004.10.00 BATATA', omie_codigo: '90020' } }],
  pagamentos: [{ method: 'CASH', amount: 76.78 }],
}, 7);

assert.equal(nota.numero, 7); assert.equal(nota.serie, 70);
assert.equal(nota.chave.slice(34, 35), '9', 'tpEmis 9 na chave');
assert.match(nota.xml, /<tpEmis>9<\/tpEmis>/);
assert.match(nota.xml, /<dhCont>/);
assert.match(nota.xml, /<cProd>90875<\/cProd>/, 'taxa de serviço como item próprio');
assert.equal(nota.valorTotal, 76.78);
assert.match(nota.qrCode, /\?p=\d{44}\|2\|2\|\d{2}\|76\.78\|[0-9a-f]+\|1\|[0-9A-F]{40}$/, 'QR no formato off-line');

// Assinatura confere com o certificado.
const sig = nota.xml.match(/<Signature[\s\S]*<\/Signature>/)![0];
const v = new SignedXml({ publicCert: certPem });
v.loadSignature(sig);
assert.ok(v.checkSignature(nota.xml.replace(/<infNFeSupl>[\s\S]*<\/infNFeSupl>/, '')), 'assinatura válida');

// Conferência do servidor.
const esperado = { cnpj: '12345678000195', ambiente: 'homologacao' as const, chave: nota.chave, serie: 70, numero: 7 };
assert.equal(conferirXmlContingencia(nota.xml, esperado), null);
assert.match(conferirXmlContingencia(nota.xml, { ...esperado, cnpj: '99999999000199' }) ?? '', /outro CNPJ/);
assert.match(conferirXmlContingencia(nota.xml, { ...esperado, ambiente: 'producao' }) ?? '', /ambiente/);
assert.match(conferirXmlContingencia(nota.xml, { ...esperado, numero: 8 }) ?? '', /série\/número/);

// Produto sem NCM não vira nota.
assert.throws(() => emitirNfceOffline(kit, { itens: [{ quantity: 1, price_at_time: 10, product: { name: 'Sem NCM' } }] }, 8), /sem NCM/);

console.log('notaSemInternet: ok');
