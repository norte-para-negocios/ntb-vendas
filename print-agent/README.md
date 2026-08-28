# Agente de impressão — NTB Vendas

Programa pequeno que roda no computador ligado na impressora da loja (rede ou USB) e
imprime automaticamente os pedidos que chegam no sistema, sem precisar de nenhum
navegador aberto.

**Só é necessário se você cadastrou uma impressora "Rede (IP)" ou "USB local" na aba
Impressão do painel.** Se você usa só a impressora padrão do computador do caixa
("Impressora do sistema"), não precisa instalar nada disso — já funciona sozinho.

## Como instalar (uma vez só)

1. Instale o [Node.js](https://nodejs.org) neste computador, se ainda não tiver (baixe a
   versão "LTS").
2. Copie o arquivo `config.example.json` e renomeie a cópia para `config.json`.
3. Abra o `config.json` num editor de texto e troque `storeSlug` pelo slug da loja — é a
   parte final do link do cardápio (ex: se o link é
   `.../c/sertao-vai-virar-mar`, o slug é `sertao-vai-virar-mar`).
4. Abra um terminal (Prompt de Comando / PowerShell no Windows, Terminal no Mac) dentro
   desta pasta e rode:
   ```
   npm install
   ```

## Como usar (toda vez que for abrir a loja)

Dentro desta pasta, rode:
```
npm start
```

Deixe essa janela do terminal aberta — é ela que fica escutando a fila de impressão.
Fechar a janela para o agente (a impressão automática das impressoras de rede/USB para
de funcionar; a impressora padrão do sistema, se tiver, continua normal).

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
