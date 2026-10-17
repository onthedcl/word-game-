import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  /** Can't be closed (no ×, Esc or tapping outside), e.g. signing in when it's required. */
  locked?: boolean;
  children: React.ReactNode;
}

export function Modal({ open, title, onClose, locked = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // The browser's close event arrives after we close a dialog ourselves; only react to closes
  // the player started (Esc, back gesture), or it would also close whatever opened next.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => locked && e.preventDefault()}
      onClose={() => {
        // A locked dialog closed anyway (some browsers let Esc through twice): put it back.
        if (locked && openRef.current) ref.current?.showModal();
        else if (openRef.current) onClose();
      }}
      onClick={(e) => !locked && e.target === ref.current && onClose()}
      className="m-auto w-full max-w-[min(520px,calc(100vw-32px))] rounded-2xl bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="mb-3 text-xl font-extrabold">{title}</h2>
        {!locked && <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 text-3xl leading-none text-muted">×</button>}
      </div>
      {open && children}
    </dialog>
  );
}
