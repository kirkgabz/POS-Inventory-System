import Swal, { type SweetAlertIcon } from 'sweetalert2';

/** Base SweetAlert2 instance styled by our own CSS (see styles.css → .sw-*) */
const Base = Swal.mixin({
  buttonsStyling: false,
  reverseButtons: true,
  showClass: { popup: 'sw-in' },
  hideClass: { popup: 'sw-out' },
  customClass: {
    popup: 'sw-popup',
    title: 'sw-title',
    htmlContainer: 'sw-text',
    confirmButton: 'btn btn-primary',
    cancelButton: 'btn btn-ghost',
    denyButton: 'btn btn-danger',
    actions: 'sw-actions',
    icon: 'sw-icon',
    input: 'input',
    validationMessage: 'sw-validation',
  },
});

interface ConfirmOptions {
  title: string;
  text?: string;
  html?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  icon?: SweetAlertIcon;
}

/** "Are you sure?" card. Resolves true only when the user confirms. */
export async function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  const res = await Base.fire({
    title: opts.title,
    text: opts.html ? undefined : opts.text,
    html: opts.html,
    icon: opts.icon ?? (opts.danger ? 'warning' : 'question'),
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'Yes, continue',
    cancelButtonText: opts.cancelText ?? 'Cancel',
    focusCancel: !!opts.danger,
    customClass: {
      popup: 'sw-popup',
      title: 'sw-title',
      htmlContainer: 'sw-text',
      confirmButton: opts.danger ? 'btn btn-danger' : 'btn btn-primary',
      cancelButton: 'btn btn-ghost',
      actions: 'sw-actions',
      icon: 'sw-icon',
    },
  });
  return res.isConfirmed;
}

/** Big centered "Saved!" / "Done!" card that closes itself. */
export function success(title: string, text?: string, timer = 1700) {
  return Base.fire({ icon: 'success', title, text, timer, showConfirmButton: false, timerProgressBar: true });
}

export function failure(title: string, text?: string) {
  return Base.fire({ icon: 'error', title, text, confirmButtonText: 'Okay' });
}

export function info(title: string, html?: string) {
  return Base.fire({ icon: 'info', title, html, confirmButtonText: 'Got it' });
}

/** Small corner toast for quick, low-stakes feedback (e.g. item added to cart). */
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 1800,
  timerProgressBar: true,
  customClass: { popup: 'sw-toast' },
});

export const toast = (title: string, icon: SweetAlertIcon = 'success') => Toast.fire({ icon, title });

/** Loading card while awaiting a request. Call Swal.close() or another alert after. */
export function loading(title = 'Working…') {
  Base.fire({ title, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
}

export { Swal };

/** Three-way choice card. Resolves 'confirm' | 'deny' | 'cancel'. */
export async function choose(opts: {
  title: string;
  html?: string;
  icon?: SweetAlertIcon;
  confirmText: string;
  denyText?: string;
  cancelText?: string;
}): Promise<'confirm' | 'deny' | 'cancel'> {
  const res = await Base.fire({
    title: opts.title,
    html: opts.html,
    icon: opts.icon ?? 'question',
    showDenyButton: !!opts.denyText,
    showCancelButton: true,
    confirmButtonText: opts.confirmText,
    denyButtonText: opts.denyText,
    cancelButtonText: opts.cancelText ?? 'Cancel',
    reverseButtons: false,
    customClass: {
      popup: 'sw-popup',
      title: 'sw-title',
      htmlContainer: 'sw-text',
      confirmButton: 'btn btn-primary',
      denyButton: 'btn btn-ghost',
      cancelButton: 'btn btn-ghost',
      actions: 'sw-actions sw-actions-col',
      icon: 'sw-icon',
    },
  });
  return res.isConfirmed ? 'confirm' : res.isDenied ? 'deny' : 'cancel';
}

/** Ask for a single value (email, new password…). Resolves null when cancelled. */
export async function promptValue(opts: {
  title: string;
  text?: string;
  input: 'email' | 'password' | 'text';
  value?: string;
  placeholder?: string;
  confirmText: string;
  validate?: (v: string) => string | null;
}): Promise<string | null> {
  const res = await Base.fire({
    title: opts.title,
    text: opts.text,
    input: opts.input,
    inputValue: opts.value ?? '',
    inputPlaceholder: opts.placeholder,
    showCancelButton: true,
    confirmButtonText: opts.confirmText,
    cancelButtonText: 'Cancel',
    inputValidator: (v: string) => (opts.validate ? opts.validate(v) : !v ? 'Please fill this in.' : null),
  });
  return res.isConfirmed ? String(res.value) : null;
}
