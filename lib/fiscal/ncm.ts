// NCM válido na NFC-e = exatamente 8 dígitos. O campo do Omie costuma vir copiado com pontos e descrição
// ("2203.00.00 CERVEJAS DE MALTE 22030000"), o que a SEFAZ rejeita com cStat=225 (schema). Extrai os 8 dígitos
// iniciais; devolve null se não houver 8 dígitos. Achado em 03/10 (duas notas rejeitadas no Sertão).
export function normalizarNcm(raw: string | null | undefined): string | null {
  const digitos = String(raw ?? '').replace(/\D/g, '');
  return digitos.length >= 8 ? digitos.slice(0, 8) : null;
}
