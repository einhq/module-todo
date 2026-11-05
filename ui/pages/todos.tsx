import { ActionIcon, Box, Button, Checkbox, Group, Menu, Paper, Popover, Stack, Tabs, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { DragDropContext, Draggable, type DraggableLocation, type DraggableProvidedDragHandleProps, Droppable, type DropResult } from '@hello-pangea/dnd';
import { EmptyState, HatField, Markdown, PageBar, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand, usePhone } from '@ein/ui/hooks';
import { plainMarkdown, shq } from '@ein/ui/lib';
import { execCommand, notify, onOutsideEdit, openDialog } from '@ein/ui/signals';
import { type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoColumn, TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '../../lib/api.ts';
import { Face } from '../components/Face.tsx';
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
          actions={{
            items: [
              { label: 'New list', icon: 'list-check', onClick: () => openDialog('/todos/new-list') },
              ...(listPath ? [{ label: 'New column', icon: 'layout-columns', onClick: () => openDialog(`/todos/new-column?list=${encodeURIComponent(listPath)}`) }] : []),
            ],
          }}
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
 * The due day on a card: once set, a small button that says it, red once it has passed; before
 * that a calendar. Either opens a date picker, which can take the day away again; `opened` is the
 * card's, so that it keeps the button in sight while the picker is open.
 */
function DueControl({ value, overdue, onChange, opened, onOpened }: {
  value: string;
  overdue: boolean;
  onChange: (day: string) => void;
  opened: boolean;
  onOpened: (opened: boolean) => void;
}) {
  const pick = (day: string) => {
    onChange(day);
    onOpened(false);
  };
  return (
    <Popover opened={opened} onChange={onOpened} position='bottom-end' shadow='md' withinPortal>
      <Popover.Target>
        {value
          ? (
            <Button
              variant={overdue ? 'filled' : 'light'}
              color={overdue ? 'red' : 'gray'}
              size='compact-xs'
              leftSection={<TablerIcon name='calendar' size={12} />}
              onClick={() => onOpened(!opened)}
              aria-label={`Due ${dueLabel(value)}; change the day`}
            >
              {dueLabel(value)}
            </Button>
          )
          : (
            <Tooltip label='Give it a due day'>
              <ActionIcon variant='subtle' color='gray' size='sm' aria-label='Give it a due day' onClick={() => onOpened(!opened)}>
                <TablerIcon name='calendar' size={15} />
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
 * One item as a card. Its heading: the title, the pencil that opens the item's dialog, the due day
 * once it has one, and the face of whoever is to do it; on a desktop the pencil, and the calendar
 * of an item with no day, show while the card is hovered or focused. Under it the description's
 * first line, ending in an ellipsis whenever more follows, which a click opens whole as markdown
 * and another folds; `aside`; and last what the
 * item links to. `onSelect` gives it a box to pick it by.
 */
function TodoCard({ item, members, expanded, onExpand, highlighted, onChanged, dragHandle, dragging, selected, onSelect, aside }: {
  item: TodoItem;
  members: TodoMember[];
  /** Whether the description is open whole. */
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  /** The card a link opened the page at: framed, and scrolled to. */
  highlighted?: boolean;
  onChanged: () => void;
  dragHandle?: DraggableProvidedDragHandleProps | null;
  dragging?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  aside?: ReactNode;
}) {
  const phone = usePhone();
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const overdue = !item.done && item.due !== undefined && item.due < today();
  const tools = phone || hovered || focused || dueOpen;

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const setDue = async (day: string) => {
    if (await run(`todo-set ${shq(item.path)} ${day ? `--due ${shq(day)}` : '--no-due'}`)) onChanged();
  };
  const edit = () => openDialog(`/todos/item?path=${encodeURIComponent(item.path)}`);
  const toggle = (event: MouseEvent<HTMLDivElement>) => {
    // A link in the description goes where it points, and leaves the description as it is.
    if ((event.target as HTMLElement).closest('a')) return;
    onExpand(!expanded);
  };

  return (
    <Paper
      ref={ref}
      withBorder
      radius='sm'
      p={0}
      shadow={dragging ? 'md' : undefined}
      bg='var(--mrx-surface-base)'
      {...dragHandle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) edit();
      }}
      style={{ cursor: dragHandle ? 'grab' : undefined, position: 'relative', overflow: 'hidden', borderColor: highlighted ? CARD_EDGE_HIGHLIGHTED : CARD_EDGE }}
    >
      {/* Top-aligned, so a title of several lines keeps its buttons by its first line; the margins centre that line, and the box, on the face (26px). */}
      <Group gap={6} wrap='nowrap' align='flex-start' px='xs' py={6} bg={highlighted ? CARD_EDGE_HIGHLIGHTED : CARD_EDGE}>
        {onSelect && <Checkbox mt={5} size='xs' checked={selected ?? false} onChange={(event) => onSelect(event.currentTarget.checked)} aria-label={`Pick ${item.title}`} />}
        <Text
          size='sm'
          fw={500}
          lineClamp={3}
          td={item.done ? 'line-through' : undefined}
          c={item.done ? 'dimmed' : undefined}
          title={item.done && (item.doneBy || item.doneAt) ? doneLabel(item, members) : undefined}
          mt={2}
          style={{ flex: 1, minWidth: 0 }}
        >
          {item.title}
        </Text>
        <Group gap={2} wrap='nowrap' align='center' style={{ flex: 'none' }}>
          {tools && (
            <Tooltip label='Change'>
              <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Change ${item.title}`} onClick={edit}>
                <TablerIcon name='pencil' size={15} />
              </ActionIcon>
            </Tooltip>
          )}
          {(item.due || tools) && <DueControl value={item.due ?? ''} overdue={overdue} onChange={(day) => void setDue(day)} opened={dueOpen} onOpened={setDueOpen} />}
          <AssigneeButton item={item} members={members} onChanged={onChanged} />
        </Group>
      </Group>
      {(item.description || aside || item.links) && (
        <>
          <Box style={CARD_FOOT}>
            <Box style={CARD_FOOT_FIELD}>
              <HatField pattern='neutral' kind='foot' />
            </Box>
          </Box>
          <Box px='xs' pt={6} pb='xs' style={{ position: 'relative' }}>
            {item.description && (
              // Not a button: a drag cannot start on one.
              <Box onClick={toggle} style={{ cursor: 'pointer' }} aria-expanded={expanded}>
                {expanded
                  ? (
                    <Box fz='sm'>
                      <Markdown content={item.description} breaks />
                    </Box>
                  )
                  : <Text size='xs' c='dimmed' lineClamp={1}>{firstLine(item.description)}</Text>}
              </Box>
            )}
            {aside && <Group gap={6} mt={item.description ? 6 : 0} wrap='wrap'>{aside}</Group>}
            {item.links && (
              <Group gap={6} mt={item.description || aside ? 6 : 0}>
                {item.links.map((link) => <LinkChip key={link.path} link={link} />)}
              </Group>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
}

/** A card's border, and the band its heading stands on. */
const CARD_EDGE = 'var(--mantine-color-default-border)';
const CARD_EDGE_HIGHLIGHTED = 'var(--mantine-primary-color-filled)';

/**
 * The grey tiles fading up from a card's foot, as the sidebar's do, lower: behind what the card
 * says under its heading, a shade darkening towards the foot, and over it the field, faint and
 * masked away towards the top.
 */
const CARD_FOOT = {
  position: 'absolute',
  inset: 'auto 0 0',
  height: 56,
  overflow: 'hidden',
  pointerEvents: 'none',
  background: 'linear-gradient(180deg, transparent, color-mix(in srgb, var(--mrx-surface-chrome) 30%, transparent))',
} as const;
const CARD_FOOT_FIELD = {
  position: 'absolute',
  inset: 0,
  opacity: .4,
  WebkitMaskImage: 'linear-gradient(to top, #000, transparent)',
  maskImage: 'linear-gradient(to top, #000, transparent)',
} as const;

/** A description's first line as plain text, with an ellipsis when more lines follow it; one cut short gets its own from the clamp. */
const firstLine = (description: string): string => {
  const [first, ...rest] = plainMarkdown(description).split('\n').filter((line) => line.trim());
  return rest.length > 0 ? `${first} …` : first ?? '';
};

/** Who ticked an item off and when, as far as its file says. */
const doneLabel = (item: TodoItem, members: TodoMember[]): string => {
  const who = item.doneBy ? ` by ${members.find((member) => member.username === item.doneBy)?.name ?? item.doneBy}` : '';
  return `Done${who}${item.doneAt ? `, ${new Date(item.doneAt).toLocaleString()}` : ''}`;
};

/** The board's scroller: its columns side by side, sharing its width and filling its height; sideways when they do not fit. */
function BoardScroller({ children }: { children: ReactNode }) {
  return (
    <Box p='md' h='100%' style={{ boxSizing: 'border-box' }}>
      {/* One rounded frame; the columns inside it meet edge to edge, and it clips their outer corners. */}
      <Box h='100%' style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', borderRadius: 'var(--mantine-radius-md)' }}>{children}</Box>
    </Box>
  );
}

/** The shades the columns take in turn, so that each stands apart from the next without a gap. */
const COLUMN_SHADES = ['var(--mrx-surface-raised)', 'color-mix(in srgb, var(--mrx-surface-raised) 50%, var(--mrx-surface-base))'];

/**
 * A column: its heading over its cards, which scroll on their own, and a `footer` under them that
 * stays in sight, in the shade of its place `index` on the board. Columns share the board's width,
 * none narrower than 260px; a phone shows one at a time with the next peeking in.
 */
function ColumnFrame({ index, title, count, controls, footer, children }: {
  index: number;
  title: string;
  count: number;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  return (
    <Paper
      radius={0}
      bg={COLUMN_SHADES[index % COLUMN_SHADES.length]}
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

/**
 * The pencil in a column's heading: a popover with the column's title, saved as the folder's `name`
 * attr, and, for a column of the list's own making, Delete, which takes the folder away once no
 * card is left in it; Done and Todo stay.
 */
function ColumnMenu({ column, count, onChanged }: { column: TodoColumn; count: number; onChanged: () => void }) {
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
  const remove = async () => {
    setBusy(true);
    if (await run(`rmdir ${shq(column.path)}`)) {
      setOpened(false);
      onChanged();
    }
    setBusy(false);
  };
  return (
    <Popover opened={opened} onChange={setOpened} position='bottom-end' shadow='md' trapFocus onOpen={() => setName(column.title)}>
      <Popover.Target>
        <Tooltip label='Rename or delete the column'>
          <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Change ${column.title}`} onClick={() => setOpened((shown) => !shown)}>
            <TablerIcon name='pencil' size={14} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack component='form' onSubmit={submit} gap='xs' w={240}>
          <TextInput size='xs' label='Column name' value={name} onChange={(event) => setName(event.currentTarget.value)} data-autofocus />
          <Group justify='space-between' gap='xs'>
            {column.stage === 'doing'
              ? (
                <Button size='xs' color='red' leftSection={<TablerIcon name='trash' size={14} />} onClick={() => void remove()} disabled={busy || count > 0}>
                  Delete
                </Button>
              )
              : <span />}
            <Button size='xs' type='submit' loading={busy} disabled={!name.trim()}>Save</Button>
          </Group>
          {column.stage === 'doing' && count > 0 && <Text size='xs' c='dimmed'>Move its cards out to delete it.</Text>}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** The line at the foot of Todo that adds an item: Enter adds it and leaves the line for the next. */
function AddCard({ list, onAdded }: { list: string; onAdded: () => void }) {
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

  return (
    <Box component='form' onSubmit={add}>
      <TextInput
        size='sm'
        placeholder='Add an item'
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        disabled={busy}
        aria-label='New item'
        leftSection={<TablerIcon name='plus' size={14} />}
        rightSection={
          <ActionIcon type='submit' variant='subtle' size='sm' loading={busy} disabled={!title.trim()} aria-label='Add'>
            <TablerIcon name='corner-down-left' size={14} />
          </ActionIcon>
        }
      />
    </Box>
  );
}

/** Where a dragged card would land: its column, and the top and height of its frame there. */
type Landing = { column: string; top: number; height: number };

/**
 * The space under each card on a board. It is the draggable's own padding rather than the column's
 * gap, so that the room a drag opens, which is the draggable's height, has it under the card too.
 */
const CARD_SPACE = 6;

/**
 * Where the card `draggableId` would land at `destination`, measured from the board as it is drawn:
 * under the column's padding and the cards before that place, as tall as the card without the space
 * under it. Undefined when it is over no column.
 */
const landingOf = (draggableId: string, destination: DraggableLocation | null | undefined): Landing | null => {
  if (!destination) return null;
  const dragged = document.querySelector<HTMLElement>(`[data-rfd-draggable-id="${CSS.escape(draggableId)}"]`);
  const column = document.querySelector<HTMLElement>(`[data-rfd-droppable-id="${CSS.escape(destination.droppableId)}"]`);
  if (!dragged || !column) return null;
  const style = getComputedStyle(column);
  const others = [...column.querySelectorAll<HTMLElement>(':scope > [data-rfd-draggable-id]')].filter((each) => each !== dragged);
  let top = parseFloat(style.paddingTop) || 0;
  for (const each of others.slice(0, destination.index)) top += each.getBoundingClientRect().height;
  return { column: destination.droppableId, top, height: dragged.getBoundingClientRect().height - CARD_SPACE };
};

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
  const [landing, setLanding] = useState<Landing | null>(null);
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
    setLanding(null);
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
    <DragDropContext
      onDragStart={(start) => setLanding(landingOf(start.draggableId, start.source))}
      onDragUpdate={(update) => setLanding(landingOf(update.draggableId, update.destination))}
      onDragEnd={(result) => void drop(result)}
    >
      <BoardScroller>
        {columns.map((column, index) => {
          const cards = cardsOf(column);
          return (
            <ColumnFrame
              key={column.path}
              index={index}
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
                {(droppable) => (
                  <Stack
                    ref={droppable.innerRef}
                    {...droppable.droppableProps}
                    gap={0}
                    px={8}
                    pb={8}
                    style={{ ...COLUMN_CARDS, position: 'relative' }}
                  >
                    {cards.map((item, index) => (
                      <Draggable key={item.path} draggableId={item.path} index={index}>
                        {(draggable, drag) => (
                          <div ref={draggable.innerRef} {...draggable.draggableProps} style={{ ...draggable.draggableProps.style, paddingBottom: CARD_SPACE }}>
                            <TodoCard
                              item={item}
                              members={people}
                              expanded={expanded.has(item.path)}
                              highlighted={item.path === highlight}
                              onExpand={(open) =>
                                expand(item, open)}
                              onChanged={changed}
                              dragHandle={draggable.dragHandleProps}
                              dragging={drag.isDragging}
                              {...(column.stage === 'done'
                                ? {
                                  selected: picked.has(item.path),
                                  onSelect: (on: boolean) =>
                                    pick(item, on),
                                }
                                : {})}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {droppable.placeholder}
                    {landing?.column === column.path && (
                      <Box
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: landing.top,
                          left: 8,
                          right: 8,
                          height: landing.height,
                          border: '2px dashed var(--mantine-color-dimmed)',
                          borderRadius: 'var(--mantine-radius-sm)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
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
      {stages.map(({ title, stage }, index) => {
        const cards = items.filter((item) => item.stage === stage);
        return (
          <ColumnFrame key={stage} index={index} title={title} count={cards.length}>
            <Stack gap={6} px={8} pb={8} style={COLUMN_CARDS}>
              {cards.length === 0 && <Text size='xs' c='dimmed' px={4}>Nothing here.</Text>}
              {cards.map((item) => (
                <TodoCard
                  key={item.path}
                  item={item}
                  members={[]}
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
