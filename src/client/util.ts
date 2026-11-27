export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]);

/** localStorage that never throws (private mode, blocked storage, ...). */
export const store = {
  get<T>(key: string): T | null {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

/**
 * A modal dialog (#44) over the page, outside #app so the header doesn't copy its buttons. It has a ×
 * in the corner; Escape and the × close it. Returns the dialog element, for wiring its buttons.
 */
export function openDialog(title: string, bodyHtml: string, onClose?: () => void): HTMLDialogElement {
  document.querySelectorAll('dialog.bl-dialog').forEach((d) => d.remove());
  const dlg = document.createElement('dialog');
  dlg.className = 'bl-dialog';
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="dlg-x" data-dialog-close aria-label="Close">×</button></div>
    <div class="dlg-body">${bodyHtml}</div>`;
  document.body.append(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (ev) => { if ((ev.target as Element).closest('[data-dialog-close]')) close(); });
  dlg.showModal();
  return dlg;
}
