import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal into document.body. Inside the page an ancestor with a transform/filter (e.g. the
 * .fade-in view wrapper) makes `position: fixed` relative to that ancestor instead of the viewport,
 * so on phones the modal would sit somewhere down the page instead of on screen.
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
}
