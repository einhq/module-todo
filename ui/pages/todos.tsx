import { ActionIcon, Badge, Box, Button, Checkbox, Collapse, Group, Modal, NavLink, Paper, Select, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { EmptyState, PageBar, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, notify } from '@ein/ui/signals';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '../../lib/api.ts';

export const handle = { title: 'Todo', pattern: 'mixed' };

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

/**
 * `/todos`: the reader's todo lists beside the one open, `?list=<path>`, or, with no list, what is
 * left for them to do on any list (`todo-mine`). `?item=<path>` opens the item's list.
 */
export default function TodosPage() {
  const [params, setParams] = useSearchParams();
  const listPath = params.get('list') ?? (params.get('item') ? dirname(params.get('item')!) : null);
  const lists = useCommand<TodoList[]>('todo-lists');
  const [creating, setCreating] = useState(false);

  const open = (path: string | null) => setParams(path ? { list: path } : {});

  return (
    <Box>
      <PageBar
        title='Todo'
        pattern='mixed'
        controls={<Button size='xs' variant='light' leftSection={<TablerIcon name='plus' size={14} />} onClick={() => setCreating(true)}>New list</Button>}
      />
      <Group align='flex-start' gap='lg' p='md' wrap='wrap'>
        <Box w={{ base: '100%', sm: 260 }}>
          <ListNav lists={lists.data ?? []} loading={lists.loading} current={listPath} onOpen={open} />
        </Box>
        <Box style={{ flex: 1, minWidth: 280 }}>
          {listPath
            ? <ListView key={listPath} path={listPath} highlight={params.get('item')} onChanged={lists.refetch} />
            : <MineView onChanged={lists.refetch} onOpen={open} />}
        </Box>
      </Group>
      <NewListModal
        opened={creating}
        onClose={() => setCreating(false)}
        onCreated={(list) => {
          setCreating(false);
          void lists.refetch();
          open(list.path);
        }}
      />
    </Box>
  );
}

/** The lists, the reader's own first and then each group's, under "What's mine". */
function ListNav({ lists, loading, current, onOpen }: { lists: TodoList[]; loading: boolean; current: string | null; onOpen: (path: string | null) => void }) {
  const sections = new Map<string, TodoList[]>();
  for (const list of lists) {
    const key = list.group ?? '';
    sections.set(key, [...(sections.get(key) ?? []), list]);
  }
  const row = (list: TodoList) => (
    <NavLink
      key={list.path}
      active={list.path === current}
      label={list.title}
      rightSection={list.open > 0 ? <Badge size='sm' variant='light' circle>{list.open}</Badge> : undefined}
      onClick={() => onOpen(list.path)}
    />
  );
  return (
    <Stack gap={4}>
      <NavLink active={current === null} label="What's mine" leftSection={<TablerIcon name='user' size={16} />} onClick={() => onOpen(null)} />
      {loading && lists.length === 0 && <Text size='sm' c='dimmed' px='sm'>Reading the lists…</Text>}
      {[...sections].map(([group, rows]) => (
        <Box key={group} mt='sm'>
          <Text size='xs' fw={600} c='dimmed' tt='uppercase' px='sm' mb={2}>{group ? `Shared with ${group}` : 'Your own'}</Text>
          {rows.map(row)}
        </Box>
      ))}
    </Stack>
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

/** A new list's title, and whether it is the reader's own or shared with one of their groups. */
function NewListModal({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (list: TodoList) => void }) {
  // `/groups` lists the shared homes of the reader's own groups, and only those.
  const groups = useCommand<string[]>('ls /groups');
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const list = await execCommand<TodoList>(`todo-list-create ${shq(title.trim())}${where ? ` --group ${shq(where)}` : ''}`);
      setTitle('');
      onCreated(list);
    } catch (err) {
      notify({ message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title='New list'>
      <Stack component='form' onSubmit={create} gap='sm'>
        <TextInput label='Title' placeholder='Shopping' value={title} onChange={(event) => setTitle(event.currentTarget.value)} data-autofocus required />
        <Select
          label='Shared with'
          description='A list of your own is yours alone; a group list is shared with every member of the group.'
          data={[{ value: '', label: 'Nobody, it is mine' }, ...(groups.data ?? []).map((group) => ({ value: group, label: `The ${group} group` }))]}
          value={where}
          onChange={(value) => setWhere(value ?? '')}
          allowDeselect={false}
        />
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>Cancel</Button>
          <Button type='submit' loading={busy} disabled={!title.trim()}>Create list</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
