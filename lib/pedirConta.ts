// "Pedir conta" do garçom (21/10/2026, ODARA: "toda vez que ela lança, sai a pré-conta mesmo sem ela pedir"). A auditoria
// mostrou a tela de Mesas pondo a mesa em "Pediu conta" 5 a 12 s depois de cada pedido: o botão grande "Pedir conta"
// aparece logo abaixo de onde estava o "Confirmar pedido", sem perguntar nada, e já manda a comanda para a impressora.
// Agora ele pede confirmação, e o toque que chega logo depois de o cardápio fechar não conta.

export const TRAVA_TOQUE_MS = 900;

/** false enquanto o cardápio da mesa acabou de fechar (o toque do "Confirmar" atravessa para a janela da mesa). */
export function podePedirConta(agoraMs: number, cardapioFechouEmMs: number | null, travaMs: number = TRAVA_TOQUE_MS): boolean {
  if (cardapioFechouEmMs == null) return true;
  return agoraMs - cardapioFechouEmMs >= travaMs;
}

export function textoConfirmarConta(mesa: number | string, saiComanda: boolean): { title: string; message: string; confirmLabel: string } {
  return {
    title: `Pedir a conta da mesa ${mesa}?`,
    message: 'A mesa fica como Pediu conta e só o caixa consegue reabrir.' + (saiComanda ? ' A comanda sai na impressora.' : ''),
    confirmLabel: 'Pedir conta',
  };
}
