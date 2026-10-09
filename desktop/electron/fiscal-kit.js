// NFC-e em contingência sem internet, no computador da loja (08/10/2026). Ver lib/fiscal/emitirOffline.ts.
// - O kit (certificado, CSC, emitente, série deste PC) chega do servidor depois de um login com internet e fica
//   num arquivo criptografado pelo Windows (safeStorage/DPAPI: só este usuário do Windows neste PC abre).
// - O contador da série fica num arquivo próprio, gravado assim que a nota é montada (antes de imprimir).
// - Impressão: impressora de rede recebe ESC/POS com o QR Code; USB recebe o PDF do cupom pelo SumatraPDF.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

let fiscal = null;
function libFiscal() {
  if (!fiscal) fiscal = require('./fiscal-offline');
  return fiscal;
}

function criar({ app, safeStorage, printEngine, sumatraPath, log }) {
  const dir = app.getPath('userData');
  const arqKit = (storeId) => path.join(dir, `fiscal-kit-${storeId}.bin`);
  const arqContador = (storeId) => path.join(dir, `fiscal-contador-${storeId}.json`);

  function lerKit(storeId) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const bin = fs.readFileSync(arqKit(storeId));
      return JSON.parse(safeStorage.decryptString(bin));
    } catch { return null; }
  }

  function lerContador(storeId) {
    try { return JSON.parse(fs.readFileSync(arqContador(storeId), 'utf8')); } catch { return {}; }
  }

  function gravarContador(storeId, dados) {
    const tmp = arqContador(storeId) + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(dados));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, arqContador(storeId));
  }

  function salvarKit(kit) {
    if (!kit || !kit.storeId || !kit.certPem || !kit.keyPem) return { ok: false, reason: 'kit incompleto' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'criptografia do Windows indisponível' };
    fs.writeFileSync(arqKit(kit.storeId), safeStorage.encryptString(JSON.stringify(kit)));
    // Contador nunca anda para trás: o maior entre o deste PC e o que o servidor já registrou.
    const c = lerContador(kit.storeId);
    const chave = `${kit.config.ambiente}:${kit.serie}`;
    if (!c[chave] || c[chave] < kit.ultimoNumero) { c[chave] = kit.ultimoNumero; gravarContador(kit.storeId, c); }
    log(`kit fiscal salvo: loja ${kit.storeId}, série ${kit.serie}, ambiente ${kit.config.ambiente}`);
    return { ok: true };
  }

  function status(storeId) {
    const kit = lerKit(storeId);
    if (!kit) return { pronto: false };
    return { pronto: true, serie: kit.serie, ambiente: kit.config.ambiente, geradoEm: kit.geradoEm };
  }

  function emitir(storeId, venda) {
    const kit = lerKit(storeId);
    if (!kit) return { ok: false, reason: 'Nota sem internet não ativada neste computador.' };
    const c = lerContador(storeId);
    const chave = `${kit.config.ambiente}:${kit.serie}`;
    const numero = Math.max(Number(c[chave] || 0), Number(kit.ultimoNumero || 0)) + 1;
    try {
      const nota = libFiscal().emitirNfceOffline(kit, venda, numero);
      // Grava o número antes de devolver a nota (impressa e guardada na fila depois): nunca repete.
      c[chave] = numero;
      gravarContador(storeId, c);
      log(`NFC-e contingência emitida offline: série ${nota.serie} nº ${nota.numero} chave ${nota.chave}`);
      return { ok: true, nota, deviceId: kit.deviceId, nomeLoja: kit.nomeLoja, cnpj: kit.cnpjLoja, endereco: kit.endereco };
    } catch (e) {
      log(`ERRO nota offline: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  // ESC/POS: texto (via toEscPos sem o corte) + QR Code nativo da impressora + rodapé.
  function escposComQr(topo, qr, rodape, larguraMm) {
    const semCorte = (b) => b.subarray(0, b.length - 8);
    const dados = Buffer.from(qr, 'ascii');
    const n = dados.length + 3;
    const qrBytes = Buffer.concat([
      Buffer.from([0x1B, 0x61, 0x01]),
      Buffer.from([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05]),
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),
      Buffer.from([0x1D, 0x28, 0x6B, n & 0xFF, (n >> 8) & 0xFF, 0x31, 0x50, 0x30]), dados,
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),
      Buffer.from([0x0A, 0x1B, 0x61, 0x00]),
    ]);
    return Buffer.concat([semCorte(printEngine.toEscPos(topo, larguraMm)), qrBytes, printEngine.toEscPos(rodape, larguraMm)]);
  }

  function textoCupom(r, via) {
    const n = r.nota;
    const col = 42;
    const lin = '-'.repeat(col);
    const brl = (v) => Number(v).toFixed(2).replace('.', ',');
    const L = [];
    L.push(r.nomeLoja.toUpperCase().slice(0, col));
    L.push(`CNPJ ${r.cnpj}`);
    if (r.endereco) L.push(r.endereco.slice(0, col * 2));
    L.push(lin);
    L.push('DANFE NFC-e - Documento Auxiliar');
    L.push('da Nota Fiscal de Consumidor Eletronica');
    L.push(lin);
    for (const i of n.itens) {
      L.push(i.descricao.slice(0, col));
      L.push(`  ${i.quantidade} x ${brl(i.valorUnitario)}`.padEnd(col - 12) + brl(i.valorTotal).padStart(12));
    }
    L.push(lin);
    L.push('TOTAL R$'.padEnd(col - 12) + brl(n.valorTotal).padStart(12));
    L.push(lin);
    L.push('EMITIDA EM CONTINGENCIA');
    L.push('Pendente de autorizacao');
    if (n.ambiente === 'homologacao') L.push('AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
    L.push(`NFC-e no ${n.numero}  Serie ${n.serie}`);
    L.push(`Emissao ${n.dhEmi.slice(8, 10)}/${n.dhEmi.slice(5, 7)}/${n.dhEmi.slice(0, 4)} ${n.dhEmi.slice(11, 19)}`);
    L.push(`Via ${via === 1 ? 'consumidor' : 'estabelecimento'}`);
    L.push('Chave de acesso:');
    L.push(n.chave.replace(/(\d{4})(?=\d)/g, '$1 '));
    L.push('Consulte pelo QR Code:');
    return L.join('\n');
  }

  async function imprimir({ resultado, printer, owners, vias = 2 }) {
    if (!resultado || !resultado.nota || !printer) return { ok: false, reason: 'parâmetros ausentes' };
    const n = resultado.nota;
    try {
      for (let via = 1; via <= vias; via++) {
        if (printer.connection_type === 'network' && printer.ip_address) {
          const buf = escposComQr(textoCupom(resultado, via), n.qrCode, 'Consulta: portal da SEFAZ-BA\n', printer.paper_width_mm);
          await printEngine.printDirectNetwork(printer.ip_address, Number(printer.port) || 9100, buf, false);
        } else if (printer.connection_type === 'usb' && printer.usb_system_name) {
          const alvo = await printEngine.resolverAlvoUsb(printer, owners);
          const pdf = await libFiscal().gerarPdfContingencia({
            storeName: resultado.nomeLoja, cnpj: resultado.cnpj, endereco: resultado.endereco || undefined,
            chave: n.chave, dataHora: new Date(), itens: n.itens, valorTotal: n.valorTotal, via, qrCode: n.qrCode,
          });
          const tmp = path.join(os.tmpdir(), `ntb-nfce-contingencia-${n.chave}-${via}.pdf`);
          fs.writeFileSync(tmp, pdf);
          await new Promise((resolve, reject) => {
            execFile(sumatraPath, ['-print-to', alvo, '-print-settings', 'noscale', '-silent', '-exit-when-done', tmp], { timeout: 30000 },
              (err) => { try { fs.unlinkSync(tmp); } catch { /* */ } if (err) reject(err); else resolve(); });
          });
        } else {
          return { ok: false, reason: 'impressora sem rede/USB' };
        }
      }
      return { ok: true };
    } catch (e) {
      log(`ERRO impressão nota offline: ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  return { salvarKit, status, emitir, imprimir };
}

module.exports = { criar };
