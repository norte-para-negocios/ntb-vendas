# Release seguro dos apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar uma versão dos apps (Windows e Android) só se ela foi construída do commit certo, com o servidor certo embutido, testada, e com volta atrás em um comando.

**Architecture:** Dois scripts de shell na raiz de `scripts/`: `release-apps.sh` (checagens → build → trava de servidor → backup do feed → publicação → verificação do que foi publicado) e `rollback-apps.sh` (restaura o feed salvo). Reaproveita `scripts/conferir-bundle.mjs`, `desktop/scripts/publish.sh`, `mobile/scripts/publish-android.sh` e `scripts/e2e/portao-deploy.sh`.

**Tech Stack:** bash, node (`conferir-bundle.mjs`), electron-builder, gradle, ssh/scp para o Contabo.

**Spec:** Incidente de 04/10/2026 (apps 1.2.84-1.2.86 e 1.0.20-1.0.22 publicados apontando para o Supabase antigo) e memória `project-norte-vendas-incidente-offline-2026-10-04`.

## Global Constraints

- Servidor de update: `root@185.193.66.240`, pasta `/home/ntb/web/updates.norteparanegocios.com.br/public_html/{ntb-vendas-desktop,ntb-vendas-android}`; chave ssh `~/.ssh/notebook_contabo_key`.
- Atualização sempre OPCIONAL (nunca tela obrigatória; incidente de 30/09). Nunca mandar link fixo ao cliente.
- O servidor embutido tem que ser `testvendase.norteparanegocios.com.br`; `giiwtnddasminjxweohr` é proibido (`scripts/conferir-bundle.mjs`).
- Só publica de commit que é ancestral de `origin/main` e sem mudança não commitada.
- Backup do feed antes de publicar em `/root/backups/feed-pre-<versão>/`.

## Review Focus

- Árvore suja ou commit fora do `origin/main`: o script recusa.
- `.env.local` do webapp ausente (worktree): o script copia da pasta principal ou recusa.
- Versão do `package.json` igual à que já está no feed: recusa (evita republicar por cima).
- Download do arquivo recém-publicado com tamanho diferente do local: falha alto e oferece rollback.
- `--dry-run`: faz tudo menos publicar.

---

### Task 1: `release-apps.sh` com checagens e `--dry-run`

**Files:**
- Create: `scripts/release-apps.sh`

**Interfaces:**
- Produces: `scripts/release-apps.sh [--dry-run] [--so-windows|--so-android]`; sai com código 1 em qualquer checagem que falhar; imprime a lista PASSOU/FALHOU.

- [ ] **Step 1: Escrever o script**

```bash
#!/usr/bin/env bash
# Publicação segura dos apps Norte Vendas (Windows + Android). Ver docs/superpowers/plans/2026-10-05-release-seguro.md
set -u
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
REMOTE="root@185.193.66.240"
KEY=~/.ssh/notebook_contabo_key
FEED="/home/ntb/web/updates.norteparanegocios.com.br/public_html"
DRY=0; WIN=1; AND=1
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --so-windows) AND=0;; --so-android) WIN=0;; esac; done
falha() { echo "  FALHOU  $1"; echo; echo "RELEASE ABORTADO: nada foi publicado."; exit 1; }
ok() { echo "  PASSOU  $1"; }

echo "== 1. Estado do repositório"
[ -z "$(git status --porcelain -- . ':!mobile/android/capacitor.settings.gradle' ':!scripts/e2e/.out' ':!scripts/e2e/.estado-portao.json')" ] || falha "há mudança não commitada"; ok "árvore limpa"
git fetch -q origin || falha "git fetch"
git merge-base --is-ancestor HEAD origin/main || falha "commit atual não está no origin/main (faça push antes)"; ok "commit $(git rev-parse --short HEAD) está no origin/main"

echo "== 2. Configuração do servidor embutido"
for d in desktop/webapp mobile/webapp; do
  if [ ! -f "$d/.env.local" ]; then
    PRINC="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
    [ -f "$PRINC/$d/.env.local" ] && cp "$PRINC/$d/.env.local" "$d/.env.local" && echo "  (copiei $d/.env.local da pasta principal)"
  fi
  [ -f "$d/.env.local" ] || falha "$d/.env.local ausente"
  grep -q "testvendase.norteparanegocios.com.br" "$d/.env.local" || falha "$d/.env.local não aponta para testvendase"
done; ok ".env.local dos dois webapps apontam para o servidor certo"

echo "== 3. Versões"
VW="$(node -p "require('./desktop/package.json').version")"
VA="$(node -p "require('./mobile/package.json').version")"
NOWFEEDW="$(curl -s https://updates.norteparanegocios.com.br/ntb-vendas-desktop/latest.yml | sed -n 's/^version: //p')"
NOWFEEDA="$(curl -s https://updates.norteparanegocios.com.br/ntb-vendas-android/latest.json | sed -n 's/.*"versionName": "\([^"]*\)".*/\1/p')"
[ "$WIN" = 0 ] || { [ "$VW" != "$NOWFEEDW" ] || falha "desktop $VW já está no feed (suba a versão)"; }
[ "$AND" = 0 ] || { [ "$VA" != "$NOWFEEDA" ] || falha "android $VA já está no feed (suba a versão)"; }
ok "desktop $VW (feed: $NOWFEEDW) | android $VA (feed: $NOWFEEDA)"

echo "== 4. Portão (tsc + testes + build + fluxo)"
bash scripts/e2e/portao-deploy.sh >/tmp/release-portao.log 2>&1 && ok "portão PASSOU" || { tail -15 /tmp/release-portao.log; falha "portão"; }

echo "== 5. Build"
if [ "$WIN" = 1 ]; then rm -rf desktop/dist; (cd desktop && npm run dist >/tmp/release-win.log 2>&1) || { tail -10 /tmp/release-win.log; falha "build Windows"; }; ok "instalador Windows"; fi
if [ "$AND" = 1 ]; then
  (cd mobile && npm run build:web >/tmp/release-and.log 2>&1 && npx cap sync android >>/tmp/release-and.log 2>&1 && cd android && ./gradlew assembleDebug -q >>/tmp/release-and.log 2>&1) || { tail -10 /tmp/release-and.log; falha "build Android"; }
  node scripts/conferir-bundle.mjs mobile/android/app/build/outputs/apk/debug/app-debug.apk || falha "APK com servidor errado"; ok "APK"
fi

if [ "$DRY" = 1 ]; then echo; echo "DRY-RUN: tudo certo, nada publicado."; exit 0; fi

echo "== 6. Backup do feed e publicação"
ssh -n -i $KEY $REMOTE "mkdir -p /root/backups/feed-pre-${VW:-x}-${VA:-x}/desktop /root/backups/feed-pre-${VW:-x}-${VA:-x}/android && cp -p $FEED/ntb-vendas-desktop/latest.yml /root/backups/feed-pre-${VW:-x}-${VA:-x}/desktop/ && cp -p $FEED/ntb-vendas-android/latest.json /root/backups/feed-pre-${VW:-x}-${VA:-x}/android/" || falha "backup do feed"
echo "$VW-$VA" > /tmp/release-ultimo-backup.txt
if [ "$WIN" = 1 ]; then (cd desktop && bash scripts/publish.sh >/tmp/release-pub-win.log 2>&1) || falha "publicar Windows"; fi
if [ "$AND" = 1 ]; then (cd mobile && bash scripts/publish-android.sh >/tmp/release-pub-and.log 2>&1) || falha "publicar Android"; fi

echo "== 7. Verificação do que foi publicado"
if [ "$WIN" = 1 ]; then
  L=$(stat -f%z "desktop/dist/Norte Vendas Setup $VW.exe"); R=$(curl -sI "https://updates.norteparanegocios.com.br/ntb-vendas-desktop/Norte%20Vendas%20Setup%20$VW.exe" | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r')
  [ "$L" = "$R" ] && ok "Windows no servidor: $R bytes" || { echo "  tamanho local=$L remoto=$R"; falha "Windows publicado diferente do construído (rode scripts/rollback-apps.sh)"; }
fi
if [ "$AND" = 1 ]; then
  T="$(mktemp -d)"; curl -s -o "$T/a.apk" "https://updates.norteparanegocios.com.br/ntb-vendas-android/Norte-Vendas-$VA.apk"
  node scripts/conferir-bundle.mjs "$T/a.apk" && ok "APK baixado do servidor passa na trava" || falha "APK publicado com servidor errado (rode scripts/rollback-apps.sh)"
fi
echo; echo "RELEASE OK: desktop $VW / android $VA publicados como atualização opcional."
echo "Para desfazer: scripts/rollback-apps.sh"
```

- [ ] **Step 2: Tornar executável e rodar em `--dry-run`**

Run: `chmod +x scripts/release-apps.sh && scripts/release-apps.sh --dry-run`
Expected: se a versão ainda é a do feed, FALHOU "já está no feed" (prova que a trava funciona); depois de subir a versão, `DRY-RUN: tudo certo, nada publicado.`

- [ ] **Step 3: Commit**

```bash
git add scripts/release-apps.sh
git commit -m "chore(release): release-apps.sh com checagens, trava de servidor e verificação

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: `rollback-apps.sh`

**Files:**
- Create: `scripts/rollback-apps.sh`

**Interfaces:**
- Consumes: pastas `/root/backups/feed-pre-<desktop>-<android>/` criadas por `release-apps.sh`.
- Produces: `scripts/rollback-apps.sh [<desktop>-<android>]` (sem argumento usa o último de `/tmp/release-ultimo-backup.txt`).

- [ ] **Step 1: Escrever o script**

```bash
#!/usr/bin/env bash
# Volta o feed de update dos apps para o que estava antes da última publicação. Quem já atualizou NÃO volta (sem downgrade).
set -eu
REMOTE="root@185.193.66.240"; KEY=~/.ssh/notebook_contabo_key
FEED="/home/ntb/web/updates.norteparanegocios.com.br/public_html"
ID="${1:-$(cat /tmp/release-ultimo-backup.txt 2>/dev/null || true)}"
[ -n "$ID" ] || { echo "informe <desktop>-<android> (ex.: 1.2.88-1.0.24) ou rode depois de um release"; exit 1; }
ssh -n -i $KEY $REMOTE "set -e; B=/root/backups/feed-pre-$ID; [ -d \$B ] || { echo 'backup \$B não existe'; exit 1; }
cp -p \$B/desktop/latest.yml $FEED/ntb-vendas-desktop/latest.yml
cp -p \$B/android/latest.json $FEED/ntb-vendas-android/latest.json
chown -R ntb:ntb $FEED/ntb-vendas-desktop $FEED/ntb-vendas-android; echo feed restaurado"
curl -s https://updates.norteparanegocios.com.br/ntb-vendas-desktop/latest.yml | sed -n 1p
curl -s https://updates.norteparanegocios.com.br/ntb-vendas-android/latest.json; echo
```

- [ ] **Step 2: Testar sem mudar nada de verdade**

Run: `chmod +x scripts/rollback-apps.sh && bash -n scripts/rollback-apps.sh && echo sintaxe-ok`
Expected: `sintaxe-ok`. (O teste real acontece no primeiro release.)

- [ ] **Step 3: Commit**

```bash
git add scripts/rollback-apps.sh
git commit -m "chore(release): rollback-apps.sh

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Documentar no AGENTS.md

**Files:**
- Modify: `AGENTS.md` (nova seção "Release dos apps (05/10/2026)" depois de "Portão de deploy")

- [ ] **Step 1: Adicionar a seção**

Texto: regra "só se publica app por `scripts/release-apps.sh`"; o que cada passo checa; que `.env.local` de `desktop/webapp` e `mobile/webapp` é gitignored e precisa existir (o script copia da pasta principal); que `scripts/conferir-bundle.mjs` reprova bundle com servidor errado; como desfazer (`scripts/rollback-apps.sh`); e que quem já atualizou não volta atrás.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: release seguro dos apps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
