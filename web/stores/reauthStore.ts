import { create } from 'zustand';

// The API answered REAUTH_REQUIRED: the dialog asks the password, then the call is sent again
type ReauthState = {
  pending: ((confirmed: boolean) => void) | null;
  ask: () => Promise<boolean>;
  settle: (confirmed: boolean) => void;
};

export const useReauthStore = create<ReauthState>((set, get) => ({
  pending: null,
  ask: () =>
    new Promise((resolve) => {
      // A second request while the dialog is open replaces the first, which gives up
      get().pending?.(false);
      set({ pending: resolve });
    }),
  settle: (confirmed) => {
    get().pending?.(confirmed);
    set({ pending: null });
  },
}));
