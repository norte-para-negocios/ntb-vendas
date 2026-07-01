'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

// Paleta e formas extraídas direto do site de produção norteparanegocios.com.br
// (cores fixas em hex, não os tokens --brand/--ink/--surface do design system,
// que mudam com o modo escuro — esta tela é sempre nesse azul, antes de qualquer login).
const BG = '#484DB5';
const BG_SHAPE = '#3A40B2';
const PRIMARY = '#6b71f2';
const HIGHLIGHT = '#c7d2fe';
const ACCENT = '#F43F5E';

export default function HomePage() {
  const cloudBackRef = useRef<HTMLDivElement>(null);
  const cloudFrontRef = useRef<HTMLDivElement>(null);

  // Paralaxe suave das nuvens seguindo o mouse — mesma ideia do hero do site institucional.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      if (cloudBackRef.current) cloudBackRef.current.style.transform = `translateX(${x * -14}px)`;
      if (cloudFrontRef.current) cloudFrontRef.current.style.transform = `translateX(${x * -8}px)`;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden p-6 text-center" style={{ background: BG }}>
      {/* Forma decorativa curva, mesmo recurso do fundo do hero institucional */}
      <svg className="absolute bottom-0 right-0 w-[70%] h-auto opacity-80 pointer-events-none" viewBox="0 0 1443 912" fill="none" preserveAspectRatio="xMaxYMax slice">
        <path d="M1443 203.5C1443 203.5 1156.08 94.5 868.5 293.5C580.92 492.5 558.996 755 582.5 911.5H1443V203.5Z" fill={BG_SHAPE} />
      </svg>

      {/* Ícone flutuante, mesma animação (translateY + rotate) do foguete do site institucional */}
      <div
        className="u-stagger absolute hidden md:block pointer-events-none"
        style={{ ...stagger(0), top: '14%', right: '12%', animation: '3s ease-in-out infinite icon-float' }}
      >
        <div className="w-28 h-28 rounded-[2rem] flex items-center justify-center backdrop-blur-sm border border-white/20" style={{ background: 'rgba(255,255,255,0.08)', boxShadow: '0 20px 45px -12px rgba(0,0,0,0.4)' }}>
          <UtensilsCrossed className="w-14 h-14 text-white" />
        </div>
      </div>

      <div className="relative z-[1] flex flex-col items-center w-full max-w-md">
        <span
          className="u-stagger inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider rounded-full px-3 py-1 mb-6 bg-white/10 border border-white/20 text-white"
          style={stagger(0)}
        >
          Norte Para Negócios
        </span>

        <div
          className="u-stagger w-20 h-20 rounded-3xl flex items-center justify-center mb-6 md:hidden bg-white/10 backdrop-blur-sm border border-white/20 shadow-lg"
          style={stagger(50)}
        >
          <UtensilsCrossed className="w-10 h-10 text-white" />
        </div>

        <h1 className="u-stagger text-4xl md:text-5xl font-extrabold tracking-tight mb-4 text-white" style={stagger(100)}>
          Cardápio <span style={{ color: HIGHLIGHT }}>Digital</span>
        </h1>
        <p className="u-stagger leading-relaxed mb-10 max-w-sm text-white/75" style={stagger(150)}>
          Pedidos, cozinha, mesas e pagamento em um só sistema.
        </p>

        <div className="u-stagger flex flex-col sm:flex-row gap-3 w-full mb-10" style={stagger(200)}>
          <Link
            href="/painel"
            className="u-motion u-press px-6 py-3.5 rounded-2xl font-bold shadow-lg hover:shadow-xl flex-1 flex items-center justify-center gap-2 text-white"
            style={{ background: ACCENT }}
          >
            <LayoutDashboard size={18} />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="u-motion u-press px-6 py-3.5 rounded-2xl font-bold flex-1 flex items-center justify-center gap-2 bg-white/10 backdrop-blur-sm hover:bg-white/15 text-white border border-white/20"
          >
            <Store size={18} />
            Área do Lojista
          </Link>
        </div>

        <Link
          href="/c/bistro"
          className="u-stagger u-motion group inline-flex items-center gap-1.5 text-sm font-medium text-white/70 hover:text-white border-b border-transparent hover:border-white/60 pb-0.5"
          style={stagger(240)}
        >
          Ver cardápio de demonstração
          <ArrowRight size={14} className="u-motion group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Nuvens no rodapé, paths reais do site institucional — camada de trás (cinza, translúcida).
          Largura maior que o viewport (com left negativo) dá folga pro parallax sem revelar
          a borda do fundo quando a nuvem desliza com o mouse. */}
      <div ref={cloudBackRef} className="absolute bottom-0 pointer-events-none transition-transform duration-75 ease-linear will-change-transform" style={{ opacity: 0.5, left: '-6%', width: '112%' }}>
        <svg className="w-full h-auto block" viewBox="0 0 1440 349" fill="none" preserveAspectRatio="none">
          <path d="M982.208 174.899C1009.84 136.846 1055.99 117.078 1102.5 128.198C1139.36 137.011 1168.5 163.327 1184.17 197.33C1199.74 190.699 1217.24 188.839 1234.8 193.039C1274.03 202.419 1301.25 239.066 1303.31 280.61C1308.19 280.775 1313.14 281.427 1318.08 282.61C1361.3 292.943 1367.01 276.679 1357.5 323.617C1347.99 370.547 1372.72 339.95 1329.5 329.617C1304.92 329.617 1307.6 324.973 1278.5 319.516C1258.26 345.86 1262.49 337.505 1229.5 329.617C1226.3 328.851 1176.05 312.734 1173.02 311.617C1136.5 336.117 1176.32 346.07 1107.5 329.617C1046.23 314.966 1053.5 352.617 969.5 336.117C964.361 335.909 941.551 335.281 932.5 333.117C913.211 328.505 900.263 348.251 888.344 333.117C870.027 351.39 816.656 335.591 789.5 329.617C781.089 321.473 719.728 320.44 717 319.516C682 350.117 652.839 333.121 591 319.516C535.939 307.402 519.172 370.901 507 319.516C525.699 270.392 455.17 334.144 450.5 333.117C414.878 325.279 409.124 338.261 407.737 303.468C404.194 303.336 400.614 302.893 397.03 302.104C364.726 294.997 344.303 263.065 351.415 230.782C358.526 198.499 390.48 178.091 422.784 185.198C430.376 186.869 437.312 189.914 443.388 194.009C457.957 160.067 495.014 140.141 532.437 148.375C545.996 151.358 557.954 157.682 567.648 166.28C592.481 134.814 633.947 118.469 675.741 127.664C708.862 134.951 735.05 156.712 749.13 184.828C763.125 179.345 778.843 177.808 794.627 181.28C809.528 184.559 822.5 191.864 832.652 201.801C836.647 203.633 840.415 205.861 843.926 208.432C860.139 167.384 901.379 143.286 943.025 153.244C958.114 156.852 971.421 164.501 982.208 174.899Z" fill="#D9D9D9" />
          <path d="M1446.8 75.4224C1446.8 86.1165 1446.8 100.408 1446.8 113.617C1446.8 132.617 1446.8 146.617 1446.8 157.617V197.33V262.117V311.617V343.117H-35V325.413V280.61V6.11767C-14.8175 5.80051 -15.6289 45.7395 -15.6318 45.8804C103.654 -51.5225 212.634 26.131 214.082 94.6812C247.22 71.2146 289.853 90.2858 299.884 117.002C372.112 67.0744 492.074 105.601 494.288 242.543C541.182 197.665 681.789 147.851 668 260.617C704.873 239.139 767.041 242.777 749.13 271.617C785.352 242.566 781.085 330.69 811 293.617C840.428 257.152 835.574 356.747 835 329.617L857.5 333.117C853.568 316.582 864.786 275.065 888.344 302.104C919.803 338.219 929.071 291.616 966.5 319.516C947.38 291.252 986.395 299.204 1024.14 319.516C1005.61 207.257 1124.26 188.556 1173.02 231.94C1169.45 95.0188 1287.71 52.7704 1361.99 100.408C1370.89 73.3966 1412.69 53.0076 1446.8 75.4224Z" fill="#D9D9D9" />
        </svg>
      </div>
      <div ref={cloudFrontRef} className="absolute bottom-0 pointer-events-none transition-transform duration-75 ease-linear will-change-transform" style={{ left: '-4%', width: '108%' }}>
        <svg className="w-full h-auto block" viewBox="0 0 1440 295" fill="none" preserveAspectRatio="none">
          <path d="M1318.86 184.29C1325.2 190.108 1328.94 193.537 1332.89 190.339C1354.96 172.471 1402.57 151.953 1444.48 138.876L1444.48 294.998L-0.999997 294.999L-1 0.00787336C48.5325 -0.634624 115.926 38.0868 96.3205 101.061C203.078 -9.48498 411.597 56.6256 419.26 177.258C446.315 135.936 511.922 146.653 525.29 194.089C536.799 156.329 561.854 170.374 592.114 187.337C615.419 200.4 641.81 215.194 667.479 209.389C683.635 205.736 693.829 203.325 701.266 201.565L701.275 201.563C720.989 196.9 721.32 196.821 761.98 190.339C816.339 181.673 836.778 177.505 877.717 169.157L881.48 168.389C924.98 159.521 936.98 155.047 936.98 155.047L1008.98 168.39C1074.98 184.29 1027.37 173.53 1141.98 177.258C1156.25 176.189 1167.33 171.714 1179.05 166.985C1197.47 159.544 1217.46 151.474 1253.89 155.047C1290.95 158.682 1308.43 174.718 1318.86 184.29Z" fill="white" />
          <path d="M1096.12 133.035C1142.43 143.231 1174.56 183.06 1176.98 228.214L573.832 291.852C531.397 282.51 504.569 240.537 513.911 198.102C523.253 155.668 565.228 128.842 607.663 138.184C617.637 140.38 626.747 144.383 634.729 149.765C653.866 105.15 702.545 78.959 751.705 89.7817C769.516 93.7029 785.224 102.016 797.958 113.318C830.579 71.9581 885.048 50.4725 939.949 62.5592C983.458 72.1378 1017.86 100.741 1036.36 137.698C1054.74 130.491 1075.39 128.47 1096.12 133.035Z" fill="white" />
        </svg>
      </div>
    </div>
  );
}
