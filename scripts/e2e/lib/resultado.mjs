// Relatório do portão: PASSOU / FALHOU / ESPERADO-AINDA-NÃO-IMPLEMENTADO por item, com código de saída.
import fs from 'node:fs';
import path from 'node:path';

export const PASSOU = 'PASSOU';
export const FALHOU = 'FALHOU';
export const PENDENTE = 'ESPERADO-AINDA-NÃO-IMPLEMENTADO';
export const PULADO = 'PULADO';

export class Relatorio {
  constructor({ saida }) {
    this.itens = [];
    this.saida = saida;
    this.secao = '';
    this.capturar = null; // async (nome) => caminho do screenshot (preenchido pelo fluxo)
  }
  entrar(secao) { this.secao = secao; console.log(`\n== ${secao}`); }
  registrar(nome, status, detalhe) {
    const item = { secao: this.secao, nome, status, detalhe: detalhe ? String(detalhe).slice(0, 900) : undefined };
    this.itens.push(item);
    const marca = status === PASSOU ? 'PASSOU ' : status === FALHOU ? 'FALHOU ' : status === PULADO ? 'PULADO ' : 'PENDENTE';
    console.log(`  [${marca}] ${nome}${detalhe && status !== PASSOU ? `\n            -> ${String(detalhe).split('\n').join('\n               ').slice(0, 900)}` : ''}`);
    return item;
  }
  // Executa uma verificação. `pendente`: motivo (string) quando o comportamento ESPERADO ainda não existe no código
  // (outra frente em andamento): falhar vira ESPERADO-AINDA-NÃO-IMPLEMENTADO; passar vira PASSOU (e avisa para tirar a marca).
  async passo(nome, fn, { pendente } = {}) {
    try {
      await fn();
      this.registrar(nome, PASSOU, pendente ? `(marcado como pendente, mas passou: ${pendente} — remova a marca)` : undefined);
      return true;
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (pendente) { this.registrar(nome, PENDENTE, `${pendente}\n${msg}`); return false; }
      let extra = '';
      try { if (this.capturar) { const p = await this.capturar(nome); if (p) extra = `\n[captura: ${p}]`; } } catch { /* sem captura */ }
      this.registrar(nome, FALHOU, msg + extra);
      return false;
    }
  }
  pular(nome, motivo) { this.registrar(nome, PULADO, motivo); }
  contagem() {
    const c = { [PASSOU]: 0, [FALHOU]: 0, [PENDENTE]: 0, [PULADO]: 0 };
    this.itens.forEach((i) => { c[i.status] = (c[i.status] ?? 0) + 1; });
    return c;
  }
  resumo() {
    const c = this.contagem();
    console.log('\n================ RESUMO DO PORTÃO (fluxo completo) ================');
    let ult = '';
    for (const i of this.itens) {
      if (i.secao !== ult) { console.log(`\n${i.secao}`); ult = i.secao; }
      const marca = i.status === PASSOU ? 'PASSOU ' : i.status === FALHOU ? 'FALHOU ' : i.status === PULADO ? 'PULADO ' : 'ESPERADO-AINDA-NÃO-IMPLEMENTADO';
      console.log(`  ${marca.padEnd(8)} ${i.nome}`);
    }
    console.log(`\nTotal: ${c[PASSOU]} passou, ${c[FALHOU]} falhou, ${c[PENDENTE]} esperado-ainda-não-implementado, ${c[PULADO]} pulado`);
    if (this.saida) {
      try { fs.mkdirSync(path.dirname(this.saida), { recursive: true }); fs.writeFileSync(this.saida, JSON.stringify({ quando: new Date().toISOString(), contagem: c, itens: this.itens }, null, 2)); } catch { /* sem arquivo */ }
    }
    return c;
  }
}
