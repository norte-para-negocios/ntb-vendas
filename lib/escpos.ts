// Protocolo ESC/POS: o padrão de fato pra impressora térmica de recibo —
// toda impressora Bluetooth genérica (as que NÃO são Sunmi/PAX/etc, ex.
// qualquer térmica de 58mm comprada solta) fala esse protocolo. Aqui só a
// parte mínima: inicializar, mandar texto puro (a loja já formata a
// largura de coluna certa em lib/print.ts, isso aqui só converte pra
// bytes) e cortar o papel no fim.
const ESC = 0x1b;
const GS = 0x1d;

// Inicializa a impressora (limpa buffer/formatação residual de um job
// anterior — sem isso, um corte de papel no meio de uma sessão anterior
// podia deixar a impressora num modo de fonte/alinhamento estranho pro
// próximo ticket).
const INIT = [ESC, 0x40];

// Corte parcial de papel (GS V 1) — "parcial" deixa uma tira ligando as
// duas partes, physicamente mais fácil de destacar na mão do que corte
// total; é o padrão usado pela maioria das térmicas de balcão.
const CUT_PARTIAL = [GS, 0x56, 0x01];

export function buildEscPosBytes(text: string, opts?: { cutPaper?: boolean }): Uint8Array {
  const encoder = new TextEncoder();
  // ESC/POS térmica brasileira normalmente usa CP860/CP850 (Latin), mas
  // sem acesso a hardware real pra confirmar a code page de cada
  // impressora Bluetooth possível, manter UTF-8 aqui é a escolha honesta:
  // acento pode sair errado em ALGUMAS térmicas mais antigas, mas nunca
  // trava a impressão inteira (diferente de mandar bytes numa code page
  // que a impressora não reconhece, que pode gerar lixo ilegível igual).
  // Revisitar com uma impressora real na mão antes de considerar isso
  // definitivo — ver docs/mobile-printer-drivers.md.
  const textBytes = Array.from(encoder.encode(text + '\n\n\n'));
  const bytes = [...INIT, ...textBytes, ...(opts?.cutPaper !== false ? CUT_PARTIAL : [])];
  return new Uint8Array(bytes);
}
