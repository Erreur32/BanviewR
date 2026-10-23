import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AuditRow } from '../../../shared/auth.ts';
import { api } from '../../api.ts';
import { useFormatDateTime } from '../../auth.ts';
import { Badge, Button, ErrorText, Table } from '../../components/ui.tsx';
import { errorText } from '../../errors.ts';

const PAGE_SIZE = 100;

export function AuditPage() {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const audit = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) =>
      api.get<{ entries: AuditRow[] }>(`/audit?limit=${PAGE_SIZE}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    // Keyset pagination: the next page starts below the smallest id seen
    getNextPageParam: (last) => (last.entries.length < PAGE_SIZE ? undefined : last.entries.at(-1)?.id),
  });
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
        <Button variant="secondary" size="sm" onClick={() => audit.refetch()} disabled={audit.isFetching}>
          {t('common.refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('audit.intro')}</p>
      <ErrorText>{audit.error && errorText(t, audit.error)}</ErrorText>
      {audit.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {audit.data &&
        (entries.length === 0 ? (
          <p className="text-sm text-muted">{t('audit.empty')}</p>
        ) : (
          <Table
            columns={[
              t('audit.at'),
              t('audit.actor'),
              t('audit.action'),
              t('audit.target'),
              t('audit.result'),
              t('audit.detail'),
              t('audit.instance'),
              t('audit.ip'),
            ]}
          >
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-muted">{formatDate(e.at)}</td>
                <td className="whitespace-nowrap">
                  {e.actorName} <span className="text-xs text-muted">{t(`audit.actorType.${e.actorType}`)}</span>
                </td>
                <td className="whitespace-nowrap font-mono text-xs">{e.action}</td>
                <td>{e.target}</td>
                <td>
                  <Badge tone={e.ok ? 'ok' : 'danger'}>{t(e.ok ? 'audit.ok' : 'audit.failed')}</Badge>
                </td>
                <td className="text-muted">{e.detail}</td>
                <td className="text-muted">{e.hostId ?? ''}</td>
                <td className="whitespace-nowrap font-mono text-xs text-muted">{e.ip}</td>
              </tr>
            ))}
          </Table>
        ))}
      {audit.hasNextPage && (
        <Button variant="secondary" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
          {t('audit.loadMore')}
        </Button>
      )}
    </div>
  );
}
