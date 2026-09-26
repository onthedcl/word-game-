import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: React.ReactNode;
}

export function Modal({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-full max-w-[min(520px,calc(100vw-32px))] rounded-2xl bg-surface p-5 text-ink shadow-2xl backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="mb-3 text-xl font-extrabold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 text-3xl leading-none text-muted">×</button>
      </div>
      {open && children}
    </dialog>
  );
}
