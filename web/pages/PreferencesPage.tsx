import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '../../shared/auth.ts';
import { ApiError, api } from '../api.ts';
import { authStatusQuery, useCurrentUser } from '../auth.ts';
import { squarePicture } from '../avatar.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Button, Card, ErrorText, SelectField, TextField } from '../components/ui.tsx';
import { browserTimeZone, formatDateTime } from '../dates.ts';
import { errorText } from '../errors.ts';
import { LANGUAGES, setLanguage } from '../i18n.ts';
import { notify } from '../stores/notificationStore.ts';

const LANGUAGE_NAMES: Record<(typeof LANGUAGES)[number], string> = { fr: 'Français', en: 'English' };

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function DisplayCard() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [timezone, setTimezone] = useState(user.timezone);
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const now = useNow(1000);

  const save = useMutation({
    mutationFn: () => api.patch<{ user: UserInfo }>('/auth/preferences', { timezone }),
    onSuccess: ({ user: updated }) => {
      queryClient.setQueryData(authStatusQuery.queryKey, (old) => old && { ...old, user: updated });
      notify('success', t('prefs.saved'));
    },
  });

  return (
    <Card title={t('prefs.display')}>
      <SelectField
        label={t('prefs.language')}
        value={i18n.language}
        onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number])}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_NAMES[lang]}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t('prefs.timezone')}
        hint={t('prefs.timezonePreview', { time: formatDateTime(now.toISOString(), timezone, i18n.language) })}
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
      >
        <option value="browser">{t('prefs.timezoneBrowser', { zone: browserTimeZone() })}</option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </SelectField>

      <ErrorText>{save.error && errorText(t, save.error)}</ErrorText>
      <Button onClick={() => save.mutate()} disabled={save.isPending || timezone === user.timezone}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

// Larger files are refused before decoding them
const SOURCE_MAX_BYTES = 10 * 1024 * 1024;

function AvatarCard() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [tooBig, setTooBig] = useState(false);

  const onSaved = ({ avatarAt }: { avatarAt: string | null }) => {
    queryClient.setQueryData(authStatusQuery.queryKey, (old) =>
      old?.user ? { ...old, user: { ...old.user, avatarAt } } : old,
    );
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };
  const upload = useMutation({
    // A 256 px square stays far below the server limit, which checks it again
    mutationFn: async (file: File) =>
      api.post<{ avatarAt: string | null }>('/auth/avatar', { image: await squarePicture(file) }),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ avatarAt: string | null }>('/auth/avatar'),
    onSuccess: onSaved,
  });

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setTooBig(!!file && file.size > SOURCE_MAX_BYTES);
    if (file && file.size <= SOURCE_MAX_BYTES) upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  return (
    <Card title={t('prefs.avatarTitle')}>
      <div className="flex items-center gap-4">
        <Avatar user={user} size={64} />
        <div className="space-y-2">
          <p className="text-sm text-muted">{t('prefs.avatarIntro')}</p>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-md border border-border bg-bg2 px-3 py-1.5 text-sm hover:bg-bg1 has-[:focus-visible]:outline has-[:disabled]:opacity-50">
              {t('prefs.avatarPick')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={pick}
                disabled={busy}
              />
            </label>
            {user.avatarAt && (
              <Button variant="secondary" onClick={() => remove.mutate()} disabled={busy}>
                {t('prefs.avatarRemove')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <ErrorText>
        {tooBig
          ? t('prefs.avatarTooBig')
          : error && (error instanceof ApiError ? errorText(t, error) : t('prefs.avatarUnreadable'))}
      </ErrorText>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      notify('success', t('prefs.passwordChanged'));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setMismatch(newPassword !== confirm);
    if (newPassword === confirm) change.mutate();
  }

  return (
    <Card title={t('prefs.passwordTitle')}>
      <p className="mb-4 text-sm text-muted">{t('prefs.passwordIntro')}</p>
      <form onSubmit={submit}>
        <ErrorText>{mismatch ? t('auth.passwordMismatch') : change.error && errorText(t, change.error)}</ErrorText>
        <TextField
          label={t('prefs.currentPassword')}
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <TextField
          label={t('prefs.newPassword')}
          hint={t('auth.passwordHint')}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        <TextField
          label={t('auth.passwordConfirm')}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Button type="submit" disabled={change.isPending}>
          {t('prefs.passwordSubmit')}
        </Button>
      </form>
    </Card>
  );
}

export function PreferencesPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">{t('prefs.title')}</h1>
      <AvatarCard />
      <DisplayCard />
      <PasswordCard />
    </div>
  );
}
