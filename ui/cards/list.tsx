import { Checkbox, Group, Skeleton, Stack, Text } from '@mantine/core';
import { RollingList, TablerIcon } from '@ein/ui/components';
import { useLocalDay, useNodeEvents, usePolledCommand } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, isAuthenticated, notify } from '@ein/ui/signals';
import { useSignals } from '@preact/signals-react/runtime';
import { useSearchParams } from 'react-router-dom';
import type { TodoItem, TodoListing } from '../../lib/api.ts';

const MS_PER_DAY = 86_400_000;

const daysUntil = (today: string, day: string): number => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);

/** When an item is due, in a few words: late, today, tomorrow, a weekday this week, else the date. */
const dueText = (days: number, due: string): string => {
  if (days < 0) return days === -1 ? 'yesterday' : `${-days} days late`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** The soonest due first — so the late ones, then today's — and what has no day last, as the board orders those. */
const byDue = (a: TodoItem, b: TodoItem): number => {
  if (a.due && b.due) return a.due.localeCompare(b.due);
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
};

/**
 * `/cards/todo/list`: one list's items not done (`list`), those due within a week or late when
 * `show` is `soon`, late first and then by when they are due, each with when and, unless `who` is
 * off, who is to do it, rolling by when they do not all fit. Someone signed in ticks one off; a
 * screen only shows. Read again as the list changes, and every few minutes besides.
 */
export default function TodoListCard() {
  useSignals();
  const [params] = useSearchParams();
  const list = params.get('list') ?? '';
  const soon = params.get('show') === 'soon';
  const who = params.get('who') !== 'false';
  const today = useLocalDay();
  const listing = usePolledCommand<TodoListing>(`todo-items ${shq(list)}`, list !== '', 5 * 60_000);
  useNodeEvents({ pathPrefix: list, recursive: true }, () => void listing.refetch());

  if (!listing.data) {
    if (!listing.error) return <Skeleton height='60%' radius='md' />;
    return <Text size='sm' c='dimmed' ta='center' mt='lg'>This list cannot be read here.</Text>;
  }
  const items = listing.data.items
    .filter((item) => !item.done && (!soon || (item.due !== undefined && daysUntil(today, item.due) < 7)))
    .sort(byDue);

  const tick = async (item: TodoItem) => {
    try {
      await execCommand(`todo-done ${shq(item.path)}`);
    } catch (error) {
      notify({ message: error instanceof Error ? error.message : String(error), color: 'red' });
    } finally {
      await listing.refetch();
    }
  };

  if (items.length === 0) {
    return (
      <Stack h='100%' align='center' justify='center' gap={6} c='dimmed'>
        <TablerIcon name='circle-check' size={26} stroke={1.5} />
        <Text size='sm'>{soon ? 'Nothing due this week' : `Nothing left on ${listing.data.list.title}`}</Text>
      </Stack>
    );
  }

  return (
    <RollingList gap='0.5em' style={{ fontSize: 'clamp(0.85rem, 4.4cqmin, 1.4rem)' }}>
      {items.map((item) => {
        const days = item.due ? daysUntil(today, item.due) : undefined;
        const tone = days === undefined ? 'dimmed' : days < 0 ? 'red.4' : days === 0 ? 'yellow.4' : 'dimmed';
        return (
          <Group key={item.path} gap='sm' wrap='nowrap' align='center'>
            {isAuthenticated.value
              ? <Checkbox radius='xl' size='sm' color='yellow' aria-label={`${item.title} is done`} onChange={() => void tick(item)} />
              : <TablerIcon name='circle' size={16} style={{ color: 'var(--mrx-text-tertiary)', flex: 'none' }} />}
            <Text inherit lineClamp={1} style={{ flex: 1, minWidth: 0 }}>{item.title}</Text>
            {who && item.assignee && <Text inherit size='0.8em' c='dimmed' style={{ flex: 'none' }}>{item.assignee}</Text>}
            {item.due && days !== undefined && <Text inherit size='0.8em' fw={days <= 0 ? 650 : 500} c={tone} style={{ flex: 'none' }}>{dueText(days, item.due)}</Text>}
          </Group>
        );
      })}
    </RollingList>
  );
}
