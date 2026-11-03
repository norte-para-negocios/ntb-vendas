// Junta uma rajada de chamadas numa só: a 1ª chamada abre uma janela de `ms`; tudo que chegar dentro dela
// vira UMA execução no fim da janela (nunca perde a última atualização). Depois da janela, nova chamada abre outra.
export function agrupar(fn: () => void, ms: number): (() => void) & { cancelar: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const chamar = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; fn(); }, ms);
  };
  chamar.cancelar = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return chamar;
}
