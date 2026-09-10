# Agente de impressão — NTB Vendas

Programa pequeno que roda no computador ligado na impressora da loja (rede ou USB) e
imprime automaticamente os pedidos que chegam no sistema, sem precisar de nenhum
navegador aberto.

**Só é necessário se você cadastrou uma impressora "Rede (IP)" ou "USB local" na aba
Impressão do painel.** Se você usa só a impressora padrão do computador do caixa
("Impressora do sistema"), não precisa instalar nada disso — já funciona sozinho.

## Como instalar (uma vez só)

Duas formas — escolha uma. Nos dois casos, o primeiro passo é o mesmo:

1. Copie o arquivo `config.example.json` e renomeie a cópia para `config.json`.
2. Abra o `config.json` num editor de texto e troque `storeSlug` pelo slug da loja — é a
   parte final do link do cardápio (ex: se o link é
   `.../c/sertao-vai-virar-mar`, o slug é `sertao-vai-virar-mar`).

### Opção A — sem instalar nada (recomendado pra loja)

Peça o arquivo `ntb-print-agent.exe` pro suporte técnico (é gerado a partir deste
código, não fica pronto no repositório — ver "Gerando o .exe" abaixo). Coloque esse
`.exe` NA MESMA PASTA do `config.json` que você acabou de criar. Não precisa instalar
Node.js nem rodar `npm install`.

### Opção B — com Node.js instalado

1. Instale o [Node.js](https://nodejs.org) neste computador, se ainda não tiver (baixe a
   versão "LTS").
2. Abra um terminal (Prompt de Comando / PowerShell no Windows, Terminal no Mac) dentro
   desta pasta e rode:
   ```
   npm install
   ```

## Como usar (toda vez que for abrir a loja)

**Opção A (.exe)**: dê duplo-clique em `ntb-print-agent.exe`. Uma janela preta abre e
fica escutando a fila de impressão — pode minimizar, mas não feche.

**Opção B (Node.js instalado)**: dentro desta pasta, rode:
```
npm start
```

Em ambos os casos, deixe a janela aberta — fechá-la para o agente (a impressão
automática das impressoras de rede/USB para de funcionar; a impressora padrão do
sistema, se tiver, continua normal).

### Abrir sozinho quando o Windows ligar (recomendado)

Achado real: se o computador reinicia (falta de luz, Windows Update) e ninguém lembra
de abrir o agente de novo, a impressão automática para até alguém notar. Com a Opção A
(`.exe`) instalada, dê duplo-clique em `instalar-inicializacao-automatica.bat` nesta
pasta (uma vez só) — o agente passa a abrir sozinho a cada login no Windows. Pra
desativar depois: procure "Agendador de Tarefas" no Windows e apague a tarefa
"NTB Print Agent".

## Gerando o .exe (Opção A, feito pelo suporte técnico)

Com Node.js instalado numa máquina de desenvolvimento (não precisa ser a da loja):
```
npm install
npm run build:exe
```
Gera `ntb-print-agent.exe` nesta mesma pasta (não é commitado no repositório — é
sempre gerado na hora de entregar pra uma loja, pra nunca ficar desatualizado em
relação ao `agent.js`). Entregue esse arquivo + o `config.json` já preenchido com o
slug da loja pra quem for instalar (Opção A acima).

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

- **"Nenhuma loja com esse slug"**: confira se digitou o slug certo no `config.json`.
- **Teste fica "Na fila" pra sempre**: o agente não está rodando, ou não achou a
  impressora (confira o IP/nome e se o computador está na mesma rede da impressora).
- **Falhou com erro de conexão** (impressora de rede): confira se o IP está certo e se a
  impressora está ligada e na mesma rede Wi-Fi/cabo deste computador.
