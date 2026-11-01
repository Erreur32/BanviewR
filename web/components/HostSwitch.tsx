import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { ErrorText, SelectField } from './ui.tsx';

// Instance picker of the per-instance pages, shown only when there is a choice.
// children should key on hostId, to drop the state of the previous instance.
export function HostSwitch({ children }: { children: (hostId: number) => ReactNode }) {
  const { t } = useTranslation();
  const hosts = useQuery(hostsQuery);
  const [chosen, setChosen] = useState<number | null>(null);
  const list = hosts.data?.hosts ?? [];
  const hostId = chosen ?? list[0]?.id;

  return (
    <>
      <ErrorText>{hosts.error && errorText(t, hosts.error)}</ErrorText>
      {list.length > 1 && (
        <div className="max-w-xs">
          <SelectField label={t('jails.instance')} value={hostId} onChange={(e) => setChosen(Number(e.target.value))}>
            {list.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      {hostId !== undefined && children(hostId)}
    </>
  );
}
