import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FirewallAudit } from '../../shared/firewall.ts';
import { api } from '../api.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { Badge, Button, Card, ErrorText, Table } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { IpLink } from './JailsPage.tsx';

const BACKENDS = ['iptables', 'ipset', 'nftables'] as const;

function HostFirewall({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  // Runs a dozen processes on the host: on demand, not on a timer
  const query = useQuery({
    queryKey: ['hosts', hostId, 'firewall'],
    queryFn: () => api.get<{ audit: FirewallAudit }>(`/hosts/${hostId}/firewall`),
    refetchOnWindowFocus: false,
  });
  const audit = query.data?.audit;
  const unreadable = audit && !Object.values(audit.readable).some(Boolean);
  const issuesOf = (jail: string) => audit?.issues.filter((i) => i.jail === jail).length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => query.refetch()}>
          {query.isFetching ? t('firewall.running') : t('firewall.rerun')}
        </Button>
        {audit &&
          BACKENDS.map((b) => (
            <Badge key={b} tone={audit.readable[b] ? 'ok' : 'neutral'}>
              {t(audit.readable[b] ? 'firewall.read' : 'firewall.notRead', { backend: b })}
            </Badge>
          ))}
      </div>
      <ErrorText>{query.error && errorText(t, query.error)}</ErrorText>
      {unreadable && <p className="text-sm text-danger">{t('firewall.unreadable')}</p>}

      {audit && (
        <Card title={t('firewall.issuesTitle', { count: audit.issues.length })}>
          {audit.issues.length === 0 ? (
            <p className="text-sm text-ok">{t('firewall.noIssue')}</p>
          ) : (
            <Table columns={[t('firewall.severity'), t('firewall.issue'), t('jails.ip'), t('firewall.jail')]}>
              {audit.issues.map((issue, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is replaced as a whole on each run
                <tr key={i}>
                  <td>
                    <Badge tone={issue.severity === 'critical' ? 'danger' : 'neutral'}>
                      {t(`firewall.severities.${issue.severity}`)}
                    </Badge>
                  </td>
                  <td>{t(`firewall.kinds.${issue.kind}`, { target: issue.target })}</td>
                  <td className="font-mono text-xs">
                    {issue.ip?.includes('/') ? issue.ip : issue.ip && <IpLink hostId={hostId} ip={issue.ip} />}
                  </td>
                  <td className="text-muted">{issue.jail ?? '-'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {audit && (
        <Card title={t('firewall.jailsTitle')}>
          <Table columns={[t('firewall.jail'), t('firewall.action'), t('firewall.target'), t('jails.banned')]}>
            {audit.jails.flatMap(({ jail, banned, actions }) =>
              (actions.length ? actions : [null]).map((a, i) => (
                <tr key={`${jail}-${a?.action ?? ''}`}>
                  <td>
                    {i === 0 && (
                      <span className="flex items-center gap-2">
                        {jail}
                        {issuesOf(jail) > 0 && <Badge tone="danger">{issuesOf(jail)}</Badge>}
                      </span>
                    )}
                  </td>
                  <td>
                    {a ? (
                      <>
                        {a.action} <Badge>{t(`firewall.mechanisms.${a.kind}`)}</Badge>
                      </>
                    ) : (
                      <span className="text-muted">{t('firewall.noAction')}</span>
                    )}
                  </td>
                  <td className="font-mono text-xs">
                    {a?.target ?? <span className="font-sans text-muted">{t('firewall.notChecked')}</span>}
                  </td>
                  <td className="text-muted">{i === 0 ? banned : ''}</td>
                </tr>
              )),
            )}
          </Table>
        </Card>
      )}
    </>
  );
}

export function FirewallPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('firewall.title')}</h1>
      <p className="text-sm text-muted">{t('firewall.intro')}</p>
      <HostSwitch>{(hostId) => <HostFirewall key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}
