const { app, BrowserWindow, Menu, Tray, nativeImage, protocol, net, shell, Notification, ipcMain, dialog } = require('electron');

// Espelha lib/appVersion.ts: número interno 1.x (updater), exibido como 0.x (beta).
const formatAppVersion = (v) => { if (!v) return ''; const [, mi = '0', pa = '0'] = String(v).split('.'); return `v0.${mi}.${pa} (beta)`; };
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const printEngine = require('./print-engine');

// Achado real (2026-09-10, pedido do dono: "a atualização não está
// funcionando"): antes disso, o único jeito de saber o que o
// autoUpdater fez numa loja era a Notification passageira (some sozinha,
// ninguém tira print às 7h da manhã) — sem log nenhum em disco, um
// problema real (rede, servidor de update fora do ar, instalador
// rejeitado) e um "não aconteceu nada porque já tá atualizado" eram
// indistinguíveis à distância. Log simples (sem dependência nova tipo
// electron-log) em texto, truncado se passar de 1MB pra nunca crescer
// sem limite — dá pra pedir pro dono da loja abrir esse arquivo (ou
// mandar print) quando desconfiar que não atualizou.
function appendLog(fileName, msg) {
  try {
    const filePath = path.join(app.getPath('userData'), fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1_000_000) {
      fs.truncateSync(filePath, 0);
    }
    fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Nunca deixar uma falha de log (disco cheio, permissão) derrubar a
    // atualização nem a impressão em si — o log é diagnóstico, não é
    // crítico.
  }
}
const logUpdate = (msg) => appendLog('update.log', msg);
// Mesmo raciocínio do update.log, agora pra impressão: quando a loja diz
// "não imprimiu", o único jeito de saber de longe se o app tentou (e o
// que a impressora respondeu) é ter isso em disco.
const logPrint = (msg) => appendLog('print.log', msg);
// Diagnóstico de tela branca/travamento (ver os handlers em createWindow).
// Arquivo próprio pra poder pedir "manda o renderer.log" sem vir junto o
// barulho de atualização e impressão.
const logRenderer = (msg) => appendLog('renderer.log', msg);

// Estado da atualização, no processo principal — a tela PERGUNTA por ele em
// vez de depender só de ter ouvido o evento na hora certa (ver o handler de
// 'update-downloaded'). `situacao` é o que a tela mostra quando alguém
// clica em "Procurar atualização": até existir esse botão, uma loja não
// tinha NENHUM jeito de saber se o app checou, se está atualizado ou se a
// checagem falhou — só dava pra esperar e torcer.
const estadoUpdate = {
  versaoBaixada: null,
  situacao: 'nao-checado',
  detalhe: null,
};

// Achado real (QA, 2026-09-08): lojas com "envia pedido direto pra
// impressão" (order_flow: 'direct_print', ver AGENTS.md/CaixaPrintStation)
// disparam window.print() a cada pedido novo — no navegador normal isso já
// funciona sem fricção (impressora padrão memorizada), mas dentro do
// Electron abre o diálogo NATIVO de impressão do sistema operacional e
// TRAVA a janela até alguém clicar manualmente, quebrando exatamente o
// "imprime sozinho" que é a razão do PDV físico existir. `kiosk-printing`
// é um switch documentado do Chromium/Electron: com ele, window.print()
// imprime direto na impressora padrão do SO, sem diálogo nenhum — mesmo
// princípio já usado por apps de PDV/kiosk em produção. Precisa ser
// setado ANTES de app.whenReady().
//
// ⚠️ Ressalva verificada nesta sessão (testado no Mac de desenvolvimento,
// NÃO num Windows real — o único alvo de build deste app, ver package.json
// build.win): mesmo com uma impressora padrão configurada, o diálogo NATIVO
// do macOS continuou aparecendo com este switch ligado. Pesquisa confirma
// que esse é um limite conhecido do Chromium/Electron: no Windows/Linux, o
// diálogo que kiosk-printing suprime é o do PRÓPRIO Chromium; no macOS, a
// impressão passa pelo painel nativo da Apple, que o switch não controla.
// Como este app só builda pra Windows, o comportamento esperado lá é
// diferente do observado aqui — mas isso continua sendo uma pendência real
// de verificação numa máquina Windows física (mesma categoria de "só
// confirma num Windows de verdade" já registrada no plano do app desktop),
// não uma confirmação de que funciona.
app.commandLine.appendSwitch('kiosk-printing');

// Sem isso, rodar via `electron .` (modo dev, sem empacotar) mostra
// "Electron" no menu/dock/taskbar em vez do nome real — o .exe empacotado
// (electron-builder já usa `productName` do package.json pra isso) não tem
// esse problema, mas forçar aqui também deixa o app correto em qualquer
// cenário, sem depender de lembrar que só o build empacotado "conserta".
app.setName('Norte Vendas');
// Windows agrupa/rotula a janela na barra de tarefas pelo AppUserModelId,
// não pelo nome do processo — sem isso, builds sem instalador (portable/
// dev) podem aparecer como "electron.exe" na barra de tarefas do Windows.
app.setAppUserModelId('com.norteparanegocios.ntbvendas');

// Segundo plano (pedido do dono, 2026-09-18): "o aplicativo funciona em segundo
// plano, mesmo fechado, com o computador ligado, pra continuar imprimindo".
// O motor de impressão e a auto-impressão de comanda rodam neste app (motor no
// processo principal, auto-impressão no renderer) — então fechar a janela NÃO
// pode encerrar o app: só esconde na bandeja. Encerrar de verdade = "Sair" no
// menu da bandeja (isQuitting).
let mainWindow = null;
let tray = null;
let isQuitting = false;
const iniciouEscondido = process.argv.includes('--hidden');

// Uma instância só: sem isso, abrir o app de novo (ou o Windows abrindo no
// login + o usuário clicando no atalho) duplicava o motor de impressão e a
// comanda saía 2x.
const temInstanciaUnica = app.requestSingleInstanceLock();
if (!temInstanciaUnica) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function mostrarJanela() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sairDeVez() {
  isQuitting = true;
  app.quit();
}

function criarBandeja() {
  if (tray) return;
  let icone = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  if (!icone.isEmpty()) icone = icone.resize({ width: 16, height: 16 });
  tray = new Tray(icone);
  tray.setToolTip('Norte Vendas — imprimindo em segundo plano');
  const montarMenu = () => Menu.buildFromTemplate([
    { label: 'Abrir Norte Vendas', click: mostrarJanela },
    {
      label: 'Iniciar com o computador',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        appendLog('update.log', `INFO iniciar com o computador = ${item.checked}`);
      },
    },
    { type: 'separator' },
    { label: 'Sair (para de imprimir)', click: sairDeVez },
  ]);
  tray.setContextMenu(montarMenu());
  tray.on('click', mostrarJanela);
}

// Sem menu de navegador — "cara de PDV", não de app genérico.
Menu.setApplicationMenu(null);

const OUT_DIR = path.join(__dirname, '..', 'webapp', 'out');

// A exportação estática do Next (next.config.ts, output: 'export') emite
// caminhos de asset/navegação root-absolutos (ex.: href="/_next/static/
// chunks/x.js", href="/loja/") — carregados via win.loadFile() (file://),
// esses caminhos resolveriam contra a raiz do sistema de arquivos do SO,
// não contra a pasta do bundle, e nada carregaria. Registrar um protocolo
// próprio (app://) que serve os arquivos de OUT_DIR resolve isso: os
// caminhos absolutos passam a resolver contra a origem app://bundle/,
// exatamente como resolveriam contra a raiz de um domínio http normal.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    title: 'Norte Vendas',
    // Aberto pelo Windows no login (--hidden): sobe direto na bandeja.
    show: !(iniciouEscondido && !isQuitting && tray),
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Janela escondida na bandeja NÃO pode ter timers/Realtime/polling
      // estrangulados pelo Chromium — é ela que dispara a auto-impressão.
      backgroundThrottling: false,
      // Preload roda sandboxed por padrão (Electron 20+, mesmo com
      // contextIsolation:true) — nesse modo `require()` só resolve um
      // punhado de módulos nativos (ex. 'electron'), NUNCA um arquivo
      // local por caminho relativo. `require('../package.json')` direto
      // no preload.js quebrava o script inteiro silenciosamente (sem
      // erro visível na tela), derrubando com ele o `contextBridge.
      // exposeInMainWorld` — não só a versão nova ficava faltando, a
      // MESMA falha também zerava `apiBaseUrl`, fazendo o app parecer
      // "funcionando" só porque caía direto no cache offline. Repassar a
      // versão como `additionalArguments` evita `require` de arquivo
      // local: preload.js lê de `process.argv`, que continua disponível
      // mesmo sandboxed.
      additionalArguments: [`--ntb-app-version=${app.getVersion()}`],
    },
  });

  win.loadURL('app://bundle/index.html');

  // Fechar a janela só esconde (o app continua na bandeja imprimindo).
  win.on('close', (e) => {
    if (isQuitting || process.platform === 'darwin') return;
    e.preventDefault();
    win.hide();
    if (!win.__avisouBandeja) {
      win.__avisouBandeja = true;
      new Notification({
        title: 'Norte Vendas',
        body: 'O app continua rodando em segundo plano para imprimir. Para encerrar, use "Sair" no ícone da bandeja.',
      }).show();
    }
  });

  // TELA BRANCA (o sintoma relatado na loja em 2026-09-11: "voltando para
  // telas tá dando tela branca"). Quando o processo do RENDERER morre —
  // falta de memória num PC fraco de loja, crash do Chromium, o SO matando
  // o processo — a janela não fecha nem mostra erro: ela simplesmente fica
  // branca pra sempre. Reproduzido nesta máquina em 2026-09-12: janela
  // branca, processo principal vivo, ZERO renderer, e nem o depurador
  // conseguia parar a página (não tinha JS rodando pra parar).
  //
  // Sem este handler não existe nem recuperação nem rastro: pra quem está
  // no caixa, "o sistema sumiu" no meio do expediente e a única saída é
  // fechar e abrir o app. Aqui o app se recarrega sozinho e deixa registrado
  // o motivo no log (`details.reason` diz se foi memória, crash ou morte
  // forçada).
  //
  // Trava contra loop: se recarregar não resolve (ex. bundle corrompido),
  // 3 tentativas em 1 minuto param as recargas de VEZ (a trava é um
  // interruptor, não uma janela que reabre) — melhor uma tela parada com
  // aviso do que um pisca-pisca infinito impossível de usar.
  let recargas = [];
  let desistiuDeRecarregar = false;
  win.webContents.on('render-process-gone', (_event, details) => {
    logRenderer(`ERROR renderer morreu (motivo=${details.reason}, exitCode=${details.exitCode})`);
    if (win.isDestroyed()) return;
    if (desistiuDeRecarregar) {
      logRenderer('ERROR ja tinha desistido de recarregar — nao tenta de novo');
      return;
    }
    const agora = Date.now();
    recargas = recargas.filter((t) => agora - t < 60_000);
    // A tentativa RECUSADA também entra na conta (era o bug: sem isto, a
    // janela deslizante esvaziava sozinha em 60s e o app voltava a
    // recarregar pra sempre, a 3 por minuto, em vez de desistir).
    recargas.push(agora);
    if (recargas.length > 3) {
      desistiuDeRecarregar = true;
      logRenderer('ERROR 3 recargas em 1 min sem resolver — desistindo de vez');
      // Falhar em silêncio deixaria o operador olhando pra uma tela branca
      // sem saber que o app desistiu. Diálogo nativo do SO porque neste
      // ponto NÃO existe página viva pra mostrar qualquer coisa.
      //
      // `showMessageBox` com JANELA-PAI, e NUNCA `showErrorBox` nem
      // `showMessageBox` sem pai: o motor de impressão (print-engine.js)
      // roda neste mesmo processo e sobrevive à morte do renderer — é ele
      // que continua imprimindo as comandas que os OUTROS terminais da loja
      // enfileiram. Um diálogo bloqueante trava o event loop, e com ele o
      // `setInterval` da fila, o heartbeat e os sockets da porta 9100. Pior:
      // a fila só busca job com `created_at` dentro dos últimos 30 min
      // (IDADE_MAXIMA_JOB_MS), então um diálogo esquecido aberto por mais
      // tempo que isso faria os jobs acumulados serem descartados como
      // obsoletos — comanda que nunca sai.
      //
      // A janela-pai é o que torna a chamada realmente assíncrona (vira
      // sheet). Medido nesta máquina com um Electron de teste (2026-09-13):
      // sem pai, `showMessageBox` congela os timers igualzinho ao
      // `showErrorBox` — a linha seguinte à chamada nem roda; com `win` como
      // pai, a chamada retorna na hora e os timers seguem tiquetaqueando.
      // `win` aqui é sempre válida: o `isDestroyed()` no topo do handler já
      // garantiu isso, e a janela existe mesmo com o renderer morto.
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Norte Vendas',
        message: 'O aplicativo travou várias vezes seguidas e não conseguiu se recuperar sozinho.',
        detail: 'Use "Sair" no ícone da bandeja e abra o aplicativo de novo. Se continuar acontecendo, chame o suporte e mande o arquivo renderer.log.',
        buttons: ['OK'],
      }).catch(() => {});
      return;
    }
    logRenderer('INFO recarregando a janela sozinho');
    win.webContents.reload();
    // A recuperação era 100% silenciosa: a tela piscava e voltava limpa, o
    // que é indistinguível de "o pagamento foi" pra quem estava no meio de
    // um. O estado já tinha morrido junto com o renderer — o que faltava
    // era CONTAR isso pra quem está no caixa, assim que a página existir de
    // novo (antes do did-finish-load não há ninguém pra ouvir o evento).
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('ntb-recuperou-de-falha');
    });
  });

  // Não é a mesma coisa que morrer: aqui o renderer está VIVO mas travado
  // (laço infinito, uma renderização pesada demais). A tela congela em vez
  // de ficar branca. Só registra — matar/recarregar por conta própria
  // poderia interromper uma venda que ia destravar sozinha.
  win.webContents.on('unresponsive', () => {
    logRenderer('WARN janela sem resposta (renderer travado)');
  });
  win.webContents.on('responsive', () => {
    logRenderer('INFO janela voltou a responder');
  });

  // Terceira origem possível de tela branca, diferente das duas acima: o
  // arquivo não carregou (protocolo app:// falhando, bundle incompleto).
  // Também vira janela branca silenciosa. Uma tentativa extra depois de 2s
  // resolve o caso transitório sem arriscar loop.
  let jaTentouRecarregar = false;
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logRenderer(`ERROR falhou ao carregar ${validatedURL} (${errorCode} ${errorDescription})`);
    if (jaTentouRecarregar) return;
    jaTentouRecarregar = true;
    setTimeout(() => {
      // A janela pode ter sido fechada nesses 2s (inclusive por
      // quitAndInstall durante uma atualização) — mexer num BrowserWindow
      // destruído lança TypeError no processo principal.
      if (win.isDestroyed()) return;
      logRenderer('INFO tentando carregar de novo');
      win.loadURL('app://bundle/index.html');
    }, 2000);
  });

  // Nunca abrir popup dentro do app (sem barra de navegação pra fechar) —
  // qualquer window.open/target=_blank vira uma aba no navegador padrão do
  // sistema operacional.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  if (!temInstanciaUnica) return;
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    // trailingSlash: true no Next.js (ver next.config.ts) faz todo link
    // gerado apontar pra "/rota/" (com barra) em vez de "/rota" — inclusive
    // a raiz "/". Sempre que o caminho terminar em barra, serve o
    // index.html daquele diretório.
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(OUT_DIR, pathname);
    // Guarda básica contra path traversal: o caminho resolvido precisa
    // continuar dentro de OUT_DIR.
    if (!path.resolve(filePath).startsWith(path.resolve(OUT_DIR))) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  criarBandeja();
  mainWindow = createWindow();
  // Inicia com o Windows (escondido na bandeja) — só no app instalado. O dono
  // pode desligar pelo menu da bandeja; a escolha dele é respeitada depois da
  // primeira execução (não reativa sozinho).
  if (app.isPackaged && process.platform === 'win32') {
    const chave = path.join(app.getPath('userData'), 'autostart-configurado');
    if (!fs.existsSync(chave)) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
      try { fs.writeFileSync(chave, new Date().toISOString()); } catch { /* ignore */ }
    }
  }

  // Confere atualização ao abrir; baixa em background se houver, aplica
  // no próximo reinício (comportamento padrão do electron-updater, não
  // interrompe quem está no meio de uma venda). Pedido do dono
  // (2026-09-08): sempre dar um retorno rápido e visível de que o app
  // conferiu — "atualizado" quando já está na última versão, ou avisando
  // que baixou uma nova. `checkForUpdates()` (não `checkForUpdatesAndNotify`)
  // pra controlar a notificação nós mesmos, com as duas mensagens —
  // `checkForUpdatesAndNotify` só notifica no caso de update baixado.
  // electron-updater loga sozinho (checando/baixando/progresso/erro) em
  // qualquer objeto com .info/.warn/.error/.debug — plugado aqui pra
  // tudo cair no update.log, sem precisar instrumentar cada evento à mão.
  autoUpdater.logger = {
    info: (m) => logUpdate(`INFO ${m}`),
    warn: (m) => logUpdate(`WARN ${m}`),
    error: (m) => logUpdate(`ERROR ${m}`),
    debug: (m) => logUpdate(`DEBUG ${m}`),
  };
  // Explícitos mesmo sendo o default do electron-updater — clareza de
  // intenção: baixa sozinho ao achar update, aplica sozinho quando o app
  // fechar (nunca interrompe o app rodando, nunca precisa clique manual).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    // Rede instável/DNS fora do ar não pode derrubar o app — sem esse
    // listener, um erro do autoUpdater (um EventEmitter) sem handler
    // registrado lança e mata o processo principal. Sem Notification aqui
    // de propósito: rede de loja cai e volta o tempo todo, e um popup a
    // cada tentativa falha seria só ruído — fica só no log.
    logUpdate(`ERROR (evento) ${err?.stack || err}`);
    estadoUpdate.situacao = 'erro';
    estadoUpdate.detalhe = String(err?.message || err);
  });
  autoUpdater.on('checking-for-update', () => {
    estadoUpdate.situacao = 'checando';
    estadoUpdate.detalhe = null;
  });
  autoUpdater.on('update-available', (info) => {
    estadoUpdate.situacao = 'baixando';
    estadoUpdate.detalhe = info?.version || null;
  });
  autoUpdater.on('update-not-available', () => {
    estadoUpdate.situacao = 'atualizado';
    estadoUpdate.detalhe = app.getVersion();
    new Notification({
      title: 'Norte Vendas',
      body: `Atualizado (${formatAppVersion(app.getVersion())})`,
    }).show();
  });
  autoUpdater.on('update-downloaded', (info) => {
    // Guardado pra quem perguntar DEPOIS (ver ipcMain 'ntb-update-status').
    // Achado real (2026-09-13, cobrando "nem aparece o botão de atualizar"):
    // o banner só sabia da atualização pelo evento ao vivo abaixo — se o
    // download terminasse antes da tela montar, ou se a janela recarregasse
    // depois (inclusive pela recuperação automática de tela branca que
    // acabou de entrar), o aviso se perdia PRA SEMPRE e a atualização
    // baixada ficava invisível até alguém fechar o app por outro motivo.
    estadoUpdate.versaoBaixada = info.version;
    estadoUpdate.situacao = 'baixada';
    estadoUpdate.detalhe = info.version;
    new Notification({
      title: 'Norte Vendas',
      body: `Nova versão baixada (${formatAppVersion(info.version)}) — será aplicada ao reabrir o app.`,
    }).show();
    // Pedido direto do dono (2026-09-10): a Notification acima é
    // passageira e macOS/Windows podem suprimi-la (foco ocupado,
    // "não perturbe") — sem nenhum jeito de saber, de olho na tela, que
    // tem atualização esperando. Manda pra TODAS as janelas abertas um
    // aviso que fica na tela até alguém agir (ver
    // components/DesktopUpdateBanner.tsx): "Atualizar agora" chama
    // `quitAndInstall()` na hora (o app fecha e reabre já atualizado);
    // "Depois" só esconde o banner até o próximo reinício — a instalação
    // automática ao fechar (autoInstallOnAppQuit) continua garantida de
    // qualquer forma, o botão só existe pra quem quer atualizar JÁ, sem
    // esperar sozinho fechar o app sem saber se vai mesmo aplicar.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('ntb-update-downloaded', { version: info.version });
    }
  });
  autoUpdater.checkForUpdates();

  // Chamado pelo botão "Atualizar agora" do banner (ver preload.js/
  // DesktopUpdateBanner.tsx). `quitAndInstall()` fecha o app e roda o
  // instalador NSIS silenciosamente — reabre sozinho na versão nova.
  // A tela pergunta "e aí, como está a atualização?" — resolve tanto o
  // banner perdido (quando o download termina antes da tela existir) quanto
  // o botão manual de procurar atualização na barra lateral.
  ipcMain.handle('ntb-update-status', () => ({
    versaoAtual: app.getVersion(),
    versaoBaixada: estadoUpdate.versaoBaixada,
    situacao: estadoUpdate.situacao,
    detalhe: estadoUpdate.detalhe,
    // Em desenvolvimento (`electron .`, sem instalador) o electron-updater
    // NUNCA checa nada — ele registra "Skip checkForUpdates because
    // application is not packed" e sai. Sem dizer isso pra tela, procurar
    // atualização no Mac de desenvolvimento parece um app quebrado, quando
    // na verdade é o comportamento esperado fora do app instalado.
    empacotado: app.isPackaged,
  }));

  // Botão "Procurar atualização" (barra lateral do painel do lojista).
  // Existe porque a checagem automática só roda ao abrir o app e a cada 4h:
  // uma loja que deixa o PDV ligado o dia inteiro podia ficar horas sem
  // saber que já existe versão nova, sem nenhum jeito de forçar.
  ipcMain.handle('ntb-check-update', async () => {
    if (!app.isPackaged) {
      logUpdate('INFO checagem manual ignorada — app rodando sem instalador (modo desenvolvimento)');
      return { ok: false, empacotado: false };
    }
    // Rechecar com uma versão já BAIXADA faz o electron-updater reemitir
    // 'update-downloaded' (acha o arquivo no cache): segunda notificação do
    // sistema e um toast dizendo "baixando" quando não há nada baixando.
    if (estadoUpdate.versaoBaixada) {
      return { ok: true, empacotado: true, versaoDisponivel: estadoUpdate.versaoBaixada, jaBaixada: true };
    }
    logUpdate('INFO checagem manual solicitada pelo botão "Procurar atualização"');
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, empacotado: true, versaoDisponivel: r?.updateInfo?.version || null };
    } catch (e) {
      logUpdate(`ERROR checagem manual falhou: ${e?.message || e}`);
      return { ok: false, empacotado: true, erro: String(e?.message || e) };
    }
  });

  ipcMain.handle('ntb-install-update', () => {
    logUpdate('INFO Instalação solicitada manualmente pelo botão "Atualizar agora"');
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  // Impressão de rede/USB embutida (ver print-engine.js). Chamado pelo
  // renderer logo depois do login, com a loja e as credenciais do próprio
  // bundle — nada fica hardcoded aqui, nem em arquivo de config.
  ipcMain.handle('ntb-start-print-engine', (_event, params) => {
    const { storeId, supabaseUrl, supabaseAnonKey } = params || {};
    if (!storeId || !supabaseUrl || !supabaseAnonKey) {
      logPrint('WARN pedido de início sem storeId/credenciais — ignorado');
      return { ok: false, reason: 'parâmetros ausentes' };
    }
    return printEngine.start(storeId, {
      baseUrl: supabaseUrl,
      anonKey: supabaseAnonKey,
      log: logPrint,
    });
  });
  // Logout / troca de loja: para de imprimir da loja anterior na hora.
  // Sem isso, um PDV que troca de loja no mesmo app continuaria puxando
  // a fila da loja antiga.
  ipcMain.handle('ntb-stop-print-engine', () => {
    logPrint('INFO motor de impressão parado (logout/troca de loja)');
    printEngine.stop();
    return { ok: true };
  });

  // Cupom fiscal (NFC-e/NF-e) na impressora física do caixa (2026-09-15,
  // pedido direto da reunião de 2026-09-10: "comanda e nota fiscal têm que
  // ir pra mesma coisa, que é a caixa"). Histórico de tentativas na mesma
  // sessão: (1)-(3) o motor de PDF do PRÓPRIO Electron (`webContents.
  // print`) saiu como borrão cinza, mesmo corrigindo tamanho de página —
  // mas o usuário confirmou que abrir o PDF manualmente e mandar imprimir
  // (app padrão de PDF da loja) imprime CERTO na mesma impressora, então
  // nunca foi a impressora/driver. (4) verbo Shell "PrintTo" (mirar uma
  // impressora específica) falhou porque o app padrão de PDF da loja é o
  // Microsoft Edge, que não registra esse verbo. (5) verbo genérico
  // "Print" exigiria a impressora do caixa virar a PADRÃO do Windows —
  // rejeitado pelo dono (a loja tem outras impressoras/fluxos que dependem
  // de imprimir em OUTRAS impressoras, não dá pra trocar a padrão global).
  //
  // Solução definitiva: embute o SumatraPDF (leitor de PDF gratuito e
  // portátil — um único .exe, sem instalação, sem escrever no registro,
  // `desktop/vendor/SumatraPDF.exe`, baixado oficial de
  // sumatrapdfreader.org) — ele tem suporte de linha de comando NATIVO pra
  // imprimir silenciosamente numa impressora ESPECÍFICA por nome
  // (`-print-to`), sem depender de nenhum verbo do Shell nem de qual é o
  // app padrão de PDF da loja. É a mesma técnica usada por incontáveis
  // sistemas de PDV/nota fiscal pra exatamente este problema.
  const sumatraPath = path.join(process.resourcesPath || path.join(__dirname, '..'), 'vendor', 'SumatraPDF.exe');

  // Impressão direta pela rede local (IP:porta), sem passar pelo servidor:
  // usado quando a internet cai (a fila de impressão fica no servidor).
  ipcMain.handle('ntb-print-direct-network', async (_event, params) => {
    const { ip, port, content, raw } = params || {};
    if (!ip || typeof content !== 'string') return { ok: false, reason: 'parâmetros ausentes' };
    try {
      await printEngine.printDirectNetwork(ip, Number(port) || 9100, content, Boolean(raw));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  ipcMain.handle('ntb-print-pdf-silent', async (_event, params) => {
    const { pdfUrl, printerName } = params || {};
    if (!pdfUrl || !printerName) {
      logPrint('WARN impressão de PDF sem pdfUrl/printerName — ignorada');
      return { ok: false, reason: 'parâmetros ausentes' };
    }
    if (!fs.existsSync(sumatraPath)) {
      logPrint(`ERROR SumatraPDF.exe não encontrado em ${sumatraPath}`);
      return { ok: false, reason: 'SumatraPDF.exe ausente no pacote instalado' };
    }
    const tmpFile = path.join(app.getPath('temp'), `ntb-cupom-fiscal-${Date.now()}.pdf`);
    try {
      const pdfBytes = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer());
      fs.writeFileSync(tmpFile, pdfBytes);

      await new Promise((resolve, reject) => {
        execFile(
          sumatraPath,
          ['-print-to', printerName, '-print-settings', 'noscale', '-silent', '-exit-when-done', tmpFile],
          { timeout: 30000 },
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
      logPrint(`INFO cupom fiscal impresso em "${printerName}" via SumatraPDF`);
      return { ok: true };
    } catch (e) {
      logPrint(`ERROR ao imprimir cupom fiscal em "${printerName}" via SumatraPDF: ${e.message}`);
      return { ok: false, reason: e.message };
    } finally {
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }, 15000);
    }
  });

  // Achado real: um PDV de restaurante fica ligado o turno inteiro (às
  // vezes dias, se ninguém desliga o PC) — checar só uma vez ao abrir o
  // app significa que uma loja que raramente reinicia o app pode nunca
  // perceber que existe atualização nova. Recheca a cada 4h enquanto o
  // app estiver aberto; `autoInstallOnAppQuit` continua garantindo que a
  // instalação em si só acontece quando o app fechar, nunca no meio do
  // expediente.
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);

  // App na bandeja nunca "fecha", então a instalação de "ao sair" nunca
  // aconteceria. Pedido do dono (2026-09-18): pode instalar de madrugada.
  // Se já baixou versão nova e são entre 04:00 e 05:59, instala (silencioso) —
  // horário em que a loja está fechada; o app reabre sozinho e o motor de
  // impressão volta com a sessão salva.
  setInterval(() => {
    if (!estadoUpdate.versaoBaixada) return;
    const hora = new Date().getHours();
    if (hora < 4 || hora > 5) return;
    logUpdate(`INFO instalando v${estadoUpdate.versaoBaixada} de madrugada (${hora}h)`);
    isQuitting = true;
    autoUpdater.quitAndInstall(true, true);
  }, 10 * 60 * 1000);

  app.on('activate', mostrarJanela);
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  // Com a janela escondida na bandeja esta janela nunca fecha de fato; só chega
  // aqui ao encerrar (Sair / quitAndInstall).
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
