import { useTranslation } from 'react-i18next';
import { type ToastKind, useNotificationStore } from '../stores/notificationStore.ts';

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-ok/50',
  error: 'border-danger/60',
  info: 'border-border',
};

export function Toasts() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useNotificationStore();
  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-md border bg-bg2 px-4 py-3 text-sm shadow-lg ${KIND_CLASS[toast.kind]}`}
        >
          <p className="flex-1">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="text-muted hover:text-text"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
