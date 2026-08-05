import forge from 'node-forge';

export interface CertificadoExtraido {
  certPem: string;
  keyPem: string;
  /** CN/subject do certificado — útil pra validar CNPJ ao emitir. */
  cnpjCertificado: string | null;
  /** URL do "CA Issuers" (Authority Information Access), pra resolver a cadeia. */
  urlCaIssuer: string | null;
}

// Extrai o certificado "folha" + chave privada de um .pfx (e-CNPJ A1),
// convertendo pra PEM (o Node não parseia PKCS12 nativamente em cert+key
// separados — por isso node-forge). Mesmo procedimento que antes era feito
// na mão com `openssl pkcs12 -clcerts`/`-nocerts` (ver histórico em
// scripts/nfce-referencia/gerar-nfce-teste.mjs).
export function extrairCertificado(pfxBuffer: Buffer, senha: string): CertificadoExtraido {
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

  const certBag = certBags[0];
  const keyBag = keyBags[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('Certificado ou chave privada não encontrados no .pfx.');
  }

  const cert = certBag.cert;
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);

  const cnpjAttr = cert.subject.attributes.find((a) => a.shortName === 'CN')?.value as string | undefined;
  const cnpjMatch = cnpjAttr?.match(/(\d{14})/);

  // Authority Information Access — extension 1.3.6.1.5.5.7.1.1, campo
  // "CA Issuers" (accessMethod 1.3.6.1.5.5.7.48.2). node-forge não decodifica
  // essa extensão em alto nível; extrai a URL do valor bruto (DER) com uma
  // busca simples por "http" no ASN.1 codificado.
  const aiaExt = cert.extensions.find((e) => e.id === '1.3.6.1.5.5.7.1.1');
  let urlCaIssuer: string | null = null;
  if (aiaExt?.value) {
    const match = aiaExt.value.match(/https?:\/\/[^\x00-\x1f\x7f]+/);
    urlCaIssuer = match?.[0] ?? null;
  }

  return { certPem, keyPem, cnpjCertificado: cnpjMatch?.[1] ?? null, urlCaIssuer };
}

// Baixa o certificado da AC emissora (.p7b ou .cer, formato varia por AC) e
// devolve em PEM, pra concatenar com o certPem da loja. Chamado só no upload
// do certificado (Task 7), não a cada emissão.
export async function resolverCadeiaCertificado(urlCaIssuer: string): Promise<string> {
  const res = await fetch(urlCaIssuer);
  if (!res.ok) throw new Error(`Falha ao baixar certificado da AC emissora: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  // A maioria das ACs brasileiras serve .p7b (PKCS7, DER). node-forge decodifica
  // e extrai os certificados de dentro.
  try {
    const p7Asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary')));
    const p7 = forge.pkcs7.messageFromAsn1(p7Asn1) as forge.pkcs7.PkcsSignedData;
    const certs = p7.certificates ?? [];
    if (!certs.length) throw new Error('Nenhum certificado dentro do .p7b da AC.');
    return certs.map((c) => forge.pki.certificateToPem(c)).join('\n');
  } catch (e) {
    // Fallback: algumas ACs servem .cer (certificado único em DER), não p7b.
    const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary'))));
    return forge.pki.certificateToPem(cert);
  }
}
