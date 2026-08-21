'use client';

import Image from 'next/image';
import { useMemo, type CSSProperties } from 'react';

// Fallback de imagem de produto. Existe porque HOJE nenhum dos 1109
// produtos das 7 lojas tem foto (o catalogo vem do Omie, que nao traz
// imagem) — e o layout do cardapio e' baseado em foto. Um quadrado cinza
// vazio em cada linha faria a tela parecer quebrada; este bloco e' uma
// escolha tipografica deliberada que se sustenta sozinha ate a foto real
// existir, e sai de cena sem nenhuma outra mudanca quando ela chegar.
//
// A cor vem de um hash do nome: o mesmo produto tem sempre o mesmo tom
// (nao pisca entre renders nem entre telas), produtos diferentes se
// distinguem, e a faixa de matiz e' estreita e dessaturada de proposito
// para nunca competir com o conteudo nem virar arco-iris.

const SIZES = {
  row: { box: 'w-[88px] h-[88px] rounded-[10px]', text: 'text-[30px]', px: 88 },
  featured: { box: 'w-full aspect-square rounded-[10px]', text: 'text-[44px]', px: 330 },
  option: { box: 'w-14 h-14 rounded-lg', text: 'text-[20px]', px: 56 },
  hero: { box: 'w-full h-full rounded-none', text: 'text-[72px]', px: 1200 },
  cart: { box: 'w-12 h-12 rounded-md', text: 'text-[18px]', px: 48 },
} as const;

function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  // Clamp pra uma faixa brand-adjacent (azul-violeta, 220-310), como o
  // comentário do arquivo já dizia ser a intenção ("estreita e dessaturada
  // de propósito ... nunca virar arco-íris") — antes disso o `% 360` deixava
  // passar o círculo inteiro, incluindo verde/vermelho/amarelo puros.
  return 220 + (h % 90);
}

function initials(name: string): string {
  const clean = name.trim().replace(/^\d+\s*/, '');
  return (clean[0] || '?').toUpperCase();
}

export function ProductThumb({
  src,
  name,
  size,
  className = '',
}: {
  src?: string | null;
  name: string;
  size: keyof typeof SIZES;
  className?: string;
}) {
  const cfg = SIZES[size];
  const hue = useMemo(() => hueFromName(name), [name]);

  if (src) {
    return (
      <div className={`${cfg.box} relative overflow-hidden flex-shrink-0 ${className}`}>
        <Image src={src} alt={name} fill sizes={`${cfg.px}px`} className="object-cover" />
      </div>
    );
  }

  const hue2 = (hue + 28) % 360;

  return (
    <div
      aria-hidden="true"
      // product-thumb-fallback(-text) (app/globals.css): o gradiente/cor em
      // si tem que mudar de verdade em modo escuro (não só ficar mais
      // escuro por opacidade) — hsl(h 24% 92%) é um pastel bem claro,
      // ilegível/berrante sobre --bg #0d0e12. Como a cor é computada por
      // hue (dinâmico, um hash por produto), não dá pra escrever a versão
      // dark direto numa classe Tailwind fixa: as duas custom properties
      // (--thumb-hue/--thumb-hue-2) carregam o hue calculado, e a troca
      // clara/escura vive no CSS (seletor `.dark`, mesma classe que já
      // governa o resto do tema), não aqui.
      className={`${cfg.box} product-thumb-fallback relative overflow-hidden flex-shrink-0 flex items-center justify-center ${className}`}
      style={{ '--thumb-hue': hue, '--thumb-hue-2': hue2 } as CSSProperties}
    >
      <span
        className={`${cfg.text} product-thumb-fallback-text font-bold leading-none tracking-tight select-none`}
      >
        {initials(name)}
      </span>
    </div>
  );
}
