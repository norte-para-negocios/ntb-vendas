'use client';

import React from 'react';
import { Loader2, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SPRING_TAP, SPRING_SHEET } from '@/lib/motion';

export const Button: React.FC<
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> & {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
  }
> = ({ className = '', variant = 'primary', size = 'md', isLoading, children, ...props }) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-[var(--r-md)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none';

  const sizes = {
    sm: 'px-3 py-1.5 text-[13px] gap-1.5',
    md: 'px-4 py-2 text-[14px] gap-2',
    lg: 'px-5 py-2.5 text-[15px] gap-2',
  };

  const variants = {
    primary:
      'bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white focus-visible:ring-[var(--brand)] shadow-sm',
    secondary:
      'bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] focus-visible:ring-[var(--brand)]',
    outline:
      'border border-[var(--border)] hover:border-[var(--brand)] text-[var(--text)] hover:text-[var(--brand)] focus-visible:ring-[var(--brand)]',
    danger:
      'bg-[var(--err)] hover:opacity-90 text-white focus-visible:ring-[var(--err)]',
    ghost:
      'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:ring-[var(--brand)]',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.015 }}
      transition={SPRING_TAP}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
};

export const Input: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }
> = ({ label, error, className = '', id, ...props }) => {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-[var(--text-muted)]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full rounded-[var(--r-md)] border bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition-all ${
          error ? 'border-[var(--err)]' : 'border-[var(--border)]'
        } ${className}`}
        {...props}
      />
      {error && <span className="text-[12px] text-[var(--err)]">{error}</span>}
    </div>
  );
};

export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  accentColor?: string;
  style?: React.CSSProperties;
}> = ({ children, className = '', onClick, hoverable, accentColor, style }) => {
  const interactive = Boolean(onClick || hoverable);
  return (
    <motion.div
      onClick={onClick}
      {...(interactive
        ? { whileHover: { y: -2, boxShadow: 'var(--shadow-md)' }, whileTap: { scale: 0.99 }, transition: SPRING_TAP }
        : {})}
      className={`relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] ${
        interactive ? 'cursor-pointer' : ''
      } ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)', ...style }}
    >
      {accentColor && (
        <div className="absolute inset-y-0 left-0 w-1 rounded-l-[var(--r-lg)]" style={{ backgroundColor: accentColor }} />
      )}
      {children}
    </motion.div>
  );
};

// Acordeão reutilizável (2026-08-16) — generaliza o padrão já validado no
// cardápio do cliente (acordeão de categoria, ClientModule.tsx) pra
// qualquer seção do lojista/admin que hoje é sempre visível e devia ficar
// recolhida por padrão. Ver docs/superpowers/specs/2026-08-16-lojista-
// admin-material-motion-apple.md.
export const Collapsible: React.FC<{
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, badge, children }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        whileTap={{ scale: 0.99 }}
        transition={SPRING_TAP}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--surface-2)]"
      >
        <span className="flex items-center gap-2 font-bold text-[var(--text)]">
          {title}
          {badge}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING_SHEET} className="text-[var(--text-muted)] flex-shrink-0">
          <ChevronDown size={18} />
        </motion.span>
      </motion.button>
      <motion.div initial={false} animate={{ height: open ? 'auto' : 0 }} transition={SPRING_SHEET} style={{ overflow: 'hidden' }}>
        <div inert={!open || undefined} className="px-5 pb-5 pt-1 border-t border-[var(--border)]">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  // 'sheet' (opt-in, 2026-08-16): vidro + spring + arrastar pra fechar no
  // mobile, igual ao BottomSheet do cardápio do cliente. Default 'center'
  // (2026-08-16): também usa spring de verdade (SPRING_SHEET, fade+scale
  // via Motion) pra todo consumidor existente (admin/lojista), não é mais
  // CSS fadeIn/slideUp — mesma linguagem de spring do resto do app.
  variant?: 'center' | 'sheet';
  // 'opaque' (2026-08-21, revisão final do cardápio): opt-out do vidro pra
  // essa sheet específica — usa os tokens normais (--surface/--surface-2/
  // --text) em vez de forçar os valores escuros do .on-glass. Default
  // 'glass' preserva o visual de todo consumidor existente (CartModal,
  // OrderStatusModal, BillSplitter) — só o ProductModal passa 'opaque'.
  surface?: 'glass' | 'opaque';
  // Esconde visualmente o <h3> da barra de título sem tirá-lo do DOM (o
  // dialog continua com aria-labelledby apontando pra ele) — usado só pelo
  // ProductModal, que já mostra o nome do produto no próprio conteúdo
  // (<h2>) e não quer o nome duplicado na chrome bar.
  hideTitle?: boolean;
  // 'size' (opt-in, Task 2 2026-08-22): 'lg' mira ~75-80% da largura da
  // viewport no desktop (usado só pelos modais de pedido/pagamento do
  // painel do lojista em StoreModule.tsx — mesa, item de comanda, receber
  // pagamento), com teto de 1100px pra não virar uma faixa esticada num
  // monitor de 27", e degrada pra largura cheia (só a margem do scrim) em
  // telas pequenas — abaixo do breakpoint `sm` não há nenhum max-width
  // aplicado, então o painel se comporta exatamente como no celular hoje.
  // Default 'sm' preserva byte a byte o `max-w-md` (448px) que já é o
  // comportamento de TODO consumidor existente — em especial o cardápio do
  // cliente (CartModal/ProductModal/BillSplitter em ClientModule.tsx), que
  // não pode mudar 1px (revisão visual concluída essa semana).
  size?: 'sm' | 'lg';
}> = ({ isOpen, onClose, title, children, width, variant = 'center', surface = 'glass', hideTitle = false, size = 'sm' }) => {
  // `width` continua aceito como override explícito (compat, nenhum call
  // site usa hoje); na ausência dele, `size` decide a largura.
  const resolvedWidth = width ?? (size === 'lg' ? 'sm:max-w-[92vw] lg:max-w-[85vw] xl:max-w-[1100px]' : 'max-w-md');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  // Achado real da Task 7 (QA ao vivo com mouse, não só revisão de
  // código): com dragElastic.top pequeno, a sheet mal se move ao ser
  // arrastada pra cima, mas o CURSOR do mouse continua andando a
  // distância cheia — ele "sai" da sheet e passa a estar sobre o scrim
  // (que tem onClick={onClose}). Ao soltar o botão ali, o clique nativo
  // do browser (disparado logo depois do mouseup) aterrissa no scrim e
  // fecha a folha sem o usuário ter arrastado pra baixo o suficiente (nem
  // rápido o suficiente) pra isso ser intencional. Em touch isso não
  // acontece (o pointerup é capturado pelo elemento original, não "vaza"
  // pro scrim) — confirmado testando os dois com Playwright (mouse vs.
  // touch simulado via CDP).
  //
  // Achado decisivo ao instrumentar com console.log: o `click` nativo
  // dispara ANTES do `onDragEnd` do Framer Motion rodar (não depois, como
  // seria intuitivo) — marcar a flag dentro de `onDragEnd` sempre chega
  // tarde demais, o `onClick` do scrim já leu o valor antigo. A flag
  // precisa ser marcada em `onDragStart` (dispara assim que o gesto é
  // reconhecido como arrasto, bem antes do soltar/click) e só é limpa
  // depois, em `onDragEnd`, com um pequeno atraso.
  const justDraggedRef = React.useRef(false);

  // Foco inicial + focus trap (Tab/Shift+Tab) + fechar com Esc enquanto o
  // modal estiver aberto. Ver Task I2 da varredura de 2026-07-02.
  //
  // `onClose` guardado em ref (não entra nas deps do efeito abaixo): o
  // consumidor típico passa `onClose={() => setX(false)}` inline, uma
  // função NOVA a cada render do componente pai. Qualquer digitação num
  // campo controlado dentro do modal (onChange -> setState -> re-render do
  // pai) trocava essa referência, o que reexecutava o efeito inteiro e
  // chamava `focusable[0].focus()` de novo NO MEIO da digitação — como o X
  // de fechar é o primeiro elemento focável no DOM (vem antes do form no
  // JSX), o foco pulava do campo de texto pro botão de fechar a cada
  // tecla. Achado real reportado pelo usuário (2026-08-16, modal "Nova
  // Loja" do Master Admin) — bug existia desde a Task I2, nunca detectado
  // porque testes anteriores não digitaram em campo controlado com o
  // devtools de performance ligado.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!isOpen) return;

    const container = containerRef.current;
    const getFocusable = (): HTMLElement[] =>
      container
        ? Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
            (el) => el.offsetParent !== null
          )
        : [];

    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const items = getFocusable();
        if (items.length === 0) {
          e.preventDefault();
          container?.focus();
          return;
        }

        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !container?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !container?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (variant === 'sheet') {
    // AnimatePresence precisa ficar montado incondicionalmente pra poder
    // rodar a animação de saída — só o conteúdo interno é gated por isOpen.
    // Se isOpen (ou o componente inteiro) desmontasse a árvore junto com o
    // AnimatePresence, a transição de exit nunca teria chance de rodar (o
    // desmonte é síncrono). Ver Task 3 (BottomSheet) em ClientModule.tsx,
    // que já segue esse mesmo formato.
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            style={{ background: 'rgba(10,13,19,0.6)' }}
            onClick={() => { if (!justDraggedRef.current) onClose(); }}
          >
            <motion.div
              key="sheet"
              ref={containerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SPRING_SHEET}
              drag="y"
              // Só `top: 0` (achado I1 da revisão final de 2026-08-16, mesma
              // mudança do BottomSheet em ClientModule.tsx — manter os dois em
              // sincronia): sem `bottom` no objeto de constraints, arrastar pra
              // baixo (fechar) fica sem limite/1:1 com o dedo, sem nenhum
              // `dragElastic` se aplicando a esse eixo; `top: 0.05` continua
              // quase rígido ao arrastar pra cima, passando do topo.
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.5 }}
              // Mesmos limiares do BottomSheet em ClientModule.tsx
              // (DISMISS_VELOCITY=500, DISMISS_OFFSET_RATIO=0.35) — duplicado
              // aqui porque ui.tsx não importa de ClientModule.tsx; se um
              // valor mudar, mudar os dois juntos.
              onDragStart={() => { justDraggedRef.current = true; }}
              onDragEnd={(_e, info) => {
                setTimeout(() => { justDraggedRef.current = false; }, 150);
                if (info.velocity.y > 500 || info.offset.y > window.innerHeight * 0.35) onClose();
              }}
              className={`w-full ${resolvedWidth} rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden max-h-[90vh] flex flex-col ${
                surface === 'opaque' ? 'bg-[var(--surface)]' : 'u-glass-modal on-glass'
              }`}
              style={
                surface === 'opaque'
                  ? { border: '1px solid var(--border)', boxShadow: 'var(--shadow-md), 0 -8px 40px -8px rgba(0,0,0,0.35)' }
                  : { border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.5)' }
              }
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                <div className={`w-10 h-1 rounded-full ${surface === 'opaque' ? 'bg-[var(--border)]' : 'bg-white/20'}`} />
              </div>
              <div
                className={`flex items-center justify-between px-5 py-3 flex-shrink-0 ${
                  surface === 'opaque' ? 'border-b border-[var(--border)]' : 'border-b border-white/10'
                }`}
              >
                {/* hideTitle: some sheets (ProductModal) já mostram o nome no
                    próprio conteúdo (<h2>) e não querem repeti-lo na barra —
                    o <h3> continua no DOM (aria-labelledby do dialog aponta
                    pra ele), só fica visualmente oculto via sr-only. */}
                <h3
                  id={titleId}
                  className={`text-[15px] font-semibold ${hideTitle ? 'sr-only' : ''} ${surface === 'opaque' ? 'text-[var(--text)]' : 'text-white'}`}
                >
                  {title}
                </h3>
                <button
                  onClick={onClose}
                  className={`p-1 rounded-[var(--r-sm)] u-motion ${hideTitle ? 'ml-auto' : ''} ${
                    surface === 'opaque'
                      ? 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 overflow-y-auto">{children}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
        >
          <motion.div
            key="panel"
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING_SHEET}
            className={`w-full ${resolvedWidth} bg-[var(--surface)] rounded-[var(--r-lg)] overflow-hidden`}
            style={{ boxShadow: 'var(--shadow-md), 0 0 0 1px var(--border)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 id={titleId} className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] p-1 rounded-[var(--r-sm)] u-motion"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const Badge: React.FC<{
  children: React.ReactNode;
  color?: string;
  dot?: boolean;
  pulse?: boolean;
}> = ({ children, color, dot, pulse }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
      color || 'bg-[var(--surface-2)] text-[var(--text-muted)]'
    }`}
  >
    {dot && (
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 ${pulse ? 'u-pulse-dot' : ''}`}
      />
    )}
    {children}
  </span>
);
