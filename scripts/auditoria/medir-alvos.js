// Cole no console do navegador (ou em Eval do Chrome remoto) na tela aberta, com a janela na largura do celular.
// Lista elementos tocáveis visíveis com menos de 44 px de largura ou altura.
(() => {
  const sel = 'button, a[href], [role="button"], [role="tab"], select, input[type="checkbox"], input[type="radio"], summary';
  const pequenos = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
    return r.width < 44 || r.height < 44;
  }).map((el) => {
    const r = el.getBoundingClientRect();
    return { texto: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.table(pequenos);
  return `${pequenos.length} alvo(s) abaixo de 44px`;
})();
