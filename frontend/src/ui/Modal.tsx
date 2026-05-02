import type { ReactNode } from 'react';
import { PopupSheet } from './PopupSheet';

export function Modal(props: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const { title, open, onClose, children } = props;
  return (
    <PopupSheet open={open} title={title} onClose={onClose}>
      {children}
    </PopupSheet>
  );
}
