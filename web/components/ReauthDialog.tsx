import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.ts';
import { errorText } from '../errors.ts';
import { useReauthStore } from '../stores/reauthStore.ts';
import { Button, ErrorText, TextField } from './ui.tsx';

// Opens when a sensitive admin change needs the password typed again (valid 10 minutes)
export function ReauthDialog() {
  const { t } = useTranslation();
  const open = useReauthStore((s) => s.pending !== null);
  const settle = useReauthStore((s) => s.settle);
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');

  const confirm = useMutation({
    mutationFn: () => api.post('/auth/confirm', { password }),
    onSuccess: () => close(true),
  });

  function close(confirmed: boolean) {
    setPassword('');
    confirm.reset();
    settle(confirmed);
  }

  useEffect(() => {
    const el = dialog.current;
    if (open && !el?.open) el?.showModal();
    if (!open && el?.open) el.close();
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    confirm.mutate();
  }

  return (
    <dialog
      ref={dialog}
      // Escape key
      onCancel={() => close(false)}
      className="m-auto w-full max-w-sm rounded-lg border border-border bg-bg1 p-6 text-text backdrop:bg-black/60"
    >
      <form onSubmit={submit}>
        <h2 className="mb-2 text-base font-semibold">{t('reauth.title')}</h2>
        <p className="mb-4 text-sm text-muted">{t('reauth.intro')}</p>
        <ErrorText>{confirm.error && errorText(t, confirm.error)}</ErrorText>
        {open && (
          <TextField
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={confirm.isPending}>
            {t('reauth.submit')}
          </Button>
          <Button variant="secondary" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
