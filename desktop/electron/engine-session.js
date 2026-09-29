// Loja do motor de impressão guardada em disco: o app reabre (atualização, reinício do PC) e volta a imprimir
// sozinho, sem esperar alguém fazer login. Só guarda loja + URL + chave anon pública (a mesma do bundle).
const fs = require('fs');
const path = require('path');

const arquivo = (dir) => path.join(dir, 'print-engine-session.json');

function salvar(dir, params) {
  try {
    fs.writeFileSync(arquivo(dir), JSON.stringify({ storeId: params.storeId, supabaseUrl: params.supabaseUrl, supabaseAnonKey: params.supabaseAnonKey }), 'utf8');
  } catch { /* sem disco gravável: só perde o autostart */ }
}

function carregar(dir) {
  try {
    const p = JSON.parse(fs.readFileSync(arquivo(dir), 'utf8'));
    if (p && p.storeId && p.supabaseUrl && p.supabaseAnonKey) return p;
  } catch { /* arquivo ausente/corrompido */ }
  return null;
}

function limpar(dir) {
  try { fs.unlinkSync(arquivo(dir)); } catch { /* já não existe */ }
}

// 'iniciar' quando há loja salva e o motor ainda não está rodando.
function decidirInicio(salva, rodando) {
  return salva && !rodando ? 'iniciar' : 'nada';
}

module.exports = { salvar, carregar, limpar, decidirInicio };
