import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

// Cores fixas (não os tokens --brand/--ink/--surface, que mudam com o modo escuro):
// esta tela de boas-vindas é sempre clara e azul, independente do tema escolhido
// em outra parte do sistema.
const BRAND = '#484DB5';

export default function HomePage() {
  return (
    <div className="auth-shell min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#f7f8fa] text-[#1E1B4B]">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 70% 50% at 15% -10%, color-mix(in srgb, ${BRAND} 12%, transparent), transparent 60%),
                       radial-gradient(ellipse 55% 45% at 105% 110%, color-mix(in srgb, ${BRAND} 10%, transparent), transparent 60%)`,
        }}
      />
      <div className="auth-orb" style={{ width: 380, height: 380, top: '-10%', left: '-8%', background: BRAND, opacity: 0.12 }} />
      <div className="auth-orb" style={{ width: 320, height: 320, bottom: '-12%', right: '-10%', background: BRAND, opacity: 0.1, animationDelay: '-6s' }} />

      <div className="relative z-[1] flex flex-col items-center w-full max-w-md">
        <span
          className="u-stagger inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider rounded-full px-3 py-1 mb-6 bg-[#EEF0FC] text-[#484DB5] border border-[#484DB5]/25"
          style={stagger(0)}
        >
          Norte Para Negócios
        </span>

        <div
          className="u-stagger w-20 h-20 rounded-3xl flex items-center justify-center mb-6 bg-[#EEF0FC] border border-[#484DB5]/20"
          style={stagger(50)}
        >
          <UtensilsCrossed className="w-10 h-10 text-[#484DB5]" />
        </div>

        <h1 className="u-stagger text-4xl md:text-5xl font-bold tracking-tight mb-4" style={stagger(100)}>
          Cardápio Digital
        </h1>
        <p className="u-stagger leading-relaxed mb-10 max-w-sm text-[#64748b]" style={stagger(150)}>
          Pedidos, cozinha, mesas e pagamento em um só sistema.
        </p>

        <div className="u-stagger flex flex-col sm:flex-row gap-3 w-full mb-10" style={stagger(200)}>
          <Link
            href="/painel"
            className="u-motion u-press px-6 py-3.5 rounded-full font-bold shadow-lg hover:shadow-xl flex-1 flex items-center justify-center gap-2 bg-[#484DB5] hover:bg-[#3A3E91] text-white"
          >
            <LayoutDashboard size={18} />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="u-motion u-press px-6 py-3.5 rounded-full font-bold flex-1 flex items-center justify-center gap-2 bg-[#EEF0FC] hover:bg-[#e2e6f9] text-[#484DB5] border border-[#484DB5]/20"
          >
            <Store size={18} />
            Área do Lojista
          </Link>
        </div>

        <Link
          href="/c/bistro"
          className="u-stagger u-motion group inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b] hover:text-[#484DB5] border-b border-transparent hover:border-[#484DB5]/60 pb-0.5"
          style={stagger(240)}
        >
          Ver cardápio de demonstração
          <ArrowRight size={14} className="u-motion group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}
