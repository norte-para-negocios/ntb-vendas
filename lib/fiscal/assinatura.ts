import { SignedXml } from 'xml-crypto';

// Assinatura XMLDSig enveloped, padrão NFe: C14N + SHA1/RSA-SHA1 (padrão
// histórico da SEFAZ — não é escolha nossa, é exigência do schema). Mesma
// receita já confirmada contra a SEFAZ real em scripts/nfce-referencia/gerar-nfce-teste.mjs.
export function assinarXmlNota(xml: string, infNFeId: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: `//*[local-name(.)='infNFe']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${infNFeId}`,
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='infNFe']`, action: 'after' } });
  return sig.getSignedXml();
}
