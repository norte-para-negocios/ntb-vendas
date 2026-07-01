import Link from 'next/link';
import {
  LayoutDashboard,
  Store,
  UtensilsCrossed,
  QrCode,
  ChefHat,
  LayoutGrid,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';
import { stagger } from '@/components/Skeleton';

const FEATURES = [
  {
    icon: QrCode,
    accent: 'var(--brand)',
    title: 'Cardápio por QR Code',
    description:
      'O cliente escaneia, escolhe os itens e envia o pedido direto do celular — sem app para baixar, sem esperar garçom para anotar.',
  },
  {
    icon: ChefHat,
    accent: 'var(--info)',
    title: 'Cozinha e bar em tempo real',
    description:
      'Cada pedido cai automaticamente na tela certa (Cozinha ou Bar), com status de preparo atualizado ao vivo, sem papel circulando na cozinha.',
  },
  {
    icon: LayoutGrid,
    accent: 'var(--warn)',
    title: 'Controle de mesas',
    description:
      'Veja quais mesas estão livres, ocupadas ou com conta pedida, bloqueie mesas em manutenção e proteja a abertura com PIN quando precisar.',
  },
  {
    icon: Wallet,
    accent: 'var(--ok)',
    title: 'Pagamento e divisão de conta',
    description:
      'Feche a comanda com múltiplas formas de pagamento e divida o valor entre as pessoas da mesa em poucos toques.',
  },
];

function WaveDivider({ from, to, flip = false }: { from: string; to: string; flip?: boolean }) {
  return (
    <div className="relative h-14 md:h-20 overflow-hidden" style={{ background: from }}>
      <svg
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        style={flip ? { transform: 'scaleY(-1)' } : undefined}
      >
        <path
          d="M0,32 C240,90 480,10 720,46 C960,82 1200,24 1440,58 L1440,120 L0,120 Z"
          fill={to}
        />
      </svg>
    </div>
  );
}

function SectionBadge({ children, tone = 'dark' }: { children: React.ReactNode; tone?: 'dark' | 'light' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider rounded-full px-3 py-1 mb-4 ${
        tone === 'dark'
          ? 'bg-white/10 border border-white/15 text-white'
          : 'bg-[var(--brand)]/10 border border-[var(--brand)]/20 text-[var(--brand)]'
      }`}
    >
      {children}
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="bg-[var(--ink)] text-white">
      {/* Nav */}
      <header className="sticky top-0 z-30 bg-[var(--ink)]/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-[var(--brand)] w-8 h-8 rounded-lg flex items-center justify-center">
              <UtensilsCrossed size={16} />
            </div>
            <span className="font-semibold">Cardápio Digital</span>
          </div>
          <nav className="flex items-center gap-1">
            <Link href="/loja" className="u-motion u-press-sm hidden sm:inline-flex px-3 py-2 text-sm text-white/70 hover:text-white rounded-lg hover:bg-white/10">
              Área do Lojista
            </Link>
            <Link href="/painel" className="u-motion u-press-sm px-3 py-2 text-sm font-medium bg-white/10 hover:bg-white/15 rounded-lg">
              Painel Master
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="auth-shell relative overflow-hidden">
        <div className="auth-mesh" />
        <div className="auth-orb" style={{ width: 380, height: 380, top: '-10%', left: '-8%', background: 'var(--brand)' }} />
        <div className="auth-orb" style={{ width: 320, height: 320, top: '20%', right: '-10%', background: 'var(--err)', animationDelay: '-6s' }} />
        <div className="auth-grain" />

        <div className="relative z-[1] max-w-6xl mx-auto px-6 pt-16 pb-24 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span
              className="u-stagger inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider bg-white/10 border border-white/15 rounded-full px-3 py-1 mb-6"
              style={stagger(0)}
            >
              Norte Para Negócios
            </span>
            <h1 className="u-stagger text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] mb-5" style={stagger(50)}>
              Damos o norte certo para o cardápio do seu restaurante
            </h1>
            <p className="u-stagger text-lg text-white/70 leading-relaxed mb-8 max-w-md" style={stagger(100)}>
              Pedidos, cozinha, mesas e pagamento em um só sistema. Sem papel, sem retrabalho, sem cliente esperando garçom.
            </p>
            <div className="u-stagger flex flex-col sm:flex-row gap-3" style={stagger(150)}>
              <Link
                href="/c/bistro"
                className="u-motion u-press group bg-[var(--err)] hover:bg-[var(--err)]/90 px-6 py-3.5 rounded-full font-bold shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                Ver cardápio de demonstração
                <ArrowRight size={18} className="u-motion group-hover:translate-x-1" />
              </Link>
              <Link
                href="/loja"
                className="u-motion u-press bg-white/10 border border-white/20 px-6 py-3.5 rounded-full font-bold hover:bg-white/15 flex items-center justify-center gap-2"
              >
                <Store size={18} />
                Sou lojista, quero entrar
              </Link>
            </div>
          </div>

          {/* Mockup */}
          <div className="u-stagger relative hidden md:block" style={stagger(200)}>
            <div
              className="relative bg-[var(--surface)] text-[var(--text)] rounded-2xl p-4 w-[300px] mx-auto"
              style={{ boxShadow: '0 30px 70px -20px rgba(0,0,0,0.5)', transform: 'rotate(-3deg)' }}
            >
              <div className="flex items-center gap-2 mb-4 px-1">
                <div className="w-8 h-8 rounded-full bg-[var(--brand)]/15 flex items-center justify-center">
                  <Smartphone size={14} className="text-[var(--brand)]" />
                </div>
                <div className="flex-1">
                  <div className="h-2 w-24 rounded-full bg-[var(--text)]/15 mb-1.5" />
                  <div className="h-2 w-16 rounded-full bg-[var(--text)]/10" />
                </div>
              </div>
              {[
                { c: 'var(--brand)' },
                { c: 'var(--info)' },
                { c: 'var(--warn)' },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-t border-[var(--border)]">
                  <div className="w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: row.c, opacity: 0.15 }} />
                  <div className="flex-1">
                    <div className="h-2 w-full max-w-[110px] rounded-full bg-[var(--text)]/15 mb-1.5" />
                    <div className="h-2 w-14 rounded-full bg-[var(--text)]/10" />
                  </div>
                  <div className="h-2 w-8 rounded-full bg-[var(--brand)]/30" />
                </div>
              ))}
            </div>
            <div
              className="absolute -bottom-4 -left-6 bg-[var(--surface)] text-[var(--text)] rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-[13px] font-semibold"
              style={{ boxShadow: '0 16px 34px -12px rgba(0,0,0,0.45)', transform: 'rotate(2deg)' }}
            >
              <CheckCircle2 size={16} className="text-[var(--ok)]" />
              Pedido enviado à cozinha
            </div>
          </div>
        </div>
      </section>

      <WaveDivider from="var(--ink)" to="var(--surface)" />

      {/* Features — fundo claro, mesmo ritmo do site institucional */}
      <section className="bg-[var(--surface)] text-[var(--text)]">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <div className="max-w-lg mb-16 text-center mx-auto">
            <SectionBadge tone="light">Funcionalidades</SectionBadge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Tudo que o salão, a cozinha e o caixa precisam</h2>
            <p className="text-[var(--text-muted)] leading-relaxed">Um sistema só, do QR Code na mesa até o fechamento da conta.</p>
          </div>

          <div className="space-y-16 md:space-y-24">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              const reversed = i % 2 === 1;
              return (
                <div key={feature.title} className={`grid md:grid-cols-2 gap-8 md:gap-16 items-center ${reversed ? 'md:[direction:rtl]' : ''}`}>
                  <div style={{ direction: 'ltr' }}>
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                      style={{ backgroundColor: `color-mix(in srgb, ${feature.accent} 16%, transparent)`, color: feature.accent }}
                    >
                      <Icon size={22} />
                    </div>
                    <h3 className="text-2xl font-bold mb-3">{feature.title}</h3>
                    <p className="text-[var(--text-muted)] leading-relaxed max-w-md">{feature.description}</p>
                  </div>
                  <div style={{ direction: 'ltr' }}>
                    <div
                      className="rounded-2xl border border-[var(--border)] aspect-[4/3] flex items-center justify-center"
                      style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${feature.accent} 12%, transparent), transparent)` }}
                    >
                      <Icon size={72} strokeWidth={1} style={{ color: feature.accent, opacity: 0.6 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <WaveDivider from="var(--surface)" to="var(--ink)" />

      {/* CTA banner */}
      <section className="bg-[var(--ink)]">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <SectionBadge>Comece agora</SectionBadge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Pronto para digitalizar o atendimento?</h2>
          <p className="text-white/60 mb-8 max-w-md mx-auto">
            Acesse o painel do seu estabelecimento ou explore o cardápio de demonstração.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/loja"
              className="u-motion u-press bg-[var(--err)] hover:bg-[var(--err)]/90 px-6 py-3.5 rounded-full font-bold shadow-lg flex items-center justify-center gap-2"
            >
              <LayoutDashboard size={18} />
              Acessar Área do Lojista
            </Link>
            <Link
              href="/c/bistro"
              className="u-motion u-press bg-white/10 border border-white/20 hover:bg-white/15 px-6 py-3.5 rounded-full font-bold flex items-center justify-center gap-2"
            >
              Ver Cardápio Demo
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm text-white/50">
            <UtensilsCrossed size={16} />
            Cardápio Digital — Norte Para Negócios
          </div>
          <div className="flex items-center gap-5 text-sm text-white/50">
            <Link href="/painel" className="u-motion hover:text-white">Painel Master</Link>
            <Link href="/loja" className="u-motion hover:text-white">Área do Lojista</Link>
            <Link href="/c/bistro" className="u-motion hover:text-white">Cardápio Demo</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
