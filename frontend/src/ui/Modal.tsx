import type { ReactNode } from 'react';
import { PopupSheet } from './PopupSheet';

export function Modal(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  zIndex?: number;
  variant?: 'overlay' | 'bottom-sheet';
  insetRightPx?: number;
  nonBlocking?: boolean;
  dismissible?: boolean;
}) {
  const { title, open, onClose, children, zIndex, variant, insetRightPx, nonBlocking, dismissible } = props;
  return (
    <PopupSheet
      open={open}
      title={title}
      onClose={onClose}
      zIndex={zIndex}
      variant={variant}
      insetRightPx={insetRightPx}
      nonBlocking={nonBlocking}
      dismissible={dismissible}
    >
      {children}
    </PopupSheet>
  );
}
