# Conta universal em loja de cliente: decisão pendente (04/10/2026)

## O que se sabe
- A conta universal ("Equipe Norte Para Negócios") entra em qualquer loja e hoje **pode tudo**: caixa, pagamento, cancelamento, configuração (`UNIVERSAL_PERMISSIONS`, `StoreModule.tsx`).
- Na loja do Sertão ela já aparece na trilha de auditoria (1 cancelamento de item em 03/10), ou seja, é usada em produção.
- O Ramon/Joaquim pediram para "começar a pensar" em tirar a conta universal do caixa da equipe. Hoje nada muda porque ela está em uso.

## Opções
| | Como fica | Custo | Risco |
|---|---|---|---|
| **A. Só leitura em loja de cliente** | Universal vê dashboard, relatórios e configurações, mas não abre caixa, não recebe pagamento nem cancela | M (flag por loja + checagem no app e nas RPCs) | Equipe perde o atalho de "quebrar galho" no balcão |
| **B. Ações de caixa com motivo e aprovação** | Universal pode, mas toda ação financeira pede motivo e fica no relatório de exceções com destaque | P/M | Continua podendo; só fica rastreável |
| **C. Como está + auditar** | Nada muda; o relatório de exceções já lista o operador | 0 | Ação financeira feita pela equipe sem dono individual |

## Recomendação
**B agora, A depois** de o Sertão estabilizar: B resolve a rastreabilidade com pouco esforço (reaproveita o relatório de exceções e o motivo obrigatório já feitos), e A fica como flag por loja quando a operação não precisar mais de ajuda da equipe.

## Perguntas ao dono
1. A equipe Norte ainda precisa lançar, receber ou cancelar em produção no Sertão, ou só consultar?
2. Se precisa, tudo bem com motivo obrigatório em cada ação?
3. Quando o Sertão estiver estável, passamos a A?

**Nenhuma mudança de código até a resposta.**
