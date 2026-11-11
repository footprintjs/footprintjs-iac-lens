import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function DetailsPanel({ title, onClose, children }: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="lens-details" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2 id={heading}>{title}</h2>
      <button className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="close" size={20}/></button>
    </header>
    <div className="lens-details-body">{children}</div>
  </dialog>;
}
