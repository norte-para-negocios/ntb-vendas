# Agente de impressão — NTB Vendas

Programa pequeno que roda no computador ligado na impressora da loja (rede ou USB) e
imprime automaticamente os pedidos que chegam no sistema, sem precisar de nenhum
navegador aberto.

**Só é necessário se você cadastrou uma impressora "Rede (IP)" ou "USB local" na aba
Impressão do painel.** Se você usa só a impressora padrão do computador do caixa
("Impressora do sistema"), não precisa instalar nada disso — já funciona sozinho.

## Como instalar e usar (recomendado — sem instalar Node.js)

1. Baixe `ntb-print-agent.exe` (peça o link pro suporte técnico, ou gere você mesmo —
   ver "Gerando o .exe" abaixo).
2. Dê duplo-clique nele. Na primeira vez, ele pergunta o slug da loja (é a parte final
   do link do cardápio — ex: se o link é `.../c/sertao-vai-virar-mar`, o slug é
   `sertao-vai-virar-mar`). Digite e aperte Enter — só precisa fazer isso uma vez, ele
   grava sozinho e não pergunta de novo.
3. Deixe essa janela preta aberta — é ela que fica escutando a fila de impressão. Se
   fechar, a impressão automática das impressoras de rede/USB para de funcionar (a
   impressora padrão do sistema, se tiver, continua normal).

Não precisa baixar nenhum outro arquivo nem criar pasta nenhuma — é só o `.exe`.

### Abrir sozinho quando o Windows ligar (recomendado)

Achado real: se o computador reinicia (falta de luz, Windows Update) e ninguém lembra
de abrir o agente de novo, a impressão automática para até alguém notar. Baixe também
`instalar-inicializacao-automatica.bat` e coloque na MESMA pasta do `.exe`, dê
duplo-clique nele uma vez — o agente passa a abrir sozinho a cada login no Windows. Pra
desativar depois: procure "Agendador de Tarefas" no Windows e apague a tarefa
"NTB Print Agent".

### Se digitar o slug errado

Ele avisa na hora ("Não encontrei nenhuma loja com esse slug") e pergunta de novo, sem
precisar fechar e reabrir nada.

### Trocar de loja depois (raro)

O slug fica gravado num `config.json` que aparece na mesma pasta do `.exe` depois do
primeiro uso. Pra trocar de loja, apague esse arquivo e abra o `.exe` de novo — ele
pergunta o slug outra vez.

## Alternativa — com Node.js instalado (avançado)

Só faz sentido se você já tem Node.js e prefere rodar via terminal em vez do `.exe`:
```
npm install
npm start
```
O mesmo comportamento de primeira-vez-pergunta-o-slug funciona igual.

## Gerando o .exe (feito pelo suporte técnico)

Com Node.js instalado numa máquina de desenvolvimento (não precisa ser a da loja):
```
npm install
npm run build:exe
```
Gera `ntb-print-agent.exe` nesta mesma pasta (não é commitado no repositório — é
sempre gerado na hora de entregar pra uma loja, pra nunca ficar desatualizado em
relação ao `agent.js`).

## Cadastrando a impressora no painel

Na aba **Impressão** do painel do lojista:

- **Impressora de rede**: informe o IP da impressora (pergunte pro suporte técnico da
  impressora ou veja no menu dela, geralmente em Configurações → Rede). Porta padrão:
  `9100`.
- **Impressora USB local**: informe o nome exato dela como aparece nas impressoras
  instaladas do Windows/Mac (Painel de Controle → Dispositivos e Impressoras).

Depois de cadastrar, clique em "Imprimir teste" — se o agente estiver rodando, o ticket
sai na impressora em poucos segundos.

## Problemas comuns

- **"Nenhuma loja com esse slug"**: o programa já pergunta de novo na hora — confira se
  digitou certo.
- **Teste fica "Na fila" pra sempre**: o agente não está rodando, ou não achou a
  impressora (confira o IP/nome e se o computador está na mesma rede da impressora).
- **Falhou com erro de conexão** (impressora de rede): confira se o IP está certo e se a
  impressora está ligada e na mesma rede Wi-Fi/cabo deste computador.
