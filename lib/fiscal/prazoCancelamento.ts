// Prazo legal de cancelamento de nota fiscal na Bahia, contado a partir da
// Autorização de Uso (protocolo). Arquivo sem dependência de Node de
// propósito: é usado tanto pela rota de servidor (app/api/fiscal/cancelar)
// quanto pela tela Administração → Notas fiscais (StoreModule.tsx), pra UI e
// servidor bloquearem com a MESMA regra.
//
// - NFC-e (modelo 65): 30 minutos — RICMS-BA (Decreto 13.780/2012) art.
//   107-H, I, redação do Decreto 19.142/2019 ("em até 30 (trinta) minutos,
//   quando emitida com incorreção e não tiver ocorrido a circulação da
//   mercadoria"), alinhado ao Ajuste SINIEF 07/2018. O inciso II (168h)
//   existe só pra NFC-e emitida em duplicidade por contingência — não é o
//   caso deste botão (e esse cenário normalmente usa o evento 110112,
//   "cancelamento por substituição", não implementado).
// - NF-e (modelo 55): 24 horas — RICMS-BA art. 92.
// Depois do prazo a SEFAZ devolve cStat=501 ("Prazo de cancelamento superior
// ao previsto na Legislação"); a regularização vira nota de devolução/
// entrada, não cancelamento.
export const PRAZO_CANCELAMENTO_MS: Record<'55' | '65', number> = {
  '65': 30 * 60 * 1000,
  '55': 24 * 60 * 60 * 1000,
};

export const PRAZO_CANCELAMENTO_TEXTO: Record<'55' | '65', string> = {
  '65': '30 minutos',
  '55': '24 horas',
};

export function limiteCancelamento(modelo: '55' | '65', autorizadaEm: Date | string): Date {
  const base = typeof autorizadaEm === 'string' ? new Date(autorizadaEm) : autorizadaEm;
  return new Date(base.getTime() + PRAZO_CANCELAMENTO_MS[modelo]);
}

export function dentroDoPrazoCancelamento(modelo: '55' | '65', autorizadaEm: Date | string, agora = new Date()): boolean {
  return agora.getTime() <= limiteCancelamento(modelo, autorizadaEm).getTime();
}

export function mensagemPrazoEncerrado(modelo: '55' | '65'): string {
  const tipo = modelo === '65' ? 'NFC-e' : 'NF-e';
  return (
    `O prazo para cancelar esta ${tipo} já passou (${PRAZO_CANCELAMENTO_TEXTO[modelo]} após a autorização). ` +
    'A SEFAZ não aceita mais o cancelamento. Para desfazer a venda, fale com a contabilidade sobre uma nota de devolução.'
  );
}
