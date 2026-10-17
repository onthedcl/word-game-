import { tipUrl } from '../tips';

/** "☕ Buy me a coffee": a plain link, never a popup. Renders nothing without a tip jar. */
export function TipLink({ children = 'Buy me a coffee', className = '' }: { children?: React.ReactNode; className?: string }) {
  if (!tipUrl) return null;
  return (
    <a
      href={tipUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buy me a coffee: support Lettertown on Ko-fi"
      className={`whitespace-nowrap font-semibold text-[#7046b5] underline decoration-[#7046b5]/40 underline-offset-2 dark:text-[#b9a3ee] ${className}`}
    >
      <span aria-hidden>☕ </span>
      {children}
    </a>
  );
}
