import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed, ArrowRight } from 'lucide-react';
import { stagger } from '@/components/Skeleton';

// Cores extraídas direto do CSS de produção do norteparanegocios.com.br (não os
// tokens --brand/--ink/--surface do design system, que mudam com o modo escuro):
// esta tela de boas-vindas é sempre clara e azul, no mesmo tom do site institucional,
// independente do tema escolhido em outra parte do sistema.
const PRIMARY = '#6b71f2';
const PRIMARY_LIGHT = '#6366f1';
const PRIMARY_DARK = '#1e1b4b';

export default function HomePage() {
  return (
    <div className="auth-shell min-h-screen flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#eef0fd] via-[#f7f8fc] to-white text-[#1e1b4b]">
      {/* "Nuvens" grandes e desfocadas, todas no azul real do site institucional */}
      <div className="cloud-blob" style={{ width: 620, height: 620, top: '-18%', left: '-14%', background: PRIMARY, opacity: 0.3, filter: 'blur(120px)' }} />
      <div className="cloud-blob" style={{ width: 560, height: 560, bottom: '-20%', right: '-16%', background: PRIMARY_LIGHT, opacity: 0.28, filter: 'blur(120px)', animationDelay: '-10s' }} />
      <div className="cloud-blob" style={{ width: 380, height: 380, top: '35%', right: '-8%', background: PRIMARY_DARK, opacity: 0.12, filter: 'blur(100px)', animationDelay: '-4s' }} />
      <div className="cloud-blob" style={{ width: 340, height: 340, bottom: '10%', left: '2%', background: PRIMARY, opacity: 0.18, filter: 'blur(100px)', animationDelay: '-16s' }} />

      <div className="relative z-[1] flex flex-col items-center w-full max-w-md">
        <span
          className="u-stagger inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider rounded-full px-3 py-1 mb-6 bg-white/70 backdrop-blur-sm text-[#6b71f2] border border-[#6b71f2]/25 shadow-sm"
          style={stagger(0)}
        >
          Norte Para Negócios
        </span>

        <div
          className="u-stagger w-20 h-20 rounded-3xl flex items-center justify-center mb-6 bg-white/70 backdrop-blur-sm border border-[#6b71f2]/20 shadow-lg"
          style={stagger(50)}
        >
          <UtensilsCrossed className="w-10 h-10 text-[#6b71f2]" />
        </div>

        <h1 className="u-stagger text-4xl md:text-5xl font-bold tracking-tight mb-4" style={stagger(100)}>
          Cardápio Digital
        </h1>
        <p className="u-stagger leading-relaxed mb-10 max-w-sm text-[#4b5065]" style={stagger(150)}>
          Pedidos, cozinha, mesas e pagamento em um só sistema.
        </p>

        <div className="u-stagger flex flex-col sm:flex-row gap-3 w-full mb-10" style={stagger(200)}>
          <Link
            href="/painel"
            className="u-motion u-press px-6 py-3.5 rounded-full font-bold shadow-lg hover:shadow-xl flex-1 flex items-center justify-center gap-2 bg-[#6b71f2] hover:bg-[#5a5fe0] text-white"
          >
            <LayoutDashboard size={18} />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="u-motion u-press px-6 py-3.5 rounded-full font-bold flex-1 flex items-center justify-center gap-2 bg-white/80 backdrop-blur-sm hover:bg-white text-[#6b71f2] border border-[#6b71f2]/25 shadow-sm"
          >
            <Store size={18} />
            Área do Lojista
          </Link>
        </div>

        <Link
          href="/c/bistro"
          className="u-stagger u-motion group inline-flex items-center gap-1.5 text-sm font-medium text-[#4b5065] hover:text-[#6b71f2] border-b border-transparent hover:border-[#6b71f2]/60 pb-0.5"
          style={stagger(240)}
        >
          Ver cardápio de demonstração
          <ArrowRight size={14} className="u-motion group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}
