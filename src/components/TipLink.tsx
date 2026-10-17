import { tipUrl } from '../tips';

/**
 * "☕ Buy me a coffee": a button (it opens the Ko-fi page in a new tab), never a popup.
 * `small` fits the score bar. Renders nothing without a tip jar.
 */
export function TipLink({ children = 'Buy me a coffee', small = false }: { children?: React.ReactNode; small?: boolean }) {
  if (!tipUrl) return null;
  return (
    <a
      href={tipUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Buy me a coffee: support Lettertown on Ko-fi"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#7046b5] font-bold text-white no-underline shadow-sm transition active:scale-95 hover:bg-[#5e3a9c] dark:bg-[#8b63d6] dark:hover:bg-[#7a52c6] ${
        small ? 'px-2.5 py-0.5 text-xs' : 'px-4 py-2 text-sm'
      }`}
    >
      <span aria-hidden>☕</span>
      {children}
    </a>
  );
}
