import type { ReactNode } from 'react';

/**
 * A menu link's label. In edit mode the link carries `menuRef` (see
 * src/lib/content/navigation.mjs) and the label is marked so it can be edited
 * in place; otherwise it renders the label unchanged.
 */
export default function MenuLabel({ menuRef, children }: { menuRef?: string; children: ReactNode }) {
  return menuRef ? <span data-cms-menu={menuRef}>{children}</span> : <>{children}</>;
}
