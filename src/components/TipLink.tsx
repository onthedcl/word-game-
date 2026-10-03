import { tipUrl } from '../tips';

/** "♥ Tip the town": a plain link, never a popup. Renders nothing without a tip jar. */
export function TipLink({ children = 'Tip the town', className = '' }: { children?: React.ReactNode; className?: string }) {
  if (!tipUrl) return null;
  const placeholder = tipUrl.startsWith('#');
  return (
    <a
      href={tipUrl}
      target={placeholder ? undefined : '_blank'}
      rel="noreferrer"
      aria-label="Leave a tip for Lettertown"
      onClick={placeholder ? (e) => { e.preventDefault(); alert('Preview: this opens your tip jar (Ko-fi, Buy Me a Coffee or Stripe) once its link is set.'); } : undefined}
      className={`whitespace-nowrap font-semibold text-[#7046b5] underline decoration-[#7046b5]/40 underline-offset-2 dark:text-[#b9a3ee] ${className}`}
    >
      <span aria-hidden>♥ </span>
      {children}
    </a>
  );
}
