// Chave de acesso de 44 dígitos da NFe/NFCe: cUF+AAMM+CNPJ+mod+serie+nNF+
// tpEmis+cNF+DV, DV calculado por módulo 11 (pesos 2..9 ciclando da direita
// pra esquerda). Mesma fórmula já validada contra a SEFAZ real em
// scripts/nfce-referencia/gerar-nfce-teste.mjs.
export function calcularDigitoVerificador(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (const d of chave43.split('').reverse().map(Number)) {
    soma += d * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const pad = (n: number | string, len: number) => String(n).padStart(len, '0');

export interface DadosChaveAcesso {
  cUF: number;
  anoMes: string; // AAMM, ex.: '2608'
  cnpj: string; // 14 dígitos, só números
  modelo: '55' | '65';
  serie: number;
  numero: number;
  tpEmis?: number; // default 1 (emissão normal)
  cNF?: string; // 8 dígitos; gerado aleatório se ausente
}

export function montarChaveAcesso(dados: DadosChaveAcesso): { chave: string; cNF: string } {
  const cNF = dados.cNF ?? pad(Math.floor(Math.random() * 99999999), 8);
  const tpEmis = dados.tpEmis ?? 1;
  const semDV =
    `${pad(dados.cUF, 2)}${dados.anoMes}${pad(dados.cnpj, 14)}${dados.modelo}` +
    `${pad(dados.serie, 3)}${pad(dados.numero, 9)}${tpEmis}${cNF}`;
  const dv = calcularDigitoVerificador(semDV);
  return { chave: semDV + dv, cNF };
}
