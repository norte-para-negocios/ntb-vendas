'use client';

// Reconciliação de impressão do Caixa (redesign 2026-08-23).
//
// O QUE É: substitui a antiga "Estação de Impressão" (`EstacaoModule.tsx`,
// rota `/estacao`, apagadas nesta sessão) — um aparelho fixo, dedicado, que
// alguém deixava ligado na cozinha. O dono rejeitou esse desenho na prática:
// *"na cozinha não vai ter um tablet, não vai ter um equipamento. O único
// equipamento vai ter no caixa"*. A impressora da cozinha é de rede (IP
// próprio), configurada como padrão no SISTEMA OPERACIONAL do aparelho do
// caixa (mesma ideia de instalar qualquer impressora) — então
// `window.print()`, disparado do navegador do caixa, já sai por ela sem
// nenhum dispositivo/rota dedicados.
//
// O QUE ESTE ARQUIVO FAZ: roda em segundo plano, dentro da sessão normal do
// caixa (montado em `StoreLayout`, sobrevive à troca de aba Mesas↔Balcão),
// pra cobrir TODOS os caminhos que não têm "aparelho próprio" pra imprimir
// no momento em que o pedido é criado — autoatendimento do cliente via QR,
// Balcão, e (desde a revisão crítica de 2026-08-23, ver abaixo) também o
// garçom.
//
// Revisão crítica 2026-08-23 ("waiter-launched orders print nowhere real,
// silently"): até aqui, o pedido lançado pelo garçom (`TablesView.
// handleAddItem`) tentava imprimir na hora, no PRÓPRIO aparelho do garçom —
// e essa reconciliação ignorava esses itens de propósito (`added_by_role
// !== 'garcom'`), assumindo que já tinham sido tratados. Confirmado direto
// com o dono: o celular do garçom NÃO tem acesso à impressora de rede da
// cozinha — só o aparelho do Caixa tem. `window.print()` "tinha sucesso" no
// aparelho do garçom mesmo sem nenhuma impressora configurada ali, e o
// pedido nunca chegava na cozinha, sem avisar ninguém. Correção, nos dois
// lados: `handleAddItem` parou de tentar imprimir (o pedido continua criado
// exatamente como antes), e o filtro `added_by_role !== 'garcom'` abaixo foi
// removido — item de garçom agora recebe o MESMO tratamento de QR/Balcão.
//
// GARANTIA CENTRAL (herdada do EstacaoModule.tsx original, ver git log
// daquele arquivo pro histórico completo de revisão): uma cozinha nunca pode
// parar de receber pedido em silêncio. Cada mecanismo abaixo (dedupe por
// localStorage com teto, reconciliação em intervalo fixo além do Realtime,
// try/catch em volta do corpo inteiro do reconcile — não só das chamadas de
// impressão —, distinção entre "fila genuinamente vazia" e "a própria
// chamada ao servidor falhou") é uma resposta direta a uma forma real de
// isso acontecer, já encontrada e corrigida no station original.
//
// CORTE DE ATIVAÇÃO (`activatedAt`, adicionado na revisão crítica de
// 2026-08-23 — "missing activation cutoff makes backlog-spew deterministic"):
// `fetch_kitchen_orders_secure` devolve TODO item não-`delivered`/`canceled`
// da loja, sem nenhum corte de tempo (migration 021) — numa loja
// `direct_print`, nada além de FECHAR A MESA avança esse status, então numa
// sessão de caixa nova (outro celular, aba anônima, localStorage limpo, o
// dono ou a conta universal abrindo o painel pra checar algo) o único freio
// contra reimprimir tudo de novo é o dedupe local (`printedIds`), que é
// vazio nessa sessão. Sem corte, a PRIMEIRA reconciliação dessa sessão nova
// reimprimiria cada item ainda aberto do turno inteiro — não é uma corrida
// rara, é determinístico. `activatedAt` (hora do mount desta sessão,
// recarregado junto com `printedIds` sempre que a loja muda) resolve isso
// sem imprimir menos: item criado ANTES da ativação desta sessão não é
// auto-impresso aqui (pode já ter sido impresso por outra sessão), mas
// continua listado em "Pedidos do Dia" (`TablesView.sentHistoryItems`,
// StoreModule.tsx) com um botão manual "Reimprimir" — nunca fica invisível,
// só para de ser reimpresso às cegas. Esse botão manual, por sua vez, só é
// oferecido no aparelho de caixa de verdade (Critical #2 da revisão de
// branch 2026-08-23, ver `isCaixaRole`/`canReprint` em StoreModule.tsx) —
// nunca a um garçom, que não teria como saber se `window.print()` "com
// sucesso" imprimiu algo real. **Correção de relógio (mesma revisão,
// Critical #2 — "activation cutoff trusts the device's clock, not the
// server's")**: `activatedAt` nascia de `new Date()`, o relógio do
// APARELHO, mas é comparado contra `created_at`, que vem do relógio do
// SERVIDOR (Postgres) — um aparelho com o relógio adiantado excluía pedidos
// legítimos do auto-print sem avisar ninguém. Ver ACTIVATION_SAFETY_MARGIN_MS
// abaixo pro fix e o porquê da escolha (margem fixa, não "maior created_at
// devolvido pelo servidor"). **Correção de reload (revisão independente,
// 2026-09-13)**: "hora do mount desta sessão" era literal demais — o app
// desktop se recarrega sozinho quando o renderer morre (Task 2), e nesse
// mount novo o corte pulava pra frente, deixando pra trás justamente os
// pedidos que entraram enquanto a tela estava morta. O corte passou a ser
// PERSISTIDO por loja (`loadOrCreateActivationCutoff`): reload retoma o
// corte antigo e alcança o backlog; só uma sessão de fato nova (outro
// aparelho, localStorage limpo, ou estação que ficou sem dar sinal de vida
// por mais de ACTIVATION_IDLE_MAX_MS) cria corte novo, que é o caso que o
// corte existe pra proteger. Corte salvo ADIANTADO em relação ao relógio de
// agora também é descartado — ver o Critical #1 comentado lá. Mesmo raciocínio se aplicou
// ao alarme de falha persistente (`falhaPersistenteKey`), que também se
// calava sozinho no reload com a impressão ainda quebrada.
//
// O QUE NÃO FOI PORTADO (decisão consciente, não esquecimento): o station
// original também reconciliava PEDIDOS FECHADOS (comprovante de conta paga,
// `reconcileCaixa` de lá) — necessário porque aquele mecanismo rodava num
// aparelho SEPARADO do caixa, que precisava descobrir "uma mesa fechou" por
// fora. Aqui isso deixou de fazer sentido: quem fecha a conta É o caixa,
// nesta mesma sessão, e o comprovante já imprime na hora do clique
// (`TablesView.handleFinishPayment`/`CounterView`, Task 4) — não há mais
// nenhum "fechamento sem aparelho por perto" pra reconciliar. Portar essa
// metade seria reintroduzir exatamente a duplicata que o `printTarget`
// antigo existia pra evitar, com muito mais código.
// `activatedAt`/corte de ativação (que o station usava só nesse
// `reconcileCaixa`, pra não reimprimir até 24h de comprovantes antigos ao
// ativar um aparelho novo) também não tem equivalente aqui pelo mesmo
// motivo: não existe reconciliação de fechamento pra proteger.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, XCircle, RotateCcw, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchKitchenOrders, subscribeToStoreOrderChanges, StoreOrdersConnectionStatus, fetchPrinterConfigs, enqueuePrintJob, fetchOfflinePrintedSigs } from '@/lib/api';
import { printKitchenTicket, buildKitchenTicketText } from '@/lib/print';
import { PrinterConfig } from '@/types';
import { playPrintFailureAlert, vibrateAlert } from '@/lib/audioAlert';
import { resolveOrderFlow } from '@/lib/storeModules';
import { parseItemNote } from '@/lib/labels';
import { Store, OrderItem, StoreUser } from '@/types';

type Destination = 'kitchen' | 'bar';

function isBrowser() {
  return typeof window !== 'undefined';
}

const STORAGE_PREFIX = 'ntb_caixa_print';
// Mesmo teto do station original — trava de segurança pra um browser que
// fica logado dias a fio não acumular um localStorage sem limite (os
// pedidos ativos em si já são limitados a 500 por fetch_kitchen_orders_secure,
// migration 021).
const MAX_PRINTED_IDS = 1000;
// Depois de N falhas seguidas do MESMO item, a reconciliação automática para
// de tentar sozinha (evita bater print() repetidamente sem gesto novo) e
// passa a exigir toque manual em "Reimprimir" no painel de detalhes —
// também garante que o item fica visível até alguém agir.
const MAX_AUTO_RETRIES = 3;
// Número de reconciliações CONSECUTIVAS cuja própria chamada ao servidor
// falhou antes de acender o indicador de falha persistente. Um erro
// passageiro de rede não precisa virar alarme, mas falhas seguidas do
// backstop de 10s já somam tempo suficiente pra não ser ruído.
const RECONCILE_FAILURE_ALERT_THRESHOLD = 2;
// Corte de ativação (Critical #2, revisão de branch 2026-08-23 — "activation
// cutoff trusts the device's clock, not the server's"): `activatedAtRef`
// nasce de `new Date()` (relógio do APARELHO do caixa), mas é comparado
// contra `it.created_at`, que vem do Postgres (relógio do SERVIDOR). Um
// tablet barato ou celular com hora errada adiantado alguns minutos em
// relação ao banco faz TODO pedido criado nesse intervalo, no exato momento
// em que a sessão nova monta, ser silenciosamente excluído do auto-print —
// sem alarme nenhum (o indicador só acende por falha de fetch/conexão/
// impressão, e "pulei um item por corte" parece idêntico a "fila vazia").
// Corrigido subtraindo uma margem de segurança fixa do instante do
// aparelho antes de usá-lo como corte, em vez de confiar cegamente no
// relógio local. Descarta a alternativa "usar o maior created_at devolvido
// pelo servidor na primeira reconciliação como corte": ela tem um problema
// de ovo-e-galinha real aqui — a primeira reconciliação desta sessão
// PRECISA de algum corte pra decidir o que imprimir automaticamente antes
// mesmo dela existir um `created_at` de referência (sessão nova sem pedido
// nenhum na fila, por exemplo), então sempre sobra ou (a) não imprimir nada
// no primeiro fetch até ter uma referência — reabre exatamente o "backlog
// spew" que o corte existe pra evitar — ou (b) usar `Date.now()` mesmo,
// mantendo o bug original. A margem fixa evita esse impasse e o efeito
// colateral (imprimir de novo um item que talvez outra sessão já tenha
// impresso nesses minutos) é o erro aceitável: um ticket duplicado é
// recuperável (jogar fora), um pedido nunca impresso não é.
const ACTIVATION_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// Ver ACTIVATION_SAFETY_MARGIN_MS acima pro porquê: `activatedAtRef` nunca
// deve ser o instante cru do aparelho (relógio local != relógio do
// servidor, que é quem gera `created_at`) — sempre alguns minutos ANTES
// dele, pra absorver adiantamento de relógio sem reabrir o "backlog spew"
// que o corte de ativação existe pra evitar.
function activationCutoffNow(): string {
  return new Date(Date.now() - ACTIVATION_SAFETY_MARGIN_MS).toISOString();
}

// O corte de ativação precisa sobreviver a um reload da MESMA sessão de
// trabalho. Achado de revisão independente (2026-09-13): ele nascia sempre
// de `Date.now() - 5min`, então quando o app se recarrega sozinho depois de
// uma falha (ver desktop/electron/main.js, render-process-gone), tudo que
// entrou na fila enquanto a tela estava morta ficava velho demais pro corte
// e NUNCA era impresso — o operador via a tela voltar ao normal e a cozinha
// simplesmente não recebia aqueles pedidos.
// Guardar o corte por loja resolve: uma sessão que já estava ativa retoma o
// corte antigo (e alcança o backlog), e só uma sessão de fato NOVA (outro
// aparelho, localStorage limpo, PDV que ficou desligado) cria corte novo.
//
// O QUE DECIDE "sessão nova" é a ÚLTIMA ATIVIDADE, não a idade do corte
// (correção da revisão do fix, 2026-09-13 — Important #2). A primeira versão
// descartava o corte salvo depois de 12h, medindo a coisa errada: o corte é
// gravado UMA vez e nunca atualizado enquanto a estação roda, então a idade
// dele diz "quando esta sessão começou", não "há quanto tempo esta estação
// está parada". Turno de 10:00 às 02:00 (comum) com um reload na hora 13
// caía justamente nisso — chave com mais de 12h, corte novo em `agora -
// 5min`, backlog da janela morta perdido: exatamente o bug que esta
// correção existe pra fechar, de volta. `ultimaAtividadeKey` (regravada a
// cada reconciliação BEM-SUCEDIDA, ver `saveUltimaAtividade`) separa os dois
// casos de verdade: estação viva há poucos minutos = mesma sessão de
// trabalho, retoma o corte por mais longo que ele seja; estação sem dar
// sinal há mais de ACTIVATION_IDLE_MAX_MS = aparelho que ficou desligado
// (horas ou dias), aí sim corte novo, que é o cenário de "backlog spew" que
// o corte existe pra proteger.
const ACTIVATION_IDLE_MAX_MS = 30 * 60 * 1000;

// Janela MÁXIMA de ociosidade que ainda pode ser chamada de "lacuna"
// (Critical #1 da revisão final, 2026-09-13 — "o aviso de lacuna dispara toda
// manhã, sem lacuna nenhuma").
//
// O bug: descartar o corte e AVISAR eram a mesma coisa. A partir do segundo
// dia de uso sempre existe corte salvo, então toda abertura normal da loja
// (fechou 23h, abre 10h — o horário real do Sertão, a única loja
// `direct_print`), todo intervalo entre almoço e jantar, todo restart de PC e
// todo app fechado por 31 minutos caía no mesmo caminho e mostrava "pode ter
// ficado pedido sem imprimir". Um alarme que aparece todo dia sem nada de
// errado é pior que nenhum: o time aprende a fechar no reflexo, e no dia da
// lacuna DE VERDADE ele é dispensado no mesmo movimento.
//
// Descartar o corte continua igual (é proteção contra "backlog spew", e ela
// tem que valer sempre). O que mudou é QUANDO isso vira aviso: só quando a
// estação ficou fora numa janela em que pedidos plausivelmente entraram —
// ou seja, ela estava operando e parou no meio, não "o PDV estava desligado".
//
// Critério escolhido: a ociosidade medida (`ultima_atividade` → agora) precisa
// ficar ENTRE ACTIVATION_IDLE_MAX_MS (30 min, abaixo disso o corte nem é
// descartado) e este teto. 2 horas, calibrado com horário real de loja:
//   - 23h→10h (Sertão, fechada) = 11h de ociosidade → SILÊNCIO, é abertura
//     fria, ninguém pediu nada nesse intervalo;
//   - intervalo almoço→jantar (fecha 15h, abre 18h/19h) = 3h a 4h → também
//     silêncio, mesma natureza;
//   - 40 min no meio do expediente (renderer morreu e recarregou, servidor
//     instável) = AVISA, que é o caso real que este mecanismo existe pra
//     cobrir.
// O teto tem que ficar abaixo do menor intervalo de loja fechada que existe
// na prática (o de almoço→jantar, ~3h) e acima da maior janela cega plausível
// durante o serviço. 2h atende os dois: uma estação parada 2h com a loja
// aberta já seria notada por gente (a cozinha para de receber ticket muito
// antes disso) — o aviso ali é redundante, não crítico.
const LACUNA_JANELA_MAX_MS = 2 * 60 * 60 * 1000;

function activationCutoffKey(storeId: string) {
  return `${STORAGE_PREFIX}_corte_ativacao_${storeId}`;
}

function ultimaAtividadeKey(storeId: string) {
  return `${STORAGE_PREFIX}_ultima_atividade_${storeId}`;
}

// Carimbo de "esta estação estava viva agora" — só uma reconciliação que de
// fato falou com o servidor conta (falha de fetch não é sinal de vida útil
// aqui: se o PDV passou a madrugada inteira tentando e falhando, ele não
// estava operando).
function saveUltimaAtividade(storeId: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ultimaAtividadeKey(storeId), new Date().toISOString());
  } catch {
    /* best-effort: sem o carimbo, o pior que acontece é o próximo mount criar corte novo */
  }
}

// Quanto tempo faz que esta estação deu o último sinal de vida, em ms.
// `null` = não dá pra afirmar nada (nunca houve carimbo, ou ele está
// corrompido/no futuro). Separado de `estacaoEstavaVivaHaPouco` porque o
// Critical #1 (ver LACUNA_JANELA_MAX_MS) precisa do VALOR da ociosidade, não
// só do booleano "menos de 30 min": 40 minutos e 11 horas caem os dois no
// mesmo `false`, e são coisas completamente diferentes pro operador.
function msDesdeUltimaAtividade(storeId: string): number | null {
  try {
    const ultima = window.localStorage.getItem(ultimaAtividadeKey(storeId));
    if (!ultima) return null;
    const delta = Date.now() - new Date(ultima).getTime();
    if (delta < 0 || Number.isNaN(delta)) {
      // Carimbo no FUTURO (ou corrompido) não prova nada, mas também não pode
      // ficar envenenando o aparelho pra sempre (Minor da 2ª revisão,
      // 2026-09-13): um PC com o relógio adiantado grava carimbos
      // adiantados a sessão inteira; quando o NTP corrige a hora no meio do
      // turno, TODA leitura seguinte parece estar no futuro,
      // `estacaoEstavaVivaHaPouco` fica falso pra sempre naquela máquina e
      // todo reload volta a descartar o corte — o bug original da Task 3 de
      // volta, só que restrito a esse aparelho. Mesma resposta do Critical
      // #1: valor inválido é reescrito com o instante atual (auto-cura).
      // Continua devolvendo `false` nesta passada (não dá pra afirmar que a
      // estação estava viva), mas a partir do próximo mount o carimbo volta
      // a ser confiável mesmo que nenhuma reconciliação chegue a dar certo.
      saveUltimaAtividade(storeId);
      return null;
    }
    return delta;
  } catch {
    return null;
  }
}

function estacaoEstavaVivaHaPouco(ociosaHaMs: number | null): boolean {
  return ociosaHaMs !== null && ociosaHaMs < ACTIVATION_IDLE_MAX_MS;
}

// Devolve o corte a usar e, quando aplicável, o corte que foi DESCARTADO —
// ver `lacunaCorteKey` abaixo pro porquê de isso precisar chegar até a tela.
// `descartado: null` cobre os dois casos silenciosos e corretos: retomamos o
// corte salvo, ou não havia corte salvo nenhum (aparelho novo/localStorage
// limpo — não existe buraco pra avisar, nunca houve sessão anterior aqui).
//
// `aberturaFria` (Critical #1 da revisão final, ver LACUNA_JANELA_MAX_MS):
// descartamos o corte porque a estação passou MUITO tempo parada — loja
// fechada, PDV desligado. Não é lacuna, é o começo de um dia de trabalho.
function loadOrCreateActivationCutoff(storeId: string): { corte: string; descartado: string | null; aberturaFria: boolean } {
  if (!isBrowser()) return { corte: activationCutoffNow(), descartado: null, aberturaFria: false };
  try {
    const salvo = window.localStorage.getItem(activationCutoffKey(storeId));
    const agora = activationCutoffNow();
    // Medido ANTES de qualquer `saveUltimaAtividade` desta função — ela
    // recarimba o "agora" e apagaria justamente a informação que decide se
    // houve lacuna.
    const ociosaHaMs = msDesdeUltimaAtividade(storeId);
    // Corte só pode ser retomado PRA TRÁS, nunca pra frente (Critical #1 da
    // revisão do fix, 2026-09-13). Um PC de loja com a bateria do RTC morta
    // sobe com a data adiantada, grava um corte no FUTURO, e o NTP corrige o
    // relógio em seguida — como o filtro é `created_at >= corte`, a partir
    // daí NENHUM pedido é auto-impresso até o relógio real alcançar aquele
    // carimbo (dias, se o adiantamento foi de dias), e em silêncio. Antes de
    // persistir, isso se curava sozinho no mount seguinte (o corte era
    // recalculado do relógio atual); persistido, gruda. É a mesma classe do
    // Critical #2 já documentado no cabeçalho ("o corte confia no relógio do
    // aparelho, não no do servidor"), então recebe a mesma resposta: corte
    // adiantado em relação a `agora` é descartado.
    const salvoUtil = salvo && new Date(salvo).getTime() <= new Date(agora).getTime();
    if (salvoUtil && estacaoEstavaVivaHaPouco(ociosaHaMs)) return { corte: salvo as string, descartado: null, aberturaFria: false };
    window.localStorage.setItem(activationCutoffKey(storeId), agora);
    // Nascer é sinal de vida (achado ao vivo ao testar o aviso de lacuna,
    // 2026-09-13): sem carimbar aqui, o carimbo só existiria depois da
    // primeira reconciliação BEM-SUCEDIDA — e qualquer segundo mount antes
    // dela (React StrictMode em dev, um F5 logo depois de abrir, ou o
    // próprio reload automático acontecendo antes do primeiro fetch voltar)
    // via "corte salvo + estação sem sinal de vida" e descartava o corte que
    // ele mesmo tinha acabado de criar, disparando um aviso de lacuna falso.
    // Trade-off consciente do outro lado: um PDV que reabre de tempos em
    // tempos com o servidor fora do ar mantém o corte antigo mais tempo, e
    // pode reimprimir mais quando o servidor voltar — que é o lado certo de
    // errar, pela regra já documentada no cabeçalho deste arquivo (ticket
    // duplicado se joga fora; pedido nunca impresso, não).
    saveUltimaAtividade(storeId);
    // AQUI mora o Critical #1 (ver LACUNA_JANELA_MAX_MS pro raciocínio e pelos
    // horários reais usados pra calibrar): descartar o corte é uma coisa,
    // AVISAR que pode ter ficado pedido sem imprimir é outra. Três casos:
    //  - `!salvo`: aparelho novo/localStorage limpo, nunca houve sessão
    //    anterior aqui — não existe buraco pra avisar (comportamento antigo,
    //    inalterado).
    //  - ociosidade desconhecida (`null`: sem carimbo, carimbo corrompido ou
    //    no futuro) ou acima do teto: não dá pra afirmar que a estação ficou
    //    CEGA — o mais provável, de longe, é que o PDV estava desligado com a
    //    loja fechada. Silêncio, e ainda por cima uma lacuna antiga guardada
    //    é apagada: ela falava de "Pedidos do Dia" de um dia que já acabou,
    //    ninguém reimprime hoje um ticket de ontem.
    //  - ociosidade entre 30 min e o teto: a estação estava operando e parou
    //    no meio do expediente. Isso sim é lacuna, e é o único caso que avisa.
    const aberturaFria = !!salvo && (ociosaHaMs === null || ociosaHaMs > LACUNA_JANELA_MAX_MS);
    const houveLacuna = !!salvo && !aberturaFria;
    return { corte: agora, descartado: houveLacuna ? salvo : null, aberturaFria };
  } catch {
    return { corte: activationCutoffNow(), descartado: null, aberturaFria: false };
  }
}

// Aviso de LACUNA: "o corte antigo foi descartado, pode ter ficado pedido pra
// trás" (Important da 2ª revisão, 2026-09-13). A janela de 30 min está certa
// como desenho, mas ela tem um limite honesto: se o fetch falhar sem parar
// por mais de ACTIVATION_IDLE_MAX_MS (servidor instável, não
// necessariamente PDV desligado) E o renderer recarregar logo em seguida —
// que é EXATAMENTE o gatilho que este mecanismo existe pra tratar, o reload
// automático do Electron —, o corte é descartado e recriado em `agora -
// 5min`, e o que entrou durante a instabilidade deixa de ser candidato ao
// auto-print. O que não dá pra aceitar é isso acontecer em SILÊNCIO: o
// operador não tem como saber que existe buraco. Este aviso é o contrário do
// alarme de falha de reconciliação e não pode se confundir com ele — aquele
// diz "está quebrado AGORA", este diz "pode ter ficado buraco PRA TRÁS, e o
// conserto é manual: Pedidos do Dia → Reimprimir". Persistido no mesmo
// padrão das outras chaves justamente porque ele nasce durante um reload:
// estado em memória morreria junto com o mount que o criou. Só o operador o
// apaga (`dismissBacklogGap`) — nenhuma reconciliação bem-sucedida o
// resolve, porque um item pulado pelo corte nunca volta a ser candidato
// automático por definição.
// LIMITE DE QUANDO ISTO APARECE (Critical #1 da revisão final, 2026-09-13):
// nem todo descarte de corte vira este aviso — só o que aconteceu dentro de
// LACUNA_JANELA_MAX_MS. Ver o comentário daquela constante: abertura de loja
// fechada não é "o PDV ficou cego", é "o PDV estava desligado", e avisar isso
// todo dia matava a credibilidade do aviso justamente nos dias em que ele
// importa.
function lacunaCorteKey(storeId: string) {
  return `${STORAGE_PREFIX}_lacuna_corte_${storeId}`;
}

function loadLacunaCorte(storeId: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(lacunaCorteKey(storeId));
  } catch {
    return null;
  }
}

function saveLacunaCorte(storeId: string, desde: string | null) {
  if (!isBrowser()) return;
  try {
    if (desde) window.localStorage.setItem(lacunaCorteKey(storeId), desde);
    else window.localStorage.removeItem(lacunaCorteKey(storeId));
  } catch {
    /* best-effort, igual às outras chaves */
  }
}

// Alarme de "impressão quebrada" persistido por loja (mesmo achado de
// revisão independente, 2026-09-13, segunda metade): `failedRef` e
// `persistentReconcileFailure` viviam só em memória, então o reload
// automático do desktop APAGAVA o alarme — a impressão continuava quebrada
// e o aviso sumia da tela sozinho, que é o pior resultado possível pra um
// mecanismo cuja garantia central é "uma cozinha nunca pode parar de
// receber pedido em silêncio" (ver cabeçalho do arquivo).
function falhaPersistenteKey(storeId: string) {
  return `${STORAGE_PREFIX}_falha_impressao_${storeId}`;
}

function loadFalhaPersistente(storeId: string): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(falhaPersistenteKey(storeId)) === '1';
  } catch {
    return false;
  }
}

function saveFalhaPersistente(storeId: string, alarmada: boolean) {
  if (!isBrowser()) return;
  try {
    if (alarmada) window.localStorage.setItem(falhaPersistenteKey(storeId), '1');
    else window.localStorage.removeItem(falhaPersistenteKey(storeId));
  } catch {
    /* localStorage cheio/bloqueado: o alarme em memória continua valendo nesta sessão */
  }
}

function printedIdsKey(storeId: string, destination: Destination) {
  return `${STORAGE_PREFIX}_impressos_${storeId}_${destination}`;
}

function loadPrintedIds(storeId: string, destination: Destination): Set<string> {
  if (!isBrowser()) return new Set();
  try {
    const raw = window.localStorage.getItem(printedIdsKey(storeId, destination));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// Interação com o corte persistido (Important #3 da revisão do fix,
// 2026-09-13): o corte e o dedupe são as DUAS metades da mesma proteção —
// o corte diz "não olhe pra trás daqui", o dedupe diz "este eu já imprimi".
// Enquanto as duas chaves somem juntas (localStorage limpo, aparelho novo) o
// comportamento é o seguro de sempre: corte novo, nada de backlog. O risco é
// o dedupe sumir SOZINHO, com o corte sobrevivendo — aí todo item ainda não
// entregue depois do corte volta a ser candidato a reimpressão. Esta função
// era a fonte mais provável disso: sem try/catch, um QuotaExceededError
// lançava daqui, `reconcile` engolia como falha genérica, e o id ficava só
// em memória — no reload seguinte o dedupe não tinha aquele item, mas o
// corte continuava lá. Com o catch, uma falha de escrita para de ser
// silenciosa (vai pro console) e não interrompe mais o lote; o trim por
// MAX_PRINTED_IDS continua sendo a outra fonte possível, mitigada pelo fato
// de o corte agora só ser retomado por estação viva há minutos (ver
// ACTIVATION_IDLE_MAX_MS), não por até 12h.
function savePrintedIds(storeId: string, destination: Destination, ids: Set<string>) {
  if (!isBrowser()) return;
  const arr = Array.from(ids);
  const trimmed = arr.length > MAX_PRINTED_IDS ? arr.slice(arr.length - MAX_PRINTED_IDS) : arr;
  try {
    window.localStorage.setItem(printedIdsKey(storeId, destination), JSON.stringify(trimmed));
  } catch (e) {
    console.error('savePrintedIds falhou (dedupe segue só em memória nesta sessão):', e);
  }
}

// Leitura read-only do dedupe persistido, pro histórico do dia (TablesView,
// "Pedidos do Dia") poder mostrar "impresso"/"pendente" num item de origem
// cliente sem duplicar a lógica de chave/localStorage acima. Best-effort de
// propósito: só reflete o que ESTE navegador já viu confirmadamente
// impresso — um item impresso por outra sessão/aparelho não aparece aqui
// (não existe estado de impressão persistido no servidor, ver cabeçalho do
// arquivo), então a UI que consome isto trata "não encontrado" como "sem
// registro nesta sessão", nunca como "não imprimiu".
export function wasKitchenTicketPrinted(storeId: string, destination: 'kitchen' | 'bar', itemId: string): boolean {
  return loadPrintedIds(storeId, destination).has(itemId);
}

// Reimpressão manual de um item específico, usada por "Pedidos do Dia"
// (TablesView, StoreModule.tsx) pra dar um jeito de recuperar, com um toque
// humano, qualquer item que a reconciliação automática não imprimiu sozinha
// — o caso mais comum sendo item criado ANTES do corte de ativação desta
// sessão (`activatedAt`, ver cabeçalho do arquivo), mas serve pra qualquer
// item marcado "sem registro" na lista, seja qual for o motivo. Faz as duas
// coisas que a reconciliação automática faz por item: imprime E, se der
// certo, marca no MESMO dedupe local (`printedIds`) que a reconciliação usa
// — assim um reimpresso manualmente não volta a ser candidato automático na
// próxima passada.
export async function printPendingKitchenTicket(params: {
  storeId: string;
  storeName: string;
  destination: 'kitchen' | 'bar';
  itemId: string;
  orderId: string;
  tableNumber: number | string;
  quantity: number;
  productName: string;
  addons?: string;
  observation?: string;
  client?: string | null;
  paperWidthMm?: 48 | 58 | 80;
}): Promise<boolean> {
  const ok = await printKitchenTicket({
    kind: params.destination === 'bar' ? 'BAR' : 'COZINHA',
    storeName: params.storeName,
    orderType: 'MESA',
    identifier: `MESA ${params.tableNumber}`,
    client: params.client,
    quantity: params.quantity,
    productName: params.productName,
    addons: params.addons,
    observation: params.observation,
    orderIdShort: params.orderId.slice(0, 8),
    paperWidthMm: params.paperWidthMm,
  });
  if (ok) {
    const ids = loadPrintedIds(params.storeId, params.destination);
    ids.add(params.itemId);
    savePrintedIds(params.storeId, params.destination, ids);
  }
  return ok;
}

function ticketDescription(item: OrderItem): string {
  const orderType = item.order?.order_type;
  const tableNumber = item.order?.tables?.number;
  const local = orderType === 'counter' ? 'Balcão' : `Mesa ${tableNumber ?? '?'}`;
  return `${item.quantity}x ${item.product?.name || 'Produto indisponível'} — ${local}`;
}

interface FailedEntry {
  key: string;
  description: string;
  attempts: number;
  retry: () => Promise<boolean>;
}

// Revisão crítica 2026-08-23 (Important #I1 — "restrict the auto-print loop
// itself to caixa === true"): ANTES, dono/universal sempre contavam aqui
// (mesmo bypass usado em canFinalizeBill, lib/storeModules.ts) — quem
// decidia se o mecanismo rodava era só `resolveOrderFlow(store) ===
// 'direct_print'`. Problema real: dono/universal abrindo o painel do Caixa
// só pra checar algo, num aparelho qualquer (sem impressora de cozinha
// nenhuma configurada nele), disparava `window.print()` sozinho, sem gesto
// nenhum pedindo isso. Corrigido: só quem tem a permissão `caixa` marcada de
// verdade dispara o LOOP de auto-impressão — dono/universal continuam vendo
// o app normalmente (inclusive "Pedidos do Dia", que não depende desta
// função) e podem imprimir manualmente lá se precisar, mas não rodam a
// reconciliação em segundo plano sozinhos só por terem aberto a tela.
//
// Achado ao vivo (mesma revisão, verificação com chrome-devtools): checar só
// `permissions?.caixa === true` NÃO bastava. `universalPermissionsFor`
// (StoreModule.tsx) monta o objeto `permissions` sintético de uma conta
// universal com `caixa: modules.caixa` — ou seja, espelha se a LOJA tem o
// módulo Caixa ligado, não se ESTE usuário é operador de caixa. Numa loja
// com `modules.caixa: true` (ex.: a Sertão), isso fazia TODA conta
// universal logar já com `permissions.caixa === true`, reabrindo
// exatamente o buraco que este fix existe pra fechar. `role` explícito
// (nunca 'owner'/'universal') é o que realmente distingue "operador de
// caixa de carne e osso, com a permissão marcada pelo Master Admin" de
// "qualquer conta universal, nesta loja específica".
// Exportada (Critical #2, revisão de branch 2026-08-23 — "Reimprimir pode
// mentir sucesso num aparelho sem impressora"): `StoreModule.tsx` (histórico
// "Pedidos do Dia") precisa do MESMO critério pra decidir se oferece o botão
// manual "Reimprimir" — não um critério parecido, o mesmo, senão as duas
// checagens divergem silenciosamente no futuro (ex.: alguém ajusta um dos
// dois lados e esquece do outro). Não reusar a instância do HOOK
// `useCaixaPrintStation` pra isso — chamá-lo de novo em `TablesView`
// duplicaria a reconciliação em segundo plano inteira (Realtime, intervalo
// de 10s, dedupe em memória), rodando duas cópias independentes do mesmo
// mecanismo na mesma sessão. `isCaixaRole` sozinha é pura/sem estado, então
// dá pra reusar só o critério sem reusar o efeito.
// Achado ao vivo (2026-08-28, corrigido em 2 passos): a exigência de
// `permissions.caixa === true` vetava dono E universal de disparar a
// reconciliação -- na loja Sertão, o teste ao vivo foi feito logado como
// "Equipe Norte Para Negócios" (conta universal), e o requisito confirmado
// pelo dono na hora foi explícito e repetido: "qualquer login, qualquer
// pedido, imprime -- não importa quem tá logado". Primeiro passo (liberar só
// `owner`) não bastou porque o teste real usa universal. Segundo passo:
// TODO login com sessão de loja válida conta agora, sem exceção nenhuma.
// A preocupação original da revisão de 2026-08-23 (dono/universal abrindo o
// painel num aparelho qualquer, sem impressora nenhuma, disparando
// `window.print()` à toa) continua real só pra impressora "Sistema padrão"
// (browser_default) -- mas o roteamento de verdade desta loja usa
// impressoras USB/rede cadastradas (`enqueuePrintJob`, ver
// `matchingNetworkPrinters` abaixo), que é seguro disparar de qualquer
// login: só grava uma linha na fila, quem imprime de fato é o agente ligado
// na impressora certa, nunca o aparelho de quem clicou. Trade-off aceito
// por pedido explícito do dono, não esquecimento.
export function isCaixaRole(_user: Pick<StoreUser, 'role' | 'permissions'>): boolean {
  return true;
}

// Impressoras de rede/USB (aba "Impressão", migration 061, 2026-08-27)
// cadastradas pra esta loja e este destino — best-effort, ADITIVO ao
// window.print() de sempre, nunca no lugar dele: um erro aqui (rede
// fora, tabela vazia) não pode derrubar o mecanismo já testado que as 6
// lojas reais dependem hoje. `!printerConfigId` filtra 'browser_default'
// (metadado, sem fila) e inativas.
function matchingNetworkPrinters(printers: PrinterConfig[], destination: Destination): PrinterConfig[] {
  return printers.filter((p) => p.is_active && (p.connection_type === 'network' || p.connection_type === 'usb') && (p.destination === destination || p.destination === 'all'));
}

async function reconcileDestination(
  storeId: string,
  destination: Destination,
  storeName: string,
  activatedAt: string,
  printedIdsRef: React.MutableRefObject<Record<Destination, Set<string>>>,
  failedRef: React.MutableRefObject<Map<string, FailedEntry>>,
  setFailedItems: (m: Map<string, FailedEntry>) => void,
  networkPrinters: PrinterConfig[],
): Promise<boolean> {
  let fetchFailed = false;
  const items = await fetchKitchenOrders(storeId, destination, () => { fetchFailed = true; });
  const printedIds = printedIdsRef.current[destination];
  // Achado da revisão de branch 2026-08-23 (disclosed, não Critical, mas
  // acknowledged de propósito — "same-browser double-tab printing"):
  // `printedIdsRef` era carregado do localStorage só UMA vez, no mount
  // (efeito de `store?.id` acima). Duas abas do MESMO navegador no MESMO
  // aparelho de caixa (uma aba duplicada por acidente) cada uma mantinha o
  // próprio Set em memória, nunca via o que a outra aba já tinha marcado —
  // e cada uma reconciliava/imprimia o MESMO pedido a cada passada, pro
  // resto do turno inteiro (não uma corrida rara de um item só: durável,
  // todo item, enquanto as duas abas ficarem abertas). Corrigido relendo o
  // localStorage aqui, a cada reconciliação (a cada 10s de backstop e a
  // cada evento Realtime — já rodava com essa frequência de qualquer
  // forma), e mesclando no Set em memória ANTES de decidir o que imprimir:
  // um id que a aba irmã já persistiu aparece aqui na próxima passada, sem
  // esperar reload/F5.
  loadPrintedIds(storeId, destination).forEach((id) => printedIds.add(id));
  const activatedAtMs = new Date(activatedAt).getTime();
  // Corte de ativação (Critical #1, ver cabeçalho do arquivo): item criado
  // ANTES do mount desta sessão não é auto-impresso aqui — pode já ter sido
  // tratado por outra sessão, e reimprimir às cegas é exatamente o "backlog
  // spew" do achado. Continua elegível pra reimpressão MANUAL via "Pedidos
  // do Dia" (`printPendingKitchenTicket`) — nunca fica invisível, só para de
  // ser reimpresso sem gesto humano nenhum. Item de garçom entra no MESMO
  // caminho que QR/Balcão agora (ver cabeçalho do arquivo, revisão crítica
  // "waiter-launched orders print nowhere real") — não há mais filtro por
  // `added_by_role`.
  // Itens do garçom impressos SEM internet (direto na impressora de rede): não
  // imprime de novo quando o pedido sincroniza. Cada assinatura só é "consumida"
  // tantas vezes quantas foi impressa offline.
  const offlineSigs = await fetchOfflinePrintedSigs(storeId).catch(() => null);
  // Sem conseguir consultar as marcas, não imprime nesta rodada (tenta na próxima):
  // imprimir às cegas poderia repetir uma comanda já impressa sem internet.
  if (offlineSigs === null) return true;
  const chaveConsumidas = `ntb-offline-marcas-consumidas:${storeId}`;
  const consumidas = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(chaveConsumidas) || '[]'); } catch { return []; } })());
  const jaImpressoOffline = (it: any): boolean => {
    const sig = `${it.order?.tables?.number ?? ''}|${it.product_id}|${it.quantity}|${it.notes || ''}`;
    const marca = (offlineSigs.get(sig) || []).find((m) => !consumidas.has(m));
    if (!marca) return false;
    consumidas.add(marca);
    const vivas = new Set<string>(); offlineSigs.forEach((l) => l.forEach((m) => vivas.add(m)));
    try { localStorage.setItem(chaveConsumidas, JSON.stringify([...consumidas].filter((m) => vivas.has(m)))); } catch { /* sem persistência */ }
    printedIds.add(it.id);
    savePrintedIds(storeId, destination, printedIds);
    return true;
  };
  const toPrint = items.filter((it) => !printedIds.has(it.id) && new Date(it.created_at).getTime() >= activatedAtMs && !jaImpressoOffline(it));

  for (const item of toPrint) {
    const key = `${destination}:${item.id}`;
    const fail = failedRef.current.get(key);
    if (fail && fail.attempts >= MAX_AUTO_RETRIES) continue; // aguardando reimpressão manual
    const kind = destination === 'bar' ? 'BAR' : 'COZINHA';
    const orderType = item.order?.order_type;
    const tableNumber = item.order?.tables?.number;
    const description = ticketDescription(item);

    // Aditivo (ver matchingNetworkPrinters acima): enfileira o MESMO
    // ticket, em texto puro, pra cada impressora de rede/USB cadastrada
    // pra este destino — o agente local (print-agent/) é quem realmente
    // manda pro papel. Fire-and-forget de propósito: uma falha aqui
    // (rede fora, tabela sem linha) não pode interromper nem marcar
    // falha no caminho window.print() já testado, que segue seu próprio
    // rastreamento de erro logo abaixo.
    const printersForItem = matchingNetworkPrinters(networkPrinters, destination);
    if (printersForItem.length > 0) {
      const { client: netClient, observation: netObservation } = parseItemNote(item.notes || '');
      const content = buildKitchenTicketText({
        kind,
        storeName,
        orderType: orderType === 'counter' ? 'BALCÃO' : 'MESA',
        identifier: orderType === 'counter' ? 'BALCÃO' : `MESA ${tableNumber ?? '?'}`,
        client: netClient,
        quantity: item.quantity,
        productName: item.product?.name || 'Produto indisponível',
        addons: (item.selected_options || []).map((o) => o.name).join(', ') || undefined,
        observation: netObservation || undefined,
        orderIdShort: item.order_id.slice(0, 8),
      });
      printersForItem.forEach((printer) => {
        // `dedupeKey` (migration 073): o dedupe desta tela é `printedIds` no
        // localStorage, ou seja, POR APARELHO — dois computadores da mesma
        // loja com o app aberto nunca enxergam o que o outro já imprimiu e
        // cada um cria seu próprio print_job pro MESMO item, fazendo a
        // comanda sair duas vezes na cozinha. A reserva atômica do motor de
        // impressão não cobre isso (são jobs distintos, cada um reservado
        // legitimamente por uma máquina): quem decide é o índice único no
        // banco, e o segundo insert vira `duplicado: true` em silêncio.
        enqueuePrintJob({ storeId, printerConfigId: printer.id, destination, title: description, content, dedupeKey: `item:${item.id}:${destination}:${printer.id}` })
          .catch((e) => console.error('enqueuePrintJob (auto) falhou:', e));
      });
    }

    const doPrint = async () => {
      // try/catch: printKitchenTicket é Promise<boolean>, não um contrato
      // blindado contra throw — sem isto, uma rejeição não tratada
      // interromperia o `for` no meio do lote (achado real do station
      // original, fix round 2 Group B2).
      try {
        const { client, observation } = parseItemNote(item.notes || '');
        return await printKitchenTicket({
          kind,
          storeName,
          orderType: orderType === 'counter' ? 'BALCÃO' : 'MESA',
          identifier: orderType === 'counter' ? 'BALCÃO' : `MESA ${tableNumber ?? '?'}`,
          client,
          quantity: item.quantity,
          productName: item.product?.name || 'Produto indisponível',
          addons: (item.selected_options || []).map((o) => o.name).join(', ') || undefined,
          observation: observation || undefined,
          orderIdShort: item.order_id.slice(0, 8),
        });
      } catch (e) {
        console.error('printKitchenTicket lançou (tratado como falha):', e);
        return false;
      }
    };
    // Achado ao vivo (2026-08-28): quando já existe impressora USB/rede
    // cadastrada pra este destino, o `window.print()` abaixo (pensado pra
    // loja SEM impressora de rede nenhuma) não tem mais nenhuma impressora
    // real esperando por ele -- ele falhava (ou imprimia em qualquer coisa
    // marcada como padrão do Windows/Mac daquele aparelho, sem relação com
    // cozinha/bar de verdade), e essa falha deixava o botão "Reimprimir"
    // manual aparecendo pra um pedido que JÁ saiu certinho pela fila.
    // `printersForItem.length > 0` é o mesmo sinal já usado acima pra
    // decidir se enfileira -- reusado aqui pra decidir se `window.print()`
    // sequer deveria rodar: a fila sendo real substitui o caminho antigo
    // pra este destino, não some ADITIVA a ele.
    // eslint-disable-next-line no-await-in-loop -- impressão sequencial de propósito: dois print() quase simultâneos empilhariam diálogos nativos no mesmo instante.
    const ok = printersForItem.length > 0 ? true : await doPrint();

    if (ok) {
      printedIds.add(item.id);
      savePrintedIds(storeId, destination, printedIds);
      if (failedRef.current.has(key)) {
        failedRef.current.delete(key);
        setFailedItems(new Map(failedRef.current));
      }
    } else {
      const attempts = (fail?.attempts || 0) + 1;
      failedRef.current.set(key, { key, description, attempts, retry: doPrint });
      setFailedItems(new Map(failedRef.current));
    }
  }
  return fetchFailed;
}

export interface CaixaPrintStationState {
  active: boolean;
  connectionStatus: StoreOrdersConnectionStatus;
  online: boolean;
  lastReconcileAt: string | null;
  lastReconcileFailed: boolean;
  persistentReconcileFailure: boolean;
  // Ver lacunaCorteKey: instante do corte que foi descartado (ou seja, "a
  // impressão automática pode ter ficado cega a partir daqui"), ou null.
  // NÃO é sinônimo de falha — é um aviso de buraco passado, que só o
  // operador dispensa.
  backlogGapSince: string | null;
  dismissBacklogGap: () => void;
  failedItems: FailedEntry[];
  retryItem: (key: string) => Promise<void>;
}

// Hook que efetivamente roda a reconciliação. Montado UMA vez em
// StoreLayout (sobrevive à troca de aba Mesas↔Balcão, que é exatamente o
// requisito: "regardless of which tab"). `active` decide se os efeitos
// sequer ligam — o principal (Realtime/intervalo) e o de estado por loja
// logo abaixo, que desde 2026-09-13 não só lê como GRAVA o corte de ativação
// (ver o comentário dele). Nas 6 lojas reais sem `order_flow:
// 'direct_print'` isto nunca roda, sem footprint nenhum: nem intervalo, nem
// assinatura Realtime, nem leitura OU escrita de localStorage.
export function useCaixaPrintStation(store: Store | null, loggedUser: StoreUser | null): CaixaPrintStationState {
  const active = !!store && !!loggedUser && resolveOrderFlow(store) === 'direct_print' && isCaixaRole(loggedUser);

  const [connectionStatus, setConnectionStatus] = useState<StoreOrdersConnectionStatus>('connecting');
  const [online, setOnline] = useState(true);
  const [lastReconcileAt, setLastReconcileAt] = useState<string | null>(null);
  const [lastReconcileFailed, setLastReconcileFailed] = useState(false);
  const [persistentReconcileFailure, setPersistentReconcileFailure] = useState(false);
  const [backlogGapSince, setBacklogGapSince] = useState<string | null>(null);
  const [failedItemsState, setFailedItemsState] = useState<Map<string, FailedEntry>>(new Map());

  const printedIdsRef = useRef<Record<Destination, Set<string>>>({ kitchen: new Set(), bar: new Set() });
  const failedRef = useRef<Map<string, FailedEntry>>(new Map());
  const reconcileLockRef = useRef(false);
  const reconcileFailStreakRef = useRef(0);
  const storeRef = useRef<Store | null>(null);
  // Corte de ativação desta sessão (Critical #1, corrigido pro Critical #2 —
  // ver ACTIVATION_SAFETY_MARGIN_MS acima) — hora do mount MENOS a margem de
  // segurança, resolvida de verdade (e possivelmente RETOMADA do
  // localStorage, ver loadOrCreateActivationCutoff) junto com o dedupe
  // sempre que a loja muda, no efeito abaixo — a loja, que é a chave do
  // corte persistido, só é conhecida lá. Um `Date.now()` de fallback nunca deveria ser lido de
  // verdade (o efeito abaixo roda antes do primeiro `reconcile()` sempre que
  // `store` já existe no mount), mas existe pra nunca deixar a comparação de
  // corte comparar contra `null`/`NaN` num cenário inesperado.
  const activatedAtRef = useRef<string>(activationCutoffNow());

  // Recarrega o dedupe (localStorage) sempre que a loja muda — cobre tanto
  // "loja resolveu depois do login" quanto "conta universal trocou de loja".
  // Também resolve `activatedAtRef`: o corte é POR LOJA e persistido
  // (2026-09-13, ver loadOrCreateActivationCutoff), então voltar pra uma
  // loja onde esta estação já estava ativa há pouco RETOMA o corte dela em
  // vez de criar um novo — é isso que faz o backlog acumulado durante um
  // reload continuar sendo impresso. Corte novo só nasce quando não há
  // nenhum salvo pra esta loja, quando a estação não deu sinal de vida há
  // mais de ACTIVATION_IDLE_MAX_MS, ou quando o salvo está adiantado em
  // relação ao relógio de agora (ver loadOrCreateActivationCutoff).
  //
  // GATEADO POR `active` (Important #1 da revisão do fix, 2026-09-13): antes
  // deste fix o efeito só LIA o localStorage, então rodar pra qualquer loja/
  // usuário era inofensivo. Agora ele CRIA E GRAVA o corte, e isso mudava
  // duas coisas que ninguém pediu: (1) as 6 lojas reais sem `direct_print`
  // passariam a ganhar a chave no navegador de todo mundo, quebrando a
  // promessa de "footprint zero" declarada logo acima; (2) numa loja
  // `direct_print`, qualquer login abrindo o painel às 09:00 gravaria o
  // corte daquele momento, e o caixa que entra às 11:00 HERDARIA o corte das
  // 09:00 em vez de nascer com `agora - 5min` — o corte deixaria de
  // significar "quando esta estação ficou ativa", que é a definição inteira
  // dele. Só estação de fato ativa escreve.
  useEffect(() => {
    storeRef.current = store;
    if (!store || !active) return;
    printedIdsRef.current = {
      kitchen: loadPrintedIds(store.id, 'kitchen'),
      bar: loadPrintedIds(store.id, 'bar'),
    };
    // Ver loadOrCreateActivationCutoff: retoma o corte da sessão anterior
    // desta loja quando existir (reload/recuperação de falha), em vez de
    // descartar o backlog acumulado enquanto a tela esteve fora do ar.
    const { corte, descartado, aberturaFria } = loadOrCreateActivationCutoff(store.id);
    activatedAtRef.current = corte;
    // Descarte de corte DENTRO da janela de lacuna é a única situação em que
    // este mecanismo assume, conscientemente, que pode ter ficado pedido pra
    // trás — ver lacunaCorteKey e LACUNA_JANELA_MAX_MS (Critical #1). Grava e
    // mostra; quem apaga é o operador. Abertura fria (loja estava fechada) faz
    // o contrário: não avisa nada e ainda limpa aviso antigo pendente, pra não
    // arrastar pro dia seguinte um "confira Pedidos do Dia" que já não tem o
    // que conferir.
    if (descartado) saveLacunaCorte(store.id, descartado);
    else if (aberturaFria) saveLacunaCorte(store.id, null);
    setBacklogGapSince(descartado ?? (aberturaFria ? null : loadLacunaCorte(store.id)));
    failedRef.current = new Map();
    setFailedItemsState(new Map());
    // O alarme de falha persistente também é retomado aqui (mesma razão:
    // a loja só é conhecida neste ponto). Sem isto, o reload automático
    // apagava o aviso de impressão quebrada mesmo com o problema de pé.
    const alarmeRetomado = loadFalhaPersistente(store.id);
    setPersistentReconcileFailure(alarmeRetomado);
    // A contagem de falhas seguidas também precisa ser retomada, senão a
    // PRIMEIRA reconciliação depois do reload apagaria o alarme retomado só
    // por ainda não ter acumulado o streak de novo (streak 1 < threshold 2
    // zera o estado) — o alarme voltaria a se calar sozinho com a impressão
    // ainda quebrada, exatamente o bug que esta persistência fecha. Só uma
    // reconciliação BEM-SUCEDIDA pode apagá-lo.
    reconcileFailStreakRef.current = alarmeRetomado ? RECONCILE_FAILURE_ALERT_THRESHOLD : 0;
  }, [store?.id, active]);

  const reconcile = useCallback(async () => {
    const s = storeRef.current;
    if (!s || reconcileLockRef.current) return;
    reconcileLockRef.current = true;
    let fetchFailed = false;
    try {
      // Best-effort, fora do try/catch de impressão: uma falha aqui só
      // significa "nenhuma impressora de rede/USB entra nesta passada",
      // o window.print() de sempre continua rodando normalmente.
      const networkPrinters = await fetchPrinterConfigs(s.id).catch(() => [] as PrinterConfig[]);
      for (const destination of ['kitchen', 'bar'] as const) {
        // eslint-disable-next-line no-await-in-loop -- sequencial de propósito, mesmo motivo do print sequencial dentro de reconcileDestination.
        const failed = await reconcileDestination(s.id, destination, s.name, activatedAtRef.current, printedIdsRef, failedRef, setFailedItemsState, networkPrinters);
        if (failed) fetchFailed = true;
      }
    } catch (e) {
      // try/catch em volta do CORPO INTEIRO do reconcile, não só das
      // chamadas de impressão — achado real do station original (fix round
      // 3, Group A1): sem isto, um throw que escapasse reconcileDestination
      // (ex.: dado malformado não previsto) abortava esta função inteira
      // ANTES de sinalizar falha, deixando o indicador travado no último
      // estado bom pra sempre, com cada tick seguinte lançando de novo em
      // silêncio.
      console.error('CaixaPrintStation.reconcile lançou (tratado como falha):', e);
      fetchFailed = true;
    } finally {
      setLastReconcileAt(new Date().toISOString());
      setLastReconcileFailed(fetchFailed);
      reconcileFailStreakRef.current = fetchFailed ? reconcileFailStreakRef.current + 1 : 0;
      const alarmada = reconcileFailStreakRef.current >= RECONCILE_FAILURE_ALERT_THRESHOLD;
      setPersistentReconcileFailure(alarmada);
      // Grava/apaga o alarme por loja (ver falhaPersistenteKey): é o que
      // faz o aviso sobreviver ao reload automático do desktop, e o que
      // garante que ele só se cala depois de uma reconciliação que de fato
      // deu certo — nunca só porque a tela recarregou.
      saveFalhaPersistente(s.id, alarmada);
      // Carimbo de vida da estação (ver ACTIVATION_IDLE_MAX_MS): é ele, e
      // não a idade do corte, que decide se o próximo mount retoma o corte
      // desta sessão ou começa um novo. Só conta quando a passada falou com
      // o servidor de verdade — um PDV que passa a madrugada tentando e
      // falhando não estava operando, e não deveria conseguir arrastar um
      // corte de ontem pro turno de hoje.
      if (!fetchFailed) saveUltimaAtividade(s.id);
      reconcileLockRef.current = false;
    }
  }, []);

  // Assinatura Realtime + backstop de intervalo + foco/online — mesmos 4
  // gatilhos do station original (ativar, ping Realtime, intervalo fixo,
  // volta de foco/rede), só que aqui "ativar" é "a sessão do caixa qualifica
  // pra isto agora" em vez de um botão explícito: `window.print()` não é
  // gateado por gesto novo no Chromium (mesma pesquisa já documentada no
  // station original), e o caixa já está ativamente usando o painel — pedir
  // um clique extra só pra "ligar a impressão de fundo" seria fricção sem
  // ganho real de garantia.
  useEffect(() => {
    if (!active || !store) return;
    reconcile();
    const unsubscribe = subscribeToStoreOrderChanges(store.id, () => reconcile(), setConnectionStatus, 'print');
    const intervalId = window.setInterval(() => reconcile(), 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') reconcile(); };
    document.addEventListener('visibilitychange', onVisible);
    const onOnline = () => reconcile();
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [active, store, reconcile]);

  useEffect(() => {
    if (!isBrowser()) return;
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Alerta sonoro de falha (achado real, 2026-08-25): um badge vermelho
  // discreto no header não é visto a tempo numa cozinha barulhenta — toca só
  // na TRANSIÇÃO pra um estado de alarme (nunca a cada render/tick com o
  // alarme já ligado, senão viraria ruído constante). `wasAlarmedRef` guarda
  // o último estado conhecido; começa `false` (nunca alarma no primeiro
  // mount só porque `active` acabou de virar true).
  const wasAlarmedRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const isAlarmed = failedItemsState.size > 0 || persistentReconcileFailure || !online;
    if (isAlarmed && !wasAlarmedRef.current) {
      playPrintFailureAlert();
      vibrateAlert([200, 100, 200, 100, 200]);
    }
    wasAlarmedRef.current = isAlarmed;
  }, [active, failedItemsState, persistentReconcileFailure, online]);

  const retryItem = useCallback(async (key: string) => {
    const entry = failedRef.current.get(key);
    if (!entry) return;
    let ok = false;
    try {
      ok = await entry.retry();
    } catch (e) {
      console.error('Reimpressão manual (Caixa) lançou (tratado como falha):', e);
      ok = false;
    }
    if (ok) {
      const [destination, itemId] = key.split(':') as [Destination, string];
      printedIdsRef.current[destination]?.add(itemId);
      if (storeRef.current) savePrintedIds(storeRef.current.id, destination, printedIdsRef.current[destination]);
      failedRef.current.delete(key);
      setFailedItemsState(new Map(failedRef.current));
      toast.success('Reimpresso com sucesso.');
    } else {
      failedRef.current.set(key, { ...entry, attempts: 0 }); // zera contagem: reimpressão manual sempre pode tentar de novo depois
      setFailedItemsState(new Map(failedRef.current));
      toast.error('A reimpressão também falhou. Verifique a impressora.');
    }
  }, []);

  const dismissBacklogGap = useCallback(() => {
    if (storeRef.current) saveLacunaCorte(storeRef.current.id, null);
    setBacklogGapSince(null);
  }, []);

  return {
    active,
    connectionStatus,
    online,
    lastReconcileAt,
    lastReconcileFailed,
    persistentReconcileFailure,
    backlogGapSince,
    dismissBacklogGap,
    failedItems: Array.from(failedItemsState.values()),
    retryItem,
  };
}

// --- Indicador pequeno pro header/chrome ------------------------------
//
// Diferente do banner de tela cheia do station original (que fazia sentido
// lá — a tela inteira daquele aparelho NÃO tinha outro propósito): o caixa
// está fazendo outro trabalho ao mesmo tempo (mesas, comandas, pagamento),
// então isto é só um badge pequeno e persistente, que abre um painel de
// detalhes (Modal, não tela cheia) só quando clicado.
// M2 (revisão de código 2026-08-23): `connectionStatus` começa em
// 'connecting' a cada mount (StoreLayout monta este hook uma vez por
// sessão/F5) — sem grace period, `isAlarmed` incluía esse estado transitório
// dentro de `!isConnected`, deixando o badge vermelho por um instante em
// TODO carregamento, mesmo quando a conexão real vai fechar normal em
// seguida (falso alarme cosmético). `CONNECTING_GRACE_MS` só perdoa
// especificamente "ainda conectando" — falha real de reconciliação
// (`hasFailures`/`persistentReconcileFailure`) ou ficar `disconnected`/
// offline de verdade continuam acendendo o alarme na hora, sem carência
// nenhuma.
const CONNECTING_GRACE_MS = 4000;

// --- Banner de modo offline ---------------------------------------------
//
// Achado real (2026-08-25): a detecção de offline (`status.online`) já
// existia, mas só aparecia como um badge pequeno no header — fácil de não
// notar no meio do corre. Diferente do `CaixaPrintStationIndicator`
// (montado duas vezes, mobile+desktop, ver comentário lá), este banner só
// pode ter UM mount point: `useEffect`/render duplicado tudo bem pro
// indicador pequeno, mas uma faixa fixa de tela cheia duplicada empilharia
// duas faixas idênticas. Montado uma vez só, em `StoreLayout`.
//
// Só acende pra offline de verdade (`!status.online`, evento nativo do
// navegador) — não pra "reconciliando por backstop" (`connectionStatus`
// != 'connected' mas ainda online), que já tem o próprio indicador
// discreto e se resolve sozinho na maioria das vezes sem precisar de
// alarme de tela cheia.
// Correção real (WhatsApp, 2026-09-10): este banner foi escrito em
// 2026-08-25, ANTES do modo offline existir (plano de 2026-09-08) —
// "anote os pedidos no papel até reconectar" já não é verdade desde que
// `lib/offline/` foi implementado: pedido/KDS/fechar conta/caixa
// continuam funcionando pelo app, enfileirados, e sincronizam sozinhos
// ao reconectar (ver `lib/offline/sync.ts`). A mensagem antiga sobrevivia
// dando a entender que o app parava de servir pra qualquer coisa assim
// que a internet caía — o oposto do que o modo offline promete, e
// exatamente o que o dono reportou como "mensagem que não devia mais
// aparecer assim". Só a impressão automática É de fato pausada offline
// (não faz parte da fila — corre à parte, em `CaixaPrintStation.tsx`,
// e depende de reconciliação em tempo real), então isso continua na
// mensagem; o resto foi reescrito pra refletir a realidade atual.
// ONDE O AVISO DE LACUNA MORA (Important da 2ª revisão, 2026-09-13): aqui,
// junto do banner de offline, e não no `CaixaPrintStationIndicator`. Dois
// motivos. (1) Visibilidade: o indicador é um badge pequeno no header, e o
// achado que criou este aviso é justamente "o operador não tem como saber
// que ficou buraco" — um badge que ele já aprendeu a ignorar não resolve;
// esta faixa fixa no topo é o ponto mais visível que existe pro caixa.
// (2) Mount único: o indicador é montado DUAS vezes (mobile + desktop, ver
// StoreModule.tsx), então uma faixa renderizada de lá apareceria duplicada —
// este componente é o único da estação com um mount point só. O nome do
// componente ficou mais estreito que o conteúdo (hoje ele é a faixa de
// avisos da estação, não só a de offline), mas renomear exigiria tocar em
// StoreModule.tsx, fora do escopo desta correção.
//
// Os dois avisos são deliberadamente DIFERENTES em cor, ícone e texto, e não
// se sobrepõem: offline é `--warn` e fala de agora ("a impressão está
// pausada"); lacuna é `--info` e fala do passado ("pode ter ficado pedido
// sem imprimir, confira Pedidos do Dia"). O alarme vermelho do indicador
// continua sendo a terceira coisa, separada das duas ("está quebrado
// agora"). Offline tem prioridade na faixa: sem internet, não adianta mandar
// o operador reimprimir.
//
// POSIÇÃO: EMPURRA, NUNCA SOBREPÕE (Important #4 da revisão final,
// 2026-09-13). Esta faixa era `fixed top-0 inset-x-0 z-[60]` e o header do
// lojista é `sticky top-0 z-30` (StoreModule.tsx) — ou seja, ela cobria o
// header inteiro no celular: o hambúrguer (a ÚNICA navegação em mobile), o
// badge de falhas e o indicador de impressão. Com o banner de offline isso já
// era ruim mas passageiro (some sozinho quando a conexão volta); o aviso de
// lacuna fica na tela até alguém clicar no X, quebra em duas linhas a 390px e
// deixa o operador SEM COMO NAVEGAR — e o X, coberto pelo próprio conteúdo
// que ele deveria liberar, vira a única saída.
// Correção: a faixa passa a ser um elemento de FLUXO NORMAL (sem `fixed`,
// sem z-index) renderizado acima do header em StoreModule.tsx. Ela empurra a
// página pra baixo em vez de flutuar por cima, então nunca há sobreposição em
// largura nenhuma — nada de calcular offset de header, `scroll-margin` ou
// z-index novo, que é o tipo de coisa que quebra de novo na próxima mudança de
// layout. Efeito colateral aceito de propósito: rolando a página a faixa sai
// de vista (o header sticky assume o topo, como sempre). Nenhum dos dois
// avisos é acionável em tempo real — offline se resolve sozinho e a lacuna se
// resolve em "Pedidos do Dia" —, e o badge do header (que a faixa cobria!)
// continua visível o tempo todo pra quem quiser o estado atual.
export const CaixaPrintStationOfflineBanner: React.FC<{ status: CaixaPrintStationState }> = ({ status }) => {
  if (!status.active) return null;
  if (!status.online) {
    return (
      <div className="bg-[var(--warn)] text-white text-center text-xs sm:text-sm font-bold px-4 py-2 flex items-center justify-center gap-2">
        <WifiOff size={14} className="shrink-0" />
        Sem conexão com a internet — pedidos, mesas e caixa continuam funcionando normalmente e sincronizam sozinhos quando a conexão voltar. Só a impressão automática fica pausada até reconectar.
      </div>
    );
  }
  if (!status.backlogGapSince) return null;
  return (
    <div className="bg-[var(--info)] text-white text-xs sm:text-sm font-bold px-4 py-2 flex items-center justify-center gap-2">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="text-center">
        A impressão automática ficou fora do ar por um tempo (desde {new Date(status.backlogGapSince).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}). Pode ter ficado pedido sem imprimir — confira "Pedidos do Dia" e use Reimprimir.
      </span>
      <button
        type="button"
        onClick={status.dismissBacklogGap}
        title="Já conferi, pode dispensar"
        aria-label="Dispensar aviso"
        className="shrink-0 ml-1 rounded-full p-1 bg-white/20 hover:bg-white/30 u-motion"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const CaixaPrintStationIndicator: React.FC<{ status: CaixaPrintStationState; className?: string; storeName?: string }> = ({ status, className, storeName }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [withinConnectingGrace, setWithinConnectingGrace] = useState(true);
  const [testingPrint, setTestingPrint] = useState(false);

  // "Testar Impressão" (achado real, 2026-08-25): sem isso, ninguém descobre
  // se o Chrome deste aparelho está em modo silencioso (kiosk-printing) até
  // um pedido de verdade travar num diálogo nativo do SO esperando alguém
  // clicar — o que quebra a promessa central deste mecanismo inteiro
  // ("imprime sozinha, em segundo plano"). Ticket de teste real, mesmo
  // `printKitchenTicket` do loop automático — não um mock — pra realmente
  // provar o caminho fim a fim.
  const handleTestPrint = async () => {
    setTestingPrint(true);
    try {
      const ok = await printKitchenTicket({
        kind: 'COZINHA',
        storeName: storeName || 'Loja',
        orderType: 'MESA',
        identifier: 'TESTE DE IMPRESSÃO',
        quantity: 1,
        productName: 'Ticket de teste — pode descartar',
        observation: 'Se isso imprimiu sem pedir nenhum clique, a impressão silenciosa está configurada corretamente.',
        orderIdShort: 'TESTE',
      });
      if (ok) toast.success('Ticket de teste enviado. Confira se saiu na impressora sem pedir nenhum clique.');
      else toast.error('Falha ao enviar o ticket de teste.');
    } finally {
      setTestingPrint(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setWithinConnectingGrace(false), CONNECTING_GRACE_MS);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!status.active) return null;

  const isConnected = status.connectionStatus === 'connected' && status.online;
  const isStillConnecting = status.connectionStatus === 'connecting' && status.online;
  const hasFailures = status.failedItems.length > 0;
  // Falha na própria consulta ao servidor (distinto de "0 pedidos
  // pendentes") também acende o indicador, mesmo sem nenhum item na lista
  // de falhas — é exatamente o caso que o `onError` de fetchKitchenOrders
  // existe pra não deixar passar em silêncio.
  const isAlarmed = hasFailures || status.persistentReconcileFailure || (!isConnected && !(isStillConnecting && withinConnectingGrace));

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDetails(true)}
        title="Impressão automática (Caixa) — clique pra ver detalhes"
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold u-motion u-press-sm border ${
          isAlarmed
            ? 'bg-[var(--err)]/10 border-[var(--err)]/30 text-[var(--err)]'
            : 'bg-[var(--ok)]/10 border-[var(--ok)]/30 text-[var(--ok)]'
        } ${className || ''}`}
      >
        {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span className="hidden sm:inline">Impressão</span>
        {hasFailures && (
          <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[var(--err)] text-white text-[10px] font-bold num">
            {status.failedItems.length}
          </span>
        )}
      </button>

      <Modal isOpen={showDetails} onClose={() => setShowDetails(false)} title="Impressão automática (Caixa)" variant="sheet">
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Imprime sozinha, em segundo plano, o pedido do próprio cliente (QR), do Balcão e do garçom — nenhum aparelho além deste tem a impressora da cozinha configurada.
          </p>

          <Button size="sm" variant="secondary" className="w-full" onClick={handleTestPrint} isLoading={testingPrint}>
            Testar Impressão
          </Button>
          <p className="text-[11px] text-[var(--text-muted)] -mt-1">
            Se pedir pra você clicar em "Imprimir" ou escolher impressora, este aparelho não está configurado pra imprimir sozinho — avise o suporte antes de abrir a loja.
          </p>

          <div className="flex items-center gap-2 text-sm">
            {isConnected ? <Wifi size={16} className="text-[var(--ok)]" /> : <WifiOff size={16} className="text-[var(--err)]" />}
            <span className={isConnected ? 'text-[var(--text)]' : 'text-[var(--err)] font-semibold'}>
              {isConnected ? 'Conectado' : 'Sem conexão em tempo real — reconciliando por backstop'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {status.lastReconcileFailed ? <XCircle size={16} className="text-[var(--err)]" /> : <CheckCircle2 size={16} className="text-[var(--ok)]" />}
            <span className={status.lastReconcileFailed ? 'text-[var(--err)] font-semibold' : 'text-[var(--text-muted)]'}>
              {status.lastReconcileAt
                ? `Última verificação: ${new Date(status.lastReconcileAt).toLocaleTimeString('pt-BR')}${status.lastReconcileFailed ? ' — falhou ao consultar o servidor' : ''}`
                : 'Aguardando primeira verificação...'}
            </span>
          </div>

          {/* Mesmo aviso da faixa, repetido aqui porque é onde o caixa vem
              olhar quando desconfia da impressão — e porque a faixa pode ter
              sido dispensada sem ninguém conferir. Cor de informação, nunca
              a vermelha de falha: não é "está quebrado", é "confira se ficou
              buraco". Ver lacunaCorteKey. */}
          {status.backlogGapSince && (
            <div className="p-3 rounded-lg bg-[var(--info)]/10 border border-[var(--info)]/30 text-sm text-[var(--info)] space-y-2">
              <p className="font-semibold">
                A impressão automática ficou fora do ar por um tempo (desde {new Date(status.backlogGapSince).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}). Pode ter ficado pedido sem imprimir — confira &quot;Pedidos do Dia&quot; e use Reimprimir.
              </p>
              <Button size="sm" variant="secondary" onClick={status.dismissBacklogGap}>
                Já conferi, dispensar aviso
              </Button>
            </div>
          )}

          {status.persistentReconcileFailure && (
            <div className="p-3 rounded-lg bg-[var(--err)]/10 border border-[var(--err)]/30 text-sm text-[var(--err)] font-semibold">
              Falha ao buscar pedidos no servidor por tempo demais — avise o suporte. A impressão automática pode estar cega.
            </div>
          )}

          {hasFailures ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[var(--err)] uppercase tracking-wide">
                {status.failedItems.length} impressão(ões) falharam
              </p>
              {status.failedItems.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-3 bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)]">
                  <span className="text-sm text-[var(--text)] truncate">{entry.description}</span>
                  <Button size="sm" variant="danger" onClick={() => status.retryItem(entry.key)}>
                    <RotateCcw size={14} className="mr-1" /> Reimprimir
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">Nenhuma falha registrada nesta sessão.</p>
          )}
        </div>
      </Modal>
    </>
  );
};
