// Empacotado (esbuild) em desktop/electron/fiscal-offline.js no build do app: a nota em contingência sem internet
// usa EXATAMENTE o mesmo código fiscal do servidor (lib/fiscal). Dependências (xml-crypto, pdfkit, qrcode) ficam
// de fora do pacote e vêm do node_modules do desktop.
export { emitirNfceOffline } from '../../lib/fiscal/emitirOffline';
export { gerarPdfContingencia } from '../../lib/fiscal/pdfContingencia';
