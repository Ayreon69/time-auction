// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars, tubes Nixie, jetons et le décor du laboratoire.
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clock } from '../../../shared/protocol';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Le titre gravé sur une plaque de laiton, avec un petit tube allumé en guise de point. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Time Auction">
      <span className="logo-word" aria-hidden>
        Time
      </span>
      <span className="logo-lamp" aria-hidden />
      <span className="logo-word" aria-hidden>
        Auction
      </span>
    </div>
  );
}

/** Le décor : la bakélite sombre de l'appareil, son grain, et sur l'accueil les vis de laiton aux quatre coins. */
export function Backdrop({ children, className, quiet = false }: { children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <div className={cls('backdrop', quiet && 'is-quiet', className)}>
      <div className="chassis" aria-hidden>
        {!quiet && (
          <>
            <span className="screw is-tl" />
            <span className="screw is-tr" />
            <span className="screw is-bl" />
            <span className="screw is-br" />
          </>
        )}
      </div>
      <div className="backdrop-body">{children}</div>
    </div>
  );
}

export function Pill({ tone, children, className }: { tone?: 'gold' | 'ink' | 'soft' | 'red'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * Elle s'ouvre avec un petit mouvement en CSS et se ferme d'un coup.
 */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  chrono: '⏱️',
  sablier: '⌛',
  pendule: '🕰️',
  cloche: '🔔',
  ampoule: '💡',
  lunette: '🔭',
  aimant: '🧲',
  engrenage: '⚙️',
  chapeau: '🎩',
  diamant: '💎',
  hibou: '🦉',
  tortue: '🐢',
};

export const AVATAR_LABELS: Record<string, string> = {
  chrono: 'Chronomètre',
  sablier: 'Sablier',
  pendule: 'Pendule',
  cloche: 'Cloche',
  ampoule: 'Ampoule',
  lunette: 'Lunette',
  aimant: 'Aimant',
  engrenage: 'Engrenage',
  chapeau: 'Chapeau',
  diamant: 'Diamant',
  hibou: 'Hibou',
  tortue: 'Tortue',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '⏱️'}
    </span>
  );
}

/** La couleur de chaque place autour de la table, de 1 à 8 : des verres de voyant, lisibles sur la bakélite. */
export const SEAT_COLORS = ['#ffb347', '#7fd8c9', '#f28fb1', '#a8c8ff', '#c8e27a', '#d6a6ff', '#ffd76a', '#ff8f70'];

export function seatColor(seat: number | null | undefined): string {
  return SEAT_COLORS[((seat ?? 1) - 1) % SEAT_COLORS.length];
}

/** Un tube Nixie : le chiffre allumé, et derrière lui le fantôme des cathodes éteintes. */
function Tube({ ch, dim }: { ch: string; dim?: boolean }) {
  return (
    <span className={cls('tube', dim && 'is-dim')}>
      <span className="tube-ghost">8</span>
      <span className="tube-digit">{ch}</span>
    </span>
  );
}

/** Le tableau de l'émission en tubes Nixie : minutes, secondes, dixièmes. */
export function NixieClock({ tenths, dim, size = 'lg', className, label }: { tenths: number; dim?: boolean; size?: 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  const text = clock(tenths);
  return (
    <span className={cls('nixie', `nixie-${size}`, dim && 'is-dim', className)} role="timer" aria-label={label ?? text}>
      <Tube ch={text[0]} dim={dim} />
      <Tube ch={text[1]} dim={dim} />
      <span className="nixie-sep is-colon" aria-hidden />
      <Tube ch={text[3]} dim={dim} />
      <Tube ch={text[4]} dim={dim} />
      <span className="nixie-sep is-dot" aria-hidden />
      <Tube ch={text[6]} dim={dim} />
    </span>
  );
}

/** Un seul chiffre en tube, pour le compte à rebours. */
export function NixieDigit({ ch, className }: { ch: string; className?: string }) {
  return (
    <span className={cls('nixie', 'nixie-solo', className)} aria-hidden>
      <Tube ch={ch} />
    </span>
  );
}

/** Les jetons de victoire d'un joueur : des voyants ambrés, avec leur nombre. */
export function Tokens({ n, className, bump }: { n: number; className?: string; bump?: boolean }) {
  return (
    <span className={cls('tokens', bump && 'is-bump', className)} aria-label={`${n} jeton${n > 1 ? 's' : ''}`}>
      <span className="token-lamp" aria-hidden />
      <b>{n}</b>
    </span>
  );
}
