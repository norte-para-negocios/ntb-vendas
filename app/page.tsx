import Link from 'next/link';
import { LayoutDashboard, Store, UtensilsCrossed } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-dark to-primary p-6 text-white text-center">
      <div className="animate-fade-in flex flex-col items-center w-full max-w-2xl">

        <div className="mb-8">
          <div className="bg-white/10 backdrop-blur-sm border border-white/20 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <UtensilsCrossed className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight">
            Cardápio Digital
          </h1>
          <p className="text-lg md:text-xl opacity-90 max-w-lg leading-relaxed">
            A solução completa para seu restaurante. Pedidos, cozinha e pagamentos em um só lugar.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md mb-16">
          <Link
            href="/painel"
            className="bg-white text-[var(--brand)] px-6 py-4 rounded-xl font-bold hover:bg-[var(--surface-2)] transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center gap-2"
          >
            <LayoutDashboard className="w-5 h-5" />
            Painel Master
          </Link>
          <Link
            href="/loja"
            className="bg-white/10 border-2 border-white/30 backdrop-blur-sm px-6 py-4 rounded-xl font-bold hover:bg-white/20 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex-1 flex items-center justify-center gap-2"
          >
            <Store className="w-5 h-5" />
            Área do Lojista
          </Link>
        </div>

        <div className="pt-8 border-t border-white/10 w-full max-w-sm">
          <p className="text-xs font-mono text-white/60 uppercase tracking-widest mb-3">
            Acesso Rápido (Exemplo Cliente)
          </p>
          <Link
            href="/c/bistro"
            className="text-lg font-medium hover:text-[var(--warn)] transition-colors border-b border-white/30 hover:border-[var(--warn)] pb-0.5"
          >
            Acessar Cardápio Demo
          </Link>
        </div>
      </div>
    </div>
  );
}
