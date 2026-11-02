// Varredura da rede atrás de impressoras (02/11/2026, ODARA). Conectar e cortar na porta 9100 mexe na impressora: a i8
// parou de aceitar conexão depois de poucas seguidas (31/10) e só voltou ao religar. Por isso a impressora já instalada
// no Windows ou cadastrada nunca é testada; conta como achada e a varredura só procura as desconhecidas.
const PORTA = 9100;

function alvosDaVarredura(bases, meus, reservados) {
  const alvos = [];
  for (const base of bases) {
    for (let n = 1; n <= 254; n++) {
      const ip = `${base}.${n}`;
      if (!meus.has(ip) && !reservados.has(ip)) alvos.push(ip);
    }
  }
  return alvos;
}

// Saída de `Get-PrinterPort | PrinterHostAddress`: uma linha por porta. Só IPv4 (nome de host é ignorado).
function ipsDasPortas(saida) {
  return new Set(String(saida || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l)));
}

const resultadoDaVarredura = (achados, reservados) => [...new Set([...achados.map((ip) => `${ip}:${PORTA}`), ...[...reservados].map((ip) => `${ip}:${PORTA}`)])].sort();

// Saída JSON de Get-PrintJob (objeto único, lista ou vazio) -> resumo enviado ao servidor.
function resumoDaFila(saida, agora = Date.now()) {
  let lista = [];
  try { const j = JSON.parse(String(saida || '').trim() || '[]'); lista = Array.isArray(j) ? j : [j]; } catch { return null; }
  const trabalhos = lista.map((t) => {
    const envio = Date.parse(t.enviado);
    return { impressora: String(t.impressora ?? ''), documento: String(t.documento ?? '').slice(0, 60), estado: String(t.estado ?? ''), bytes: Number(t.bytes) || 0, idade_s: Number.isFinite(envio) ? Math.max(0, Math.round((agora - envio) / 1000)) : null };
  });
  return { total: trabalhos.length, mais_antigo_s: trabalhos.reduce((m, t) => Math.max(m, t.idade_s ?? 0), 0), trabalhos: trabalhos.slice(0, 20) };
}

module.exports = { PORTA, alvosDaVarredura, ipsDasPortas, resultadoDaVarredura, resumoDaFila };
