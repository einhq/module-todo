import { ActionIcon, Badge, Box, Button, Checkbox, Collapse, Group, Menu, Paper, ScrollArea, Select, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { EmptyState, ListFilterInput, PageBar, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand, usePhone } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, notify, openDialog } from '@ein/ui/signals';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '../../lib/api.ts';

export const handle = { fullBleed: true, title: 'Todo', pattern: 'mixed' };

/** Today in the reader's own time zone, as `YYYY-MM-DD`, which is what a due day is compared with. */
const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** A due day as the reader says it: Today, Tomorrow, or the date. */
const dueLabel = (due: string): string => {
  const now = today();
  const tomorrow = new Date(Date.parse(`${now}T12:00:00`) + 86_400_000);
  if (due === now) return 'Today';
  if (due === `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`) return 'Tomorrow';
  return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: due.slice(0, 4) === now.slice(0, 4) ? undefined : 'numeric' });
};

const dirname = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

/** Run a command, saying on failure what went wrong; answers whether it ran. */
const run = async (command: string): Promise<boolean> => {
  try {
    await execCommand(command);
    return true;
  } catch (err) {
    notify({ message: err instanceof Error ? err.message : String(err), color: 'red' });
    return false;
  }
};

/** The bar's round buttons: finger-sized on a phone, as the app header's are. */
const BAR_BUTTON = { size: 36, icon: 22 };

/**
 * `/todos`: the reader's todo lists in a pane beside the one open, `?list=<path>`, or, with no
 * list, what is left for them to do on any list (`todo-mine`). `?item=<path>` opens the item's
 * list. Laid out as the chat page is: the page's bar with its buttons, the lists in a bordered box
 * in the page's margin, and on a phone, where the box does not fit, a menu of the lists in the bar.
 */
export default function TodosPage() {
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const listPath = params.get('list') ?? (params.get('item') ? dirname(params.get('item')!) : null);
  const lists = useCommand<TodoList[]>('todo-lists');

  const open = (path: string | null) => setParams(path ? { list: path } : {});

  // A list made in the New list dialog opens here before the lists have heard of it.
  const known = lists.data?.some((list) => list.path === listPath) ?? true;
  useEffect(() => {
    if (listPath && !known) void lists.refetch();
  }, [listPath, known]);

  return (
    <Paper
      radius={0}
      bg='var(--mrx-surface-base)'
      style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - var(--app-shell-header-offset, 48px))', overflow: 'hidden' }}
    >
      <PageBar
        title='Todo'
        pattern='mixed'
        band
        controls={
          <>
            <Tooltip label='New list'>
              <ActionIcon variant='subtle' size={phone ? BAR_BUTTON.size : undefined} onClick={() => openDialog('/todos/new-list')} aria-label='New list'>
                <TablerIcon name='plus' size={phone ? BAR_BUTTON.icon : 17} />
              </ActionIcon>
            </Tooltip>
            {phone && <ListsMenu lists={lists.data ?? []} current={listPath} onOpen={open} />}
          </>
        }
      />
      <Box style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box w={340} h='100%' p='md' pr={0} style={{ flex: '0 0 340px', overflow: 'hidden' }} visibleFrom='sm'>
          <Paper h='100%' p='sm' radius='md' withBorder>
            <ListsPane lists={lists.data ?? []} loading={lists.loading} current={listPath} onOpen={open} />
          </Paper>
        </Box>
        <ScrollArea type='auto' scrollbars='y' style={{ flex: 1, minWidth: 0 }}>
          <Box p='md' maw={860}>
            {listPath
              ? <ListView key={listPath} path={listPath} highlight={params.get('item')} onChanged={lists.refetch} />
              : <MineView onChanged={lists.refetch} onOpen={open} />}
          </Box>
        </ScrollArea>
      </Box>
    </Paper>
  );
}

/** What a list's row says under its title: how much is left, and whose it is. */
const listDetail = (list: TodoList): string => `${list.open === 0 ? 'nothing left' : `${list.open} left`} · ${list.group ? `shared with ${list.group}` : 'your own'}`;

/** One row of the lists, as the chat page's recent chats are: the title, and a dimmed line under it. */
function ListRow({ title, detail, icon, active, onPick }: { title: string; detail: string; icon?: string; active: boolean; onPick: () => void }) {
  return (
    <UnstyledButton
      onClick={onPick}
      style={{ display: 'block', width: '100%', padding: '8px 10px', borderRadius: 'var(--mantine-radius-sm)', background: active ? 'var(--mrx-surface-raised)' : undefined }}
    >
      <Group gap={8} wrap='nowrap'>
        {icon && <TablerIcon name={icon} size={16} />}
        <Box style={{ minWidth: 0 }}>
          <Text size='sm' truncate fw={active ? 600 : 400}>{title}</Text>
          <Text size='xs' c='dimmed' truncate>{detail}</Text>
        </Box>
      </Group>
    </UnstyledButton>
  );
}

/** "What's mine", then the lists under a filter over their titles. */
function ListRows({ lists, loading, current, filter, onOpen }: {
  lists: TodoList[];
  loading: boolean;
  current: string | null;
  filter: string;
  onOpen: (path: string | null) => void;
}) {
  const needle = filter.trim().toLocaleLowerCase();
  const shown = needle ? lists.filter((list) => list.title.toLocaleLowerCase().includes(needle)) : lists;
  return (
    <Stack gap={2}>
      {!needle && <ListRow title="What's mine" detail='Given to you, on any list' icon='user' active={current === null} onPick={() => onOpen(null)} />}
      {loading && lists.length === 0 && <Text size='sm' c='dimmed' p='sm'>Reading the lists…</Text>}
      {!loading && shown.length === 0 && <Text size='sm' c='dimmed' p='sm'>{needle ? 'No lists match' : 'No lists yet'}</Text>}
      {shown.map((list) => <ListRow key={list.path} title={list.title} detail={listDetail(list)} active={list.path === current} onPick={() => onOpen(list.path)} />)}
    </Stack>
  );
}

/** The lists beside the open one, in the page's margin. */
function ListsPane({ lists, loading, current, onOpen }: { lists: TodoList[]; loading: boolean; current: string | null; onOpen: (path: string | null) => void }) {
  const [filter, setFilter] = useState('');
  return (
    <Stack gap='xs' h='100%'>
      <ListFilterInput value={filter} onChange={setFilter} what='lists' size='sm' />
      <ScrollArea type='auto' scrollbars='y' offsetScrollbars='y' style={{ flex: 1, minHeight: 0 }}>
        <ListRows lists={lists} loading={loading} current={current} filter={filter} onOpen={onOpen} />
      </ScrollArea>
    </Stack>
  );
}

/** On a phone, the lists as a menu in the bar. */
function ListsMenu({ lists, current, onOpen }: { lists: TodoList[]; current: string | null; onOpen: (path: string | null) => void }) {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState('');
  const pick = (path: string | null) => {
    setOpened(false);
    onOpen(path);
  };
  return (
    <Menu shadow='md' width={320} position='bottom-end' opened={opened} onChange={setOpened}>
      <Menu.Target>
        <Tooltip label='Lists'>
          <ActionIcon variant='subtle' size={BAR_BUTTON.size} aria-label='Lists'>
            <TablerIcon name='list' size={BAR_BUTTON.icon} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Lists</Menu.Label>
        <Box px={4} pb='xs'>
          <ListFilterInput value={filter} onChange={setFilter} what='lists' size='sm' />
        </Box>
        <ScrollArea.Autosize mah={420} type='auto' scrollbars='y' px={4}>
          <ListRows lists={lists} loading={false} current={current} filter={filter} onOpen={pick} />
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
}

/** One item: its box, title, when it is due and whose it is; the pencil opens it to change. */
function ItemRow({ item, members, highlight, aside, onChanged }: {
  item: TodoItem;
  members: TodoMember[];
  highlight?: boolean;
  aside?: ReactNode;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const overdue = !item.done && item.due !== undefined && item.due < today();
  const who = members.find((member) => member.username === item.assignee)?.name ?? item.assignee;

  const toggle = async () => {
    setBusy(true);
    if (await run(`todo-done ${shq(item.path)}${item.done ? ' --undo' : ''}`)) onChanged();
    setBusy(false);
  };

  if (editing) return <ItemEditor item={item} members={members} onDone={() => setEditing(false)} onChanged={onChanged} />;
  return (
    <Group
      gap='sm'
      wrap='nowrap'
      py={6}
      px='xs'
      style={{ borderRadius: 'var(--mantine-radius-sm)', background: highlight ? 'var(--mantine-primary-color-light)' : undefined }}
    >
      <Checkbox checked={item.done} disabled={busy} onChange={toggle} aria-label={item.done ? `Mark ${item.title} not done` : `Mark ${item.title} done`} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size='sm' td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined} truncate>{item.title}</Text>
        {aside}
      </Box>
      {item.due && <Badge size='sm' variant={overdue ? 'filled' : 'light'} color={overdue ? 'red' : 'gray'} tt='none'>{dueLabel(item.due)}</Badge>}
      {who && <Badge size='sm' variant='outline' color='gray' tt='none' leftSection={<TablerIcon name='user' size={10} />}>{who}</Badge>}
      {item.done && item.doneBy && (
        <Tooltip
          label={`Done by ${members.find((member) => member.username === item.doneBy)?.name ?? item.doneBy}${
            item.doneAt ? `, ${new Date(item.doneAt).toLocaleString()}` : ''
          }`}
        >
          <Box component='span' style={{ display: 'inline-flex' }}>
            <TablerIcon name='check' size={14} color='var(--mantine-color-dimmed)' />
          </Box>
        </Tooltip>
      )}
      <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Change ${item.title}`} onClick={() => setEditing(true)}>
        <TablerIcon name='pencil' size={14} />
      </ActionIcon>
    </Group>
  );
}

/** An item opened to change: its title, due day and whose it is, saved together; or taken to the trash. */
function ItemEditor({ item, members, onDone, onChanged }: { item: TodoItem; members: TodoMember[]; onDone: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(item.due ?? '');
  const [assignee, setAssignee] = useState<string | null>(item.assignee ?? null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const command = `todo-set ${shq(item.path)} --title ${shq(title.trim())} ${due ? `--due ${shq(due)}` : '--no-due'} ${
      assignee ? `--assignee ${shq(assignee)}` : '--no-assignee'
    }`;
    if (await run(command)) {
      onChanged();
      onDone();
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    if (await run(`trash put ${shq(item.path)}`)) {
      notify({ message: `Moved "${item.title}" to the trash.`, color: 'green' });
      onChanged();
      onDone();
    }
    setBusy(false);
  };

  return (
    <Paper withBorder p='sm' my={4} component='form' onSubmit={save}>
      <Stack gap='xs'>
        <TextInput value={title} onChange={(event) => setTitle(event.currentTarget.value)} aria-label='Title' data-autofocus autoFocus />
        <Group gap='xs' grow>
          <TextInput type='date' label='Due' value={due} onChange={(event) => setDue(event.currentTarget.value)} />
          <Select
            label='Who'
            placeholder='Anyone'
            clearable
            data={members.map((member) => ({ value: member.username, label: member.name }))}
            value={assignee}
            onChange={setAssignee}
          />
        </Group>
        <Group justify='space-between'>
          <Button variant='subtle' color='red' size='xs' leftSection={<TablerIcon name='trash' size={14} />} onClick={remove} disabled={busy}>Move to trash</Button>
          <Group gap='xs'>
            <Button variant='default' size='xs' leftSection={<TablerIcon name='x' size={14} />} onClick={onDone} disabled={busy}>Cancel</Button>
            <Button type='submit' size='xs' loading={busy} disabled={!title.trim()}>Save</Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

/** The line that adds an item at the end of a list: Enter adds it, and the due day and person are optional. */
function AddItem({ list, members, onAdded }: { list: string; members: TodoMember[]; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const command = `todo-add ${shq(list)} ${shq(title.trim())}${due ? ` --due ${shq(due)}` : ''}${assignee ? ` --assignee ${shq(assignee)}` : ''}`;
    if (await run(command)) {
      setTitle('');
      setDue('');
      setAssignee(null);
      onAdded();
    }
    setBusy(false);
  };

  return (
    <Group component='form' onSubmit={add} gap='xs' mt='sm' wrap='wrap'>
      <TextInput
        style={{ flex: 1, minWidth: 180 }}
        placeholder='Add an item'
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        disabled={busy}
        aria-label='New item'
      />
      <TextInput type='date' w={150} value={due} onChange={(event) => setDue(event.currentTarget.value)} disabled={busy} aria-label='Due' />
      {members.length > 1 && (
        <Select
          w={150}
          placeholder='Anyone'
          clearable
          data={members.map((member) => ({ value: member.username, label: member.name }))}
          value={assignee}
          onChange={setAssignee}
          aria-label='Who'
        />
      )}
      <Button type='submit' leftSection={<TablerIcon name='plus' size={14} />} loading={busy} disabled={!title.trim()}>Add</Button>
    </Group>
  );
}

/** One list: its open items, the line to add one, and the done ones folded away. */
function ListView({ path, highlight, onChanged }: { path: string; highlight: string | null; onChanged: () => void }) {
  const listing = useCommand<TodoListing>(`todo-items ${shq(path)}`);
  const members = useCommand<TodoMember[]>(`todo-members ${shq(path)}`);
  const [showDone, setShowDone] = useState(false);

  if (listing.loading && !listing.data) return <PageLoader />;
  if (listing.error || !listing.data) return <EmptyState title='This list could not be read'>{listing.error?.message}</EmptyState>;

  const { list, items } = listing.data;
  const changed = () => {
    void listing.refetch();
    onChanged();
  };
  const open = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);
  const people = members.data ?? [];

  return (
    <Stack gap='xs'>
      <Group gap='xs'>
        <Text fw={600} size='lg'>{list.title}</Text>
        {list.group && <Badge variant='light' color='gray' tt='none'>Shared with {list.group}</Badge>}
      </Group>
      {open.length === 0 && <Text size='sm' c='dimmed'>Nothing left to do here.</Text>}
      {open.map((item) => <ItemRow key={item.path} item={item} members={people} highlight={item.path === highlight} onChanged={changed} />)}
      <AddItem list={list.path} members={people} onAdded={changed} />
      {done.length > 0 && (
        <Box mt='md'>
          <UnstyledButton onClick={() => setShowDone((shown) => !shown)}>
            <Group gap={4}>
              {showDone ? <TablerIcon name='chevron-down' size={14} /> : <TablerIcon name='chevron-right' size={14} />}
              <Text size='sm' c='dimmed'>Done ({done.length})</Text>
            </Group>
          </UnstyledButton>
          <Collapse expanded={showDone}>
            {done.map((item) => <ItemRow key={item.path} item={item} members={people} highlight={item.path === highlight} onChanged={changed} />)}
          </Collapse>
        </Box>
      )}
    </Stack>
  );
}

/** What is left for the reader on any list, soonest due first, each with the list it is on. */
function MineView({ onChanged, onOpen }: { onChanged: () => void; onOpen: (path: string) => void }) {
  const mine = useCommand<TodoMine[]>('todo-mine');
  if (mine.loading && !mine.data) return <PageLoader />;
  if (mine.error) return <EmptyState title='Your items could not be read'>{mine.error.message}</EmptyState>;
  const items = mine.data ?? [];
  const changed = () => {
    void mine.refetch();
    onChanged();
  };
  return (
    <Stack gap='xs'>
      <Text fw={600} size='lg'>What's mine</Text>
      {items.length === 0 && (
        <EmptyState title='Nothing left for you'>
          Items given to you on any list, and those of your own lists given to nobody, are listed here.
        </EmptyState>
      )}
      {items.map((item) => (
        <ItemRow
          key={item.path}
          item={item}
          members={[]}
          onChanged={changed}
          aside={
            <UnstyledButton onClick={() => onOpen(item.list)}>
              <Group gap={4}>
                <TablerIcon name='list-check' size={12} color='var(--mantine-color-dimmed)' />
                <Text size='xs' c='dimmed'>{item.listTitle}{item.group ? `, shared with ${item.group}` : ''}</Text>
              </Group>
            </UnstyledButton>
          }
        />
      ))}
    </Stack>
  );
}
