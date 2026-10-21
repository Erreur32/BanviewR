import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '../../shared/auth.ts';
import { api } from '../api.ts';
import { authStatusQuery, useCurrentUser } from '../auth.ts';
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
      <DisplayCard />
      <PasswordCard />
    </div>
  );
}
