// Um "aparelho" do teste: contexto de navegador isolado (localStorage próprio) com a impressão interceptada e os erros coletados.
// Cada documento que o app tentaria mandar para o papel pelo NAVEGADOR (impressora nativa ntbPrinter, iframe.print, window.print) é
// registrado aqui em vez de imprimir; documentos pela fila (print_jobs) são medidos no banco (ver Ambiente.ledgerFila).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function esperar(cond, { timeout = 15000, intervalo = 250, motivo = 'condição' } = {}) {
  const fim = Date.now() + timeout;
  let ultimo;
  while (Date.now() < fim) {
    try { const v = await cond(); if (v) return v; } catch (e) { ultimo = e; }
    await sleep(intervalo);
  }
  throw new Error(`tempo esgotado esperando: ${motivo}${ultimo ? ` (${ultimo.message})` : ''}`);
}

const INIT = `(() => {
  const rec = (kind, texto, titulo, html) => { try { window.__ntbDoc(JSON.stringify({ kind, texto: String(texto || '').slice(0, 20000), titulo: String(titulo || ''), html: html ? String(html).slice(0, 400000) : undefined })); } catch (e) {} };
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() {
      const w = desc.get.call(this);
      try { if (w && !w.__ntbPatched) { w.__ntbPatched = true; w.print = () => rec('iframe', w.document.body ? w.document.body.innerText : '', w.document.title, w.document.documentElement.outerHTML); } } catch (e) {}
      return w;
    } });
  } catch (e) {}
  window.print = () => rec('window', '', document.title);
  try { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}'; (document.head || document.documentElement).appendChild(st); } catch (e) {} // indicador do modo dev cobre o 1º botão da barra do celular
  if (window.__ntbNativo) {
    window.ntbPrinter = { printText: async ({ text }) => { rec('nativo', text, ''); return { success: true }; }, printDialog: async ({ title, html }) => { rec('dialogo', html, title); return { success: true }; } };
  }
})();`;

export function classificarDoc(d) {
  const t = `${d.titulo || ''}\n${d.texto || ''}`;
  if (/CANCELAMENTO/i.test(t)) return 'cancelamento';
  if (/FECHAMENTO DE CAIXA|FECHAMENTO DO CAIXA/i.test(t)) return 'fechamento';
  if (/FORMA DE PAGAMENTO|COMPROVANTE DE PAGAMENTO/i.test(t)) return 'comprovante';
  if (/Comprovante -|CONFER[ÊE]NCIA DE CONSUMO|TOTAL:?\s*R\$/i.test(t) && /TOTAL/i.test(t)) return 'comanda';
  if (/Ticket (Cozinha|Bar)|\bCOZINHA\b|\bBAR\b|Pedido #/i.test(t)) return 'pedido';
  return 'outro';
}

export class Dispositivo {
  static errosTodos = [];
  static ultimo = null;
  constructor(browser, nome, { viewport = { width: 1280, height: 900 }, tema = 'light', nativo = false, baseUrl, storageState } = {}) {
    this.browser = browser; this.nome = nome; this.viewport = viewport; this.tema = tema; this.nativo = nativo; this.baseUrl = baseUrl; this.storageState = storageState;
    this.docs = []; this.erros = []; this.silencio = false; // silencio: janela em que erros de rede são esperados (internet derrubada de propósito)
  }
  async iniciar() {
    this.ctx = await this.browser.newContext({ viewport: this.viewport, colorScheme: this.tema, storageState: this.storageState, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await this.ctx.exposeBinding('__ntbDoc', (_src, json) => { try { const d = JSON.parse(json); d.t = Date.now(); d.tipo = classificarDoc(d); this.docs.push(d); } catch { /* ignora */ } });
    await this.ctx.addInitScript(`window.__ntbNativo = ${this.nativo ? 'true' : 'false'};`);
    await this.ctx.addInitScript(INIT);
    this.page = await this.ctx.newPage();
    this._ouvir(this.page);
    return this;
  }
  _ouvir(page) {
    const guarda = (tipo, texto, extra) => { if (this.silencio) return; const e = { nome: this.nome, tipo, texto: String(texto).slice(0, 300), url: page.url(), t: Date.now(), ...extra }; this.erros.push(e); Dispositivo.errosTodos.push(e); };
    page.on('console', (m) => { if (m.type() === 'error') guarda('console', m.text()); });
    page.on('pageerror', (e) => guarda('pageerror', e.message));
    page.on('requestfailed', (r) => { const f = r.failure()?.errorText || ''; if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) guarda('requestfailed', `${r.method()} ${r.url().slice(0, 140)} ${f}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/_next\/|favicon|\.map$/.test(r.url())) guarda('http', `${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`, { status: r.status() }); });
  }
  marcaDocs() { return this.docs.length; }
  docsDesde(marca, tipo) { return this.docs.slice(marca).filter((d) => !tipo || d.tipo === tipo); }
  marcaErros() { return this.erros.length; }
  errosDesde(marca) { return this.erros.slice(marca); }
  async ir(caminho = '/loja') { Dispositivo.ultimo = this; await this.page.goto(`${this.baseUrl}${caminho}`, { waitUntil: 'domcontentloaded' }); }
  async fechar() { try { await this.ctx.close(); } catch { /* já fechado */ } }

  async tentarLogin(email, senha) {
    const p = this.page;
    await p.fill('input[type=email]', email);
    await p.fill('input[type=password]', senha);
    await p.click('button[type=submit]');
  }
  // Login completo. `trocarPara`: nova senha quando for o primeiro acesso (a tela "Crie sua senha" é obrigatória).
  async login(email, senha, { trocarPara } = {}) {
    await this.ir('/loja');
    await this.page.waitForSelector('input[type=email]', { timeout: 30000 });
    await this.tentarLogin(email, senha);
    if (trocarPara) {
      await this.page.waitForSelector('text=Crie sua senha', { timeout: 20000 });
      const campos = this.page.locator('input[type=password]');
      await campos.nth(0).fill(trocarPara); await campos.nth(1).fill(trocarPara);
      await this.page.click('button[type=submit]');
      await this.page.waitForSelector('input[type=email]', { timeout: 20000 });
      await sleep(600);
      await this.tentarLogin(email, trocarPara);
    }
    await this.page.locator('h2:visible, header h1:visible').first().waitFor({ timeout: 30000 });
    await sleep(1500);
  }
  menu(nome) { return this.page.locator('aside').getByRole('button', { name: new RegExp(`^${nome}`) }).first(); }
  async areaTrancada(nome) { return (await this.menu(nome).locator('svg.lucide-lock').count()) > 0; }
  async irArea(nome) { Dispositivo.ultimo = this; await this.menu(nome).click(); await sleep(1200); }
  // Celular: botão da barra de baixo; áreas que não estão lá ficam no menu (hambúrguer).
  async irAreaMobile(nome) {
    Dispositivo.ultimo = this;
    const re = nome === 'Mesas' ? /Mesas/ : new RegExp(nome);
    const cand = () => this.page.locator('button:visible').filter({ hasText: re });
    // o botão da barra de baixo pode vir com selo de contagem ("9+Produção11"): por isso o texto não é ancorado no início
    if (!(await cand().count())) { await this.page.getByRole('button', { name: 'Abrir menu' }).click(); await sleep(700); }
    await cand().first().click();
    await sleep(1200);
    if (await this.page.getByText('Menu Lojista').isVisible().catch(() => false)) { await this.page.keyboard.press('Escape'); await sleep(500); }
  }
  // Título da tela: h2 grande no desktop, h1 do cabeçalho no celular.
  async titulo() { return ((await this.page.locator('h2:visible, header h1:visible').first().textContent().catch(() => '')) || '').trim(); }
  async texto() { return (await this.page.locator('body').innerText()).replace(/[ \t]+/g, ' '); }
  async shot(arquivo) { await this.page.screenshot({ path: arquivo, fullPage: false }); return arquivo; }
}
