import type { ReactNode } from 'react';
import { PopupSheet } from './PopupSheet';

export function Modal(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  zIndex?: number;
  variant?: 'overlay' | 'bottom-sheet';
}) {
  const { title, open, onClose, children, zIndex, variant } = props;
  return (
    <PopupSheet open={open} title={title} onClose={onClose} zIndex={zIndex} variant={variant}>
      {children}
    </PopupSheet>
  );
}
