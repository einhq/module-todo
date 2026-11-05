import { ActionIcon, Avatar, Badge, Box, Button, Checkbox, Group, Menu, Paper, Popover, Stack, Tabs, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { DragDropContext, Draggable, type DraggableProvidedDragHandleProps, Droppable, type DropResult } from '@hello-pangea/dnd';
import { CoverAvatar, EmptyState, Markdown, PageBar, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand, usePhone } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, notify, onOutsideEdit, openDialog } from '@ein/ui/signals';
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoColumn, TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '../../lib/api.ts';
import { LinkChip } from '../components/LinkChip.tsx';

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

/** The tab of what is the reader's on every list; every other tab's value is a list's path. */
const OVERVIEW = 'overview';

/**
 * `/todos`: a tab in the bar for each of the reader's lists, after Overview, what is the reader's
 * to do on any list (`todo-mine`). A list, `?list=<path>`, is a board of its columns, whose cards
 * are dragged between them; `?item=<path>` opens one of its cards.
 */
export default function TodosPage() {
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const listPath = params.get('list');
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
      style={{ height: 'calc(100dvh - var(--app-shell-header-offset, 48px))', overflow: 'hidden' }}
    >
      <Tabs
        value={listPath ?? OVERVIEW}
        onChange={(value) => open(value && value !== OVERVIEW ? value : null)}
        keepMounted={false}
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <PageBar
          title='Todo'
          pattern='mixed'
          controls={
            <Menu shadow='md' position='bottom-end' withinPortal>
              <Menu.Target>
                <Tooltip label='More'>
                  <ActionIcon variant='subtle' size={phone ? BAR_BUTTON.size : undefined} aria-label='More'>
                    <TablerIcon name='dots' size={phone ? BAR_BUTTON.icon : 17} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<TablerIcon name='list-check' size={16} />} onClick={() => openDialog('/todos/new-list')}>New list</Menu.Item>
                {listPath && (
                  <Menu.Item
                    leftSection={<TablerIcon name='layout-columns' size={16} />}
                    onClick={() => openDialog(`/todos/new-column?list=${encodeURIComponent(listPath)}`)}
                  >
                    New column
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          }
          tabs={
            <Tabs.List>
              {/* On a phone a tab with an icon shows only the icon unless it is the open one, which tells no list from another. */}
              <Tabs.Tab value={OVERVIEW} leftSection={phone ? undefined : <TablerIcon name='user-check' size={16} />}>Overview</Tabs.Tab>
              {(lists.data ?? []).map((list) => (
                <Tabs.Tab
                  key={list.path}
                  value={list.path}
                  title={list.group ? `Shared with ${list.group}` : 'Your own'}
                  leftSection={phone ? undefined : <TablerIcon name={list.group ? 'users' : 'list-check'} size={16} />}
                >
                  {list.title}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          }
        />
        <Box style={{ flex: 1, minHeight: 0 }}>
          {listPath ? <ListBoard key={listPath} path={listPath} highlight={params.get('item')} /> : <OverviewBoard lists={lists.data ?? []} onOpen={open} />}
        </Box>
      </Tabs>
    </Paper>
  );
}

/**
 * The due day as a calendar button that opens a date picker; once a day is set the button says
 * it, and the picker can take it away again.
 */
function DueButton({ value, onChange, disabled }: { value: string; onChange: (day: string) => void; disabled?: boolean }) {
  const [opened, setOpened] = useState(false);
  const pick = (day: string) => {
    onChange(day);
    setOpened(false);
  };
  return (
    <Popover opened={opened} onChange={setOpened} position='bottom-end' shadow='md'>
      <Popover.Target>
        {value
          ? (
            <Button
              variant='light'
              color='gray'
              size='xs'
              leftSection={<TablerIcon name='calendar' size={14} />}
              onClick={() => setOpened((shown) => !shown)}
              disabled={disabled}
            >
              {dueLabel(value)}
            </Button>
          )
          : (
            <Tooltip label='Due'>
              <ActionIcon variant='subtle' color='gray' size='lg' aria-label='Due' onClick={() => setOpened((shown) => !shown)} disabled={disabled}>
                <TablerIcon name='calendar' size={18} />
              </ActionIcon>
            </Tooltip>
          )}
      </Popover.Target>
      <Popover.Dropdown>
        <DatePicker value={value || null} onChange={(day) => pick(day ?? '')} />
        {value && <Button variant='subtle' color='gray' size='xs' fullWidth mt='xs' onClick={() => pick('')}>No due day</Button>}
      </Popover.Dropdown>
    </Popover>
  );
}

/** A name's initials, for a face with no picture. */
const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toLocaleUpperCase()).join('') || '?';

/** Someone as a small round face: their person's picture, else their initials. */
function Face({ username, members, size = 26 }: { username: string; members: TodoMember[]; size?: number }) {
  const member = members.find((each) => each.username === username);
  const name = member?.name ?? username;
  if (member?.personPath) return <CoverAvatar path={member.personPath} fallback={initialsOf(name)} size={size} radius='xl' alt={name} eager />;
  return <Avatar size={size} radius='xl' name={name} color='initials' alt={name} />;
}

/**
 * Whose an item is, as their face, or an empty one when it is nobody's, with a menu that gives it
 * to one of `members` or to nobody. Without members, as on the Overview, where every item is the
 * reader's, there is nothing to show.
 */
function AssigneeButton({ item, members, onChanged }: { item: TodoItem; members: TodoMember[]; onChanged: () => void }) {
  const who = members.find((member) => member.username === item.assignee)?.name ?? item.assignee;
  const give = async (username: string | null) => {
    if (await run(`todo-set ${shq(item.path)} ${username ? `--assignee ${shq(username)}` : '--no-assignee'}`)) onChanged();
  };
  const face = item.assignee ? <Face username={item.assignee} members={members} /> : <TablerIcon name='user-plus' size={16} color='var(--mantine-color-dimmed)' />;
  if (members.length === 0) return null;
  return (
    <Menu shadow='md' position='bottom-end' withinPortal>
      <Menu.Target>
        <Tooltip label={who ? `${who}'s; give it to someone else` : 'Give it to someone'}>
          <ActionIcon
            variant={item.assignee ? 'transparent' : 'subtle'}
            color='gray'
            radius='xl'
            size={26}
            aria-label={who ? `Given to ${who}` : 'Give it to someone'}
            style={item.assignee ? undefined : { border: '1px dashed var(--mantine-color-default-border)' }}
          >
            {face}
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Who is to do it</Menu.Label>
        {members.map((member) => (
          <Menu.Item
            key={member.username}
            leftSection={<Face username={member.username} members={members} size={22} />}
            rightSection={member.username === item.assignee ? <TablerIcon name='check' size={14} /> : undefined}
            onClick={() => void give(member.username)}
          >
            {member.name}
          </Menu.Item>
        ))}
        {item.assignee && (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<TablerIcon name='user-off' size={16} />} onClick={() => void give(null)}>Nobody in particular</Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * One item as a card: its title and whose it is, when it is due, what it links to, and, opened,
 * its notes and what can be done with it — give it a day, move it to another column, change it in
 * the item's dialog. `onSelect` gives it a box to pick it by; `aside` says more under the title.
 */
function TodoCard({ item, members, columns, expanded, onExpand, onChanged, dragHandle, dragging, selected, onSelect, aside }: {
  item: TodoItem;
  members: TodoMember[];
  /** The board's columns to move it to; none on the Overview, where it can only be ticked off. */
  columns: TodoColumn[];
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  onChanged: () => void;
  dragHandle?: DraggableProvidedDragHandleProps | null;
  dragging?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  aside?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overdue = !item.done && item.due !== undefined && item.due < today();

  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const moveTo = async (column: string) => {
    if (await run(`todo-move ${shq(item.path)} --column ${shq(column)}`)) onChanged();
  };
  const tick = async () => {
    if (await run(`todo-done ${shq(item.path)}${item.done ? ' --undo' : ''}`)) onChanged();
  };
  const setDue = async (day: string) => {
    if (await run(`todo-set ${shq(item.path)} ${day ? `--due ${shq(day)}` : '--no-due'}`)) onChanged();
  };

  return (
    <Paper
      ref={ref}
      withBorder
      radius='sm'
      p='xs'
      shadow={dragging ? 'md' : undefined}
      bg='var(--mrx-surface-base)'
      {...dragHandle}
      aria-expanded={expanded}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onExpand(!expanded);
      }}
      style={{ cursor: dragHandle ? 'grab' : undefined, borderColor: expanded ? 'var(--mantine-primary-color-filled)' : undefined }}
    >
      <Group gap={8} wrap='nowrap' align='flex-start'>
        {onSelect && <Checkbox mt={3} size='xs' checked={selected ?? false} onChange={(event) => onSelect(event.currentTarget.checked)} aria-label={`Pick ${item.title}`} />}
        {/* Not a button: a drag cannot start on one, and the title is most of what there is to grab. */}
        <Box onClick={() => onExpand(!expanded)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <Text size='sm' fw={500} lineClamp={expanded ? undefined : 3} td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined}>
            {item.title}
          </Text>
        </Box>
        <AssigneeButton item={item} members={members} onChanged={onChanged} />
      </Group>
      {(item.due || item.notes || aside) && (
        <Group gap={6} mt={6} wrap='wrap'>
          {item.due && (
            <Badge size='sm' variant={overdue ? 'filled' : 'light'} color={overdue ? 'red' : 'gray'} tt='none' leftSection={<TablerIcon name='calendar' size={11} />}>
              {dueLabel(item.due)}
            </Badge>
          )}
          {!expanded && item.notes && <TablerIcon name='align-left' size={14} color='var(--mantine-color-dimmed)' aria-label='Has notes' />}
          {aside}
        </Group>
      )}
      {item.links && (
        <Group gap={6} mt={6}>
          {item.links.map((link) => <LinkChip key={link.path} link={link} />)}
        </Group>
      )}
      {expanded && (
        <Stack gap='xs' mt='xs' style={{ cursor: 'auto' }}>
          {item.notes
            ? (
              <Box fz='sm'>
                <Markdown content={item.notes} breaks />
              </Box>
            )
            : <Text size='xs' c='dimmed'>No notes.</Text>}
          {item.done && (item.doneBy || item.doneAt) && <Text size='xs' c='dimmed'>{doneLabel(item, members)}</Text>}
          <Group gap={4} justify='flex-end'>
            {!item.done && <DueButton value={item.due ?? ''} onChange={(day) => void setDue(day)} />}
            {columns.length > 0 && (
              <Menu shadow='md' position='bottom-end' withinPortal>
                <Menu.Target>
                  <Tooltip label='Move to another column'>
                    <ActionIcon variant='subtle' color='gray' size='lg' aria-label='Move to another column'>
                      <TablerIcon name='arrows-right-left' size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Move to</Menu.Label>
                  {columns.filter((column) => column.path !== item.column).map((column) => (
                    <Menu.Item key={column.path} onClick={() => void moveTo(column.path)}>{column.title}</Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
            <Tooltip label={item.done ? 'Not done' : 'Done'}>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='lg'
                aria-label={item.done ? `Mark ${item.title} not done` : `Mark ${item.title} done`}
                onClick={() => void tick()}
              >
                <TablerIcon name={item.done ? 'arrow-back-up' : 'check'} size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label='Change'>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='lg'
                aria-label={`Change ${item.title}`}
                onClick={() => openDialog(`/todos/item?path=${encodeURIComponent(item.path)}`)}
              >
                <TablerIcon name='pencil' size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

/** Who ticked an item off and when, as far as its file says. */
const doneLabel = (item: TodoItem, members: TodoMember[]): string => {
  const who = item.doneBy ? ` by ${members.find((member) => member.username === item.doneBy)?.name ?? item.doneBy}` : '';
  return `Done${who}${item.doneAt ? `, ${new Date(item.doneAt).toLocaleString()}` : ''}`;
};

/** The board's scroller: its columns side by side, sharing its width and filling its height; sideways when they do not fit. */
function BoardScroller({ children }: { children: ReactNode }) {
  return (
    <Box h='100%' style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <Box p='md' h='100%' style={{ display: 'flex', gap: 12, alignItems: 'stretch', boxSizing: 'border-box' }}>{children}</Box>
    </Box>
  );
}

/**
 * A column's frame: its heading over its cards, which scroll on their own, and a `footer` under
 * them that stays in sight. Columns share the board's width, none narrower than 260px; a phone
 * shows one at a time with the next peeking in.
 */
function ColumnFrame({ title, count, controls, footer, children }: {
  title: string;
  count: number;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  return (
    <Paper
      radius='md'
      bg='var(--mrx-surface-raised)'
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...(phone ? { flex: 'none', width: 'calc(100vw - 64px)' } : { flex: '1 0 260px' }) }}
    >
      <Group gap='xs' wrap='nowrap' px='sm' py={8} style={{ flex: 'none' }}>
        <Text fw={600} size='sm' truncate style={{ flex: 1, minWidth: 0 }}>{title}</Text>
        <Text size='xs' c='dimmed'>{count}</Text>
        {controls}
      </Group>
      {children}
      {footer && <Box px={8} pb={8} style={{ flex: 'none' }}>{footer}</Box>}
    </Paper>
  );
}

/** The style of a column's cards: they take what the heading and footer leave and scroll there. */
const COLUMN_CARDS = { flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: 'var(--mantine-radius-sm)' } as const;

/** A column's rename: a popover asking for its new title, written as the folder's `name` attr. */
function RenameColumn({ column, onChanged }: { column: TodoColumn; onChanged: () => void }) {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState(column.title);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    // done/ may not have been made yet: the board shows Done all the same.
    if (await run(`mkdir -p ${shq(column.path)} && attrs ${shq(column.path)} -s ${shq(`name=${name.trim()}`)}`)) {
      setOpened(false);
      onChanged();
    }
    setBusy(false);
  };
  return (
    <Popover opened={opened} onChange={setOpened} position='bottom' shadow='md' trapFocus onOpen={() => setName(column.title)}>
      <Popover.Target>
        <Tooltip label='Rename the column'>
          <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Rename ${column.title}`} onClick={() => setOpened((shown) => !shown)}>
            <TablerIcon name='pencil' size={14} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Group component='form' onSubmit={submit} gap='xs' wrap='nowrap'>
          <TextInput size='xs' w={200} value={name} onChange={(event) => setName(event.currentTarget.value)} aria-label='Column name' data-autofocus />
          <Button size='xs' type='submit' loading={busy} disabled={!name.trim()}>Save</Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

/** The controls in a column's heading: rename it, or, when it is empty and not Done, take it away. */
function ColumnMenu({ column, count, onChanged }: { column: TodoColumn; count: number; onChanged: () => void }) {
  const remove = async () => {
    if (await run(`rmdir ${shq(column.path)}`)) onChanged();
  };
  return (
    <Group gap={0} wrap='nowrap'>
      <RenameColumn column={column} onChanged={onChanged} />
      {column.stage === 'doing' && count === 0 && (
        <Tooltip label='Remove the column'>
          <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Remove ${column.title}`} onClick={() => void remove()}>
            <TablerIcon name='trash' size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

/** The line at the foot of Todo that adds an item: Enter adds it and stays for the next, Escape closes it. */
function AddCard({ list, onAdded }: { list: string; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    if (await run(`todo-add ${shq(list)} ${shq(title.trim())}`)) {
      setTitle('');
      onAdded();
    }
    setBusy(false);
  };

  if (!adding) {
    return (
      <Button variant='subtle' color='gray' size='xs' fullWidth justify='flex-start' leftSection={<TablerIcon name='plus' size={14} />} onClick={() => setAdding(true)}>
        Add an item
      </Button>
    );
  }
  return (
    <Box component='form' onSubmit={add}>
      <TextInput
        size='sm'
        placeholder='What is to be done'
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setAdding(false);
        }}
        onBlur={() => !title.trim() && setAdding(false)}
        disabled={busy}
        aria-label='New item'
        autoFocus
        rightSection={
          <ActionIcon type='submit' variant='subtle' size='sm' loading={busy} disabled={!title.trim()} aria-label='Add'>
            <TablerIcon name='corner-down-left' size={14} />
          </ActionIcon>
        }
      />
    </Box>
  );
}

/** The paths of a board's items, column by column, as the listing has them. */
const arrangementOf = (listing: TodoListing): Record<string, string[]> =>
  Object.fromEntries(listing.columns.map((column) => [column.path, listing.items.filter((item) => item.column === column.path).map((item) => item.path)]));

/**
 * One list as a board: Todo, the folders of the list, and Done, whose cards can be picked and
 * archived. A card is dragged within a column to reorder it and to another to move it there; it
 * shows where it was dropped until the list is read again, as it is after an edit in a dialog.
 */
function ListBoard({ path, highlight }: { path: string; highlight: string | null }) {
  const listing = useCommand<TodoListing>(`todo-items ${shq(path)}`);
  const members = useCommand<TodoMember[]>(`todo-members ${shq(path)}`);
  const [dropped, setDropped] = useState<Record<string, string[]> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(highlight ? [highlight] : []));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  useEffect(() => setDropped(null), [listing.data]);
  useEffect(() => onOutsideEdit(() => void listing.refetch()), [listing.refetch]);

  if (listing.loading && !listing.data) return <PageLoader />;
  if (listing.error || !listing.data) return <EmptyState title='This list could not be read'>{listing.error?.message}</EmptyState>;

  const { list, columns, items } = listing.data;
  const changed = () => void listing.refetch();
  const people = members.data ?? [];
  const byPath = new Map(items.map((item) => [item.path, item]));
  const arranged = dropped ?? arrangementOf(listing.data);
  const cardsOf = (column: TodoColumn): TodoItem[] => (arranged[column.path] ?? []).flatMap((each) => byPath.get(each) ?? []);
  const done = columns.find((column) => column.stage === 'done')!;
  const doneCards = cardsOf(done);
  const pickedDone = doneCards.filter((item) => picked.has(item.path));

  const expand = (item: TodoItem, open: boolean) =>
    setExpanded((shown) => {
      const next = new Set(shown);
      if (open) next.add(item.path);
      else next.delete(item.path);
      return next;
    });
  const pick = (item: TodoItem, on: boolean) =>
    setPicked((shown) => {
      const next = new Set(shown);
      if (on) next.add(item.path);
      else next.delete(item.path);
      return next;
    });

  const drop = async ({ source, destination, draggableId }: DropResult) => {
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;
    const next = Object.fromEntries(Object.entries(arranged).map(([column, paths]) => [column, paths.filter((each) => each !== draggableId)]));
    const into = next[destination.droppableId] ?? [];
    into.splice(destination.index, 0, draggableId);
    next[destination.droppableId] = into;
    setDropped(next);
    const at = into.indexOf(draggableId);
    const where = into[at + 1] ? `--before ${shq(into[at + 1])}` : into[at - 1] ? `--after ${shq(into[at - 1])}` : `--column ${shq(destination.droppableId)}`;
    if (await run(`todo-move ${shq(draggableId)} ${where}`)) changed();
    else setDropped(null);
  };

  const archive = async () => {
    setArchiving(true);
    if (await run(`todo-archive ${pickedDone.map((item) => shq(item.path)).join(' ')}`)) {
      notify({ message: `Archived ${pickedDone.length === 1 ? `"${pickedDone[0].title}"` : `${pickedDone.length} items`}.`, color: 'green' });
      setPicked(new Set());
      changed();
    }
    setArchiving(false);
  };

  const doneControls = doneCards.length > 0 && (
    <Group gap={4} wrap='nowrap'>
      <Tooltip label={pickedDone.length === doneCards.length ? 'Pick none' : 'Pick all'}>
        <Checkbox
          size='xs'
          checked={pickedDone.length === doneCards.length}
          indeterminate={pickedDone.length > 0 && pickedDone.length < doneCards.length}
          onChange={(event) => setPicked(event.currentTarget.checked ? new Set(doneCards.map((item) => item.path)) : new Set())}
          aria-label='Pick every done item'
        />
      </Tooltip>
      {pickedDone.length > 0 && (
        <Button
          size='compact-xs'
          variant='light'
          leftSection={<TablerIcon name='archive' size={12} />}
          loading={archiving}
          onClick={() => void archive()}
        >
          Archive {pickedDone.length}
        </Button>
      )}
    </Group>
  );

  return (
    <DragDropContext onDragEnd={(result) => void drop(result)}>
      <BoardScroller>
        {columns.map((column) => {
          const cards = cardsOf(column);
          return (
            <ColumnFrame
              key={column.path}
              title={column.title}
              count={cards.length}
              controls={
                <>
                  {column.stage === 'done' && doneControls}
                  {column.stage !== 'todo' && <ColumnMenu column={column} count={cards.length} onChanged={changed} />}
                </>
              }
              footer={column.stage === 'todo' && <AddCard list={list.path} onAdded={changed} />}
            >
              <Droppable droppableId={column.path}>
                {(droppable, state) => (
                  <Stack
                    ref={droppable.innerRef}
                    {...droppable.droppableProps}
                    gap={6}
                    px={8}
                    pb={8}
                    style={{ ...COLUMN_CARDS, background: state.isDraggingOver ? 'var(--mantine-primary-color-light)' : undefined }}
                  >
                    {cards.map((item, index) => (
                      <Draggable key={item.path} draggableId={item.path} index={index}>
                        {(draggable, drag) => (
                          <div ref={draggable.innerRef} {...draggable.draggableProps}>
                            <TodoCard
                              item={item}
                              members={people}
                              columns={columns}
                              expanded={expanded.has(item.path)}
                              onExpand={(open) => expand(item, open)}
                              onChanged={changed}
                              dragHandle={draggable.dragHandleProps}
                              dragging={drag.isDragging}
                              {...(column.stage === 'done' ? { selected: picked.has(item.path), onSelect: (on: boolean) => pick(item, on) } : {})}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {droppable.placeholder}
                  </Stack>
                )}
              </Droppable>
            </ColumnFrame>
          );
        })}
      </BoardScroller>
    </DragDropContext>
  );
}

/**
 * What is the reader's to do on every list, as a board: not started, and started in any column of
 * its list. A card says which list it is on, and opens that list's tab; ticked off, it leaves.
 */
function OverviewBoard({ lists, onOpen }: { lists: TodoList[]; onOpen: (path: string) => void }) {
  const mine = useCommand<TodoMine[]>('todo-mine');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => onOutsideEdit(() => void mine.refetch()), [mine.refetch]);
  if (mine.loading && !mine.data) return <PageLoader />;
  if (mine.error) return <EmptyState title='Your items could not be read'>{mine.error.message}</EmptyState>;
  const items = mine.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState title='Nothing left for you'>
        {lists.length === 0
          ? "Make a list with New list in the bar's menu. Items given to you on any list, and those of your own lists given to nobody, gather here."
          : 'Items given to you on any list, and those of your own lists given to nobody, gather here.'}
      </EmptyState>
    );
  }
  const changed = () => void mine.refetch();
  const stages: { title: string; stage: TodoMine['stage'] }[] = [{ title: 'Todo', stage: 'todo' }, { title: 'In progress', stage: 'doing' }];
  return (
    <BoardScroller>
      {stages.map(({ title, stage }) => {
        const cards = items.filter((item) => item.stage === stage);
        return (
          <ColumnFrame key={stage} title={title} count={cards.length}>
            <Stack gap={6} px={8} pb={8} style={COLUMN_CARDS}>
              {cards.length === 0 && <Text size='xs' c='dimmed' px={4}>Nothing here.</Text>}
              {cards.map((item) => (
                <TodoCard
                  key={item.path}
                  item={item}
                  members={[]}
                  columns={[]}
                  expanded={expanded.has(item.path)}
                  onExpand={(open) =>
                    setExpanded((shown) => {
                      const next = new Set(shown);
                      if (open) next.add(item.path);
                      else next.delete(item.path);
                      return next;
                    })}
                  onChanged={changed}
                  aside={
                    <UnstyledButton onClick={() => onOpen(item.list)}>
                      <Group gap={4} wrap='nowrap'>
                        <TablerIcon name={item.group ? 'users' : 'list-check'} size={12} color='var(--mantine-color-dimmed)' />
                        <Text size='xs' c='dimmed' truncate>{stage === 'doing' ? `${item.listTitle} · ${item.columnTitle}` : item.listTitle}</Text>
                      </Group>
                    </UnstyledButton>
                  }
                />
              ))}
            </Stack>
          </ColumnFrame>
        );
      })}
    </BoardScroller>
  );
}
