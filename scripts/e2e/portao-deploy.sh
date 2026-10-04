#!/usr/bin/env bash
# PORTÃO DE DEPLOY do Norte Vendas. Nenhum deploy sobe sem este script terminar com PASSOU em todos os itens.
#
#   scripts/e2e/portao-deploy.sh              # tsc + testes + build de produção + fluxo completo (Playwright) na loja ZZ Laboratório
#   PORTAO_RAPIDO=1 scripts/e2e/portao-deploy.sh   # troca o build de produção por `next dev` (só para depurar; NÃO vale como portão)
#   PORTAO_SO=tsc|testes|fluxo ...            # roda só uma etapa (também NÃO vale como portão)
#
# Sai com código 1 se qualquer item falhar. O deploy.sh do servidor continua IGUAL (git pull + build + restart); a regra é de quem faz
# push: rode este portão antes. Nunca toca no Sertão, nunca emite nota fiscal real, o Estoque é sempre um mock local, não aplica migrations.
set -u
cd "$(dirname "$0")/../.."
RAIZ="$(pwd)"
SAIDA="$RAIZ/scripts/e2e/.out"
mkdir -p "$SAIDA"
LOCK="$RAIZ/scripts/e2e/.portao.lock"
FALHAS=0
SERVIDOR_PID=""
INICIO=$(date +%s)
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
PARCIAL=0
[ -n "${PORTAO_RAPIDO:-}" ] && PARCIAL=1
[ -n "${PORTAO_SO:-}" ] && PARCIAL=1

limpar() {
  if [ -n "$SERVIDOR_PID" ] && kill -0 "$SERVIDOR_PID" 2>/dev/null; then
    kill "$SERVIDOR_PID" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SERVIDOR_PID" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$SERVIDOR_PID" 2>/dev/null
    # o `next dev`/`next start` deixa um filho (next-server): derruba pelo grupo de processos também
    pkill -P "$SERVIDOR_PID" 2>/dev/null
  fi
  [ -d "$LOCK" ] && rmdir "$LOCK" 2>/dev/null
  return 0
}
trap limpar EXIT INT TERM

# Um portão por vez por pasta (o build usa .next).
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Outro portão já está rodando nesta pasta ($LOCK). Se tiver certeza que não, apague a pasta e tente de novo."; exit 2
fi

item() { # item "nome" comando...  -> imprime PASSOU/FALHOU e guarda o log
  local nome="$1"; shift
  local slug; slug="$(echo "$nome" | tr -c 'A-Za-z0-9' '_' | cut -c1-60)"
  local log="$SAIDA/$slug.log"
  if "$@" >"$log" 2>&1; then printf '  PASSOU  %s\n' "$nome"; return 0; fi
  printf '  FALHOU  %s\n' "$nome"; FALHAS=$((FALHAS + 1))
  echo "          -> log: scripts/e2e/.out/$slug.log"; tail -n 8 "$log" | sed 's/^/             /'
  return 1
}
etapa() { echo; echo "== $*"; }
quer() { [ -z "${PORTAO_SO:-}" ] || [ "${PORTAO_SO}" = "$1" ]; }

echo "PORTÃO DE DEPLOY — Norte Vendas — commit $COMMIT"
[ -n "$(git status --porcelain 2>/dev/null)" ] && echo "AVISO: há mudanças não commitadas; o portão testa a pasta como está, o push leva só o que está commitado."

# ---------------------------------------------------------------------------------------------------------------- 1. TypeScript
if quer tsc; then
  etapa "1. TypeScript (tsc --noEmit)"
  item "tsc --noEmit" npx tsc --noEmit
fi

# ---------------------------------------------------------------------------------------------------------------- 2. testes
if quer testes; then
  etapa "2. Testes unitários (scripts/testes/*.test.ts)"
  for t in scripts/testes/*.test.ts; do
    item "$(basename "$t")" npx tsx "$t"
  done
fi

# ---------------------------------------------------------------------------------------------------------------- 3. fluxo completo
if quer fluxo; then
  PORTA="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
  # Sem retransmissão fiscal nem reenvio de baixa em segundo plano, sem cópia no histórico frio: o servidor de teste só atende o teste.
  export DISABLE_FISCAL_RETRANSMISSAO=1 DISABLE_BAIXA_RETRY=1 NTB_FRIO_API_URL= BAIXA_ESTOQUE_TIMEOUT_MS=3000
  if [ -z "${PORTAO_RAPIDO:-}" ]; then
    etapa "3. Build de produção (next build)"
    cp tsconfig.json "$SAIDA/tsconfig.antes.json"
    item "next build" npx next build
    cmp -s tsconfig.json "$SAIDA/tsconfig.antes.json" || cp "$SAIDA/tsconfig.antes.json" tsconfig.json   # o Next reescreve o include do tsconfig
    CMD_SERVIDOR=(node node_modules/next/dist/bin/next start -p "$PORTA")
  else
    etapa "3. (PORTAO_RAPIDO) servidor de desenvolvimento no lugar do build"
    CMD_SERVIDOR=(node node_modules/next/dist/bin/next dev -p "$PORTA")
  fi
  etapa "4. Fluxo completo (Playwright headless, loja ZZ Laboratório, Estoque mock) em http://localhost:$PORTA"
  if [ "$FALHAS" -gt 0 ] && [ -z "${PORTAO_RAPIDO:-}" ]; then
    echo "  (pulado: o build falhou, não há o que testar)"
  else
    "${CMD_SERVIDOR[@]}" >"$SAIDA/servidor.log" 2>&1 &
    SERVIDOR_PID=$!
    echo "  servidor de teste: PID $SERVIDOR_PID, porta $PORTA (parado no fim pelo PID)"
    for _ in $(seq 1 120); do
      curl -s -o /dev/null --max-time 3 "http://localhost:$PORTA/loja" && break
      kill -0 "$SERVIDOR_PID" 2>/dev/null || { echo "  o servidor de teste caiu:"; tail -n 15 "$SAIDA/servidor.log"; break; }
      sleep 2
    done
    # aquece as rotas do modo dev (a primeira compilação de cada rota é lenta)
    [ -n "${PORTAO_RAPIDO:-}" ] && curl -s -o /dev/null --max-time 120 "http://localhost:$PORTA/loja"
    BASE_URL="http://localhost:$PORTA" node scripts/e2e/fluxo-completo.mjs 2>&1 | tee "$SAIDA/fluxo.log" | awk '{ print "  " $0; fflush() }'
    RC=${PIPESTATUS[0]}
    if [ "$RC" -ne 0 ]; then
      FALHAS=$((FALHAS + 1)); echo "  FALHOU  fluxo completo (código $RC) — detalhes em scripts/e2e/.out/fluxo.log, capturas em scripts/e2e/.out/"
    else
      echo "  PASSOU  fluxo completo"
    fi
    # o fluxo se limpa sozinho; se foi interrompido, desfaz o que sobrou
    if [ -f scripts/e2e/.estado-portao.json ]; then BASE_URL="http://localhost:$PORTA" node scripts/e2e/fluxo-completo.mjs --limpar || FALHAS=$((FALHAS + 1)); fi
    kill "$SERVIDOR_PID" 2>/dev/null; wait "$SERVIDOR_PID" 2>/dev/null; SERVIDOR_PID=""
  fi
fi

# ---------------------------------------------------------------------------------------------------------------- resultado
FIM=$(date +%s)
echo
echo "=============================================================================="
if [ "$FALHAS" -eq 0 ]; then
  if [ "$PARCIAL" -eq 1 ]; then echo "PORTÃO: PASSOU (execução PARCIAL — não vale como portão de deploy)"; else echo "PORTÃO: PASSOU em $((FIM - INICIO))s (commit $COMMIT)"; fi
else
  echo "PORTÃO: FALHOU ($FALHAS item(ns)) em $((FIM - INICIO))s — NÃO faça push nem deploy."
fi
echo "------------------------------------------------------------------------------"
echo "LEMBRETE: o deploy.sh do servidor NÃO roda este portão. Quem faz push roda o portão ANTES, no commit que vai subir ($COMMIT)."
echo "          Sem PASSOU completo (sem PORTAO_RAPIDO/PORTAO_SO) o deploy não sobe. Mudou algo depois? Rode de novo."
echo "=============================================================================="
[ "$FALHAS" -eq 0 ] || exit 1
exit 0
