import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: ToastKind; message: string };

const TOAST_MS = 5000;
let nextId = 1;

type NotificationState = {
  toasts: Toast[];
  notify: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  notify: (kind, message) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismiss(id), TOAST_MS);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Usable outside React (query error handlers)
export const notify = (kind: ToastKind, message: string) => useNotificationStore.getState().notify(kind, message);
