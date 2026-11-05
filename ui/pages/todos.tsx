import { ActionIcon, Badge, Box, Button, Checkbox, Group, Loader, Menu, Paper, Popover, Stack, Tabs, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import {
  DragDropContext,
  Draggable,
  type DraggableLocation,
  type DraggableProvidedDragHandleProps,
  Droppable,
  type DroppableProvided,
  type DropResult,
} from '@hello-pangea/dnd';
import { Dialog, DialogActions, EmptyState, HatField, Markdown, PageBar, PageLoader, ScrollBox, TablerIcon } from '@ein/ui/components';
import { useCommand, usePhone } from '@ein/ui/hooks';
import { plainMarkdown, shq } from '@ein/ui/lib';
import { execCommand, loadUserConfig, notify, onOutsideEdit, openDialog, userConfigFlag } from '@ein/ui/signals';
import { useSignals } from '@preact/signals-react/runtime';
import { type CSSProperties, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoColumn, TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '../../lib/api.ts';
import { Face } from '../components/Face.tsx';
import { LinkChip } from '../components/LinkChip.tsx';
import { WIDGET_SETTING } from './widget.tsx';

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
/** Turn the reader's Todo widget on or off, and have it come or go at once. */
const setWidget = async (on: boolean) => {
  if (await run(`config set ${WIDGET_SETTING} ${on}`)) await loadUserConfig();
};

export default function TodosPage() {
  useSignals();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const listPath = params.get('list');
  const lists = useCommand<TodoList[]>('todo-lists');

  const open = (path: string | null) => setParams(path ? { list: path } : {});
  const [deleting, setDeleting] = useState<TodoList | null>(null);
  const [busy, setBusy] = useState(false);
  const widgetOn = userConfigFlag(WIDGET_SETTING, false);
  useEffect(() => onOutsideEdit(() => void lists.refetch()), [lists.refetch]);

  // For good, with every item and column; what the items link to stays where it is.
  const remove = async (list: TodoList) => {
    setBusy(true);
    if (await run(`rm -r ${shq(list.path)}`)) {
      notify({ message: `Deleted the list "${list.title}".`, color: 'green' });
      if (listPath === list.path) open(null);
      setDeleting(null);
      void lists.refetch();
    }
    setBusy(false);
  };

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
              widgetOn
                ? { label: 'Hide the todo widget', icon: 'pinned-filled', color: 'teal', button: true, onClick: () => void setWidget(false) }
                : { label: 'Show the todo widget', icon: 'pinned', button: true, onClick: () => void setWidget(true) },
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
                  rightSection={
                    // Not a button: the tab is one already. A click here deletes rather than opens.


                      <Box
                        component='span'
                        role='button'
                        aria-label={`Delete ${list.title}`}
                        title='Delete the list'
                        onClick={(event: MouseEvent<HTMLSpanElement>) => {
                          event.stopPropagation();
                          setDeleting(list);
                        }}
                        style={{ display: 'flex', opacity: .7, cursor: 'pointer' }}
                      >
                        <TablerIcon name='x' size={14} />
                      </Box>

                  }
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
      <Dialog opened={deleting !== null} onClose={() => setDeleting(null)} title='Delete the list?' icon='trash' pattern='danger' size='sm' floating>
        {deleting && (
          <Text size='sm'>
            <b>{deleting.title}</b> is deleted for good, with {deleting.total === 1 ? 'its item' : `its ${deleting.total} items`} and any it has archived
            {deleting.group ? `, for everyone in ${deleting.group}` : ''}. What they link to stays where it is. This cannot be undone.
          </Text>
        )}
        <DialogActions>
          <Button variant='default' onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color='red' loading={busy} onClick={() => deleting && void remove(deleting)}>Delete the list</Button>
        </DialogActions>
      </Dialog>
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
  const face = item.assignee ? <Face username={item.assignee} members={members} /> : <TablerIcon name='user-plus' size={16} color='white' />;
  if (members.length === 0) return null;
  return (
    <Menu shadow='md' position='bottom-end' withinPortal>
      <Menu.Target>
        <Tooltip label={who ? `Assigned to ${who}` : 'Assign to'}>
          <ActionIcon
            variant={item.assignee ? 'transparent' : 'subtle'}
            color='gray'
            radius='xl'
            size={26}
            aria-label={who ? `Assigned to ${who}` : 'Assign to'}
            style={item.assignee ? undefined : { border: '1px dashed rgb(255 255 255 / .8)' }}
          >
            {face}
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Assign to</Menu.Label>
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

/** What a card or a row is given. */
type CardProps = {
  item: TodoItem;
  members: TodoMember[];
  /** Whether the description is open whole. */
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  /** The card a link opened the page at: framed, and scrolled to. */
  highlighted?: boolean;
  onChanged: () => void;
  /** The stage of the column it is in: a row in a started one has a spinner. */
  stage: TodoColumn['stage'];
  dragHandle?: DraggableProvidedDragHandleProps | null;
  dragging?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  /** Before the title, as "<prefix> › <title>": the list a card on the Overview is on. */
  prefix?: string;
  /** What a click on the prefix does: open that list. */
  onPrefix?: () => void;
};

/** One item: a card on a board, a row of a list on a phone. */
function TodoCard(props: CardProps) {
  return usePhone() ? <TodoRow {...props} /> : <BoardCard {...props} />;
}

/**
 * One item as a card. Its heading: the title (after `prefix`, on the Overview its list), the pencil
 * that opens the item's dialog, the due day once it has one, and the face of whoever is to do it;
 * the pencil, and the calendar of an item with no day, show while the card is hovered or focused. Under it the description's first line, ending in an ellipsis whenever more follows,
 * which a click opens whole as markdown and another folds; and last what the item links to.
 * `onSelect` gives it a box to pick it by.
 */
function BoardCard({ item, members, expanded, onExpand, highlighted, onChanged, dragHandle, dragging, selected, onSelect, prefix, onPrefix }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const overdue = !item.done && item.due !== undefined && item.due < today();
  const tools = hovered || focused || dueOpen;
  const tint = ageColor(item);

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
      shadow={dragging || hovered ? 'md' : undefined}
      bg='var(--mrx-surface-raised)'
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
      style={{
        cursor: dragHandle ? 'grab' : undefined,
        position: 'relative',
        overflow: 'hidden',
        borderColor: highlighted ? CARD_EDGE_HIGHLIGHTED : hovered ? CARD_EDGE_HOVERED : CARD_EDGE,
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {/* Top-aligned, so a title of several lines keeps its buttons by its first line; the margins centre that line, and the box, on the face (26px). */}
      <Group
        gap={6}
        wrap='nowrap'
        align='flex-start'
        px='xs'
        py={6}
        title={addedLabel(item)}
        style={{ ...CARD_BAND, background: tint.ground, filter: hovered ? 'brightness(1.3)' : undefined }}
      >
        <HatField pattern='neutral' kind='foot' color={tint.tiles} />
        <Box aria-hidden style={CARD_BAND_SHADE} />
        {onSelect && <Checkbox mt={5} size='xs' checked={selected ?? false} onChange={(event) => onSelect(event.currentTarget.checked)} aria-label={`Pick ${item.title}`} />}
        <Text
          size='md'
          fw={500}
          lineClamp={3}
          td={item.done ? 'line-through' : undefined}
          c={item.done ? 'dimmed' : undefined}
          title={item.done && (item.doneBy || item.doneAt) ? doneLabel(item, members) : undefined}
          mt={1}
          style={{ flex: 1, minWidth: 0 }}
        >
          {prefix && (
            <Text
              span
              inherit
              c='dimmed'
              onClick={onPrefix && ((event: MouseEvent<HTMLSpanElement>) => {
                event.stopPropagation();
                onPrefix();
              })}
              style={onPrefix ? { cursor: 'pointer' } : undefined}
            >
              {prefix} ›{' '}
            </Text>
          )}
          {item.title}
        </Text>
        <Group gap={2} wrap='nowrap' align='center' style={{ flex: 'none', filter: CARD_BAND_ICON_SHADOW }}>
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
      {(item.description || item.links) && (
        <Box px='xs' pt={6} pb='xs'>
          {item.description && (
            // Not a button: a drag cannot start on one.
            <Box onClick={toggle} style={{ cursor: 'pointer' }} aria-expanded={expanded}>
              {expanded
                ? (
                  <Box fz='sm'>
                    <Markdown content={item.description} breaks />
                  </Box>
                )
                : <Text size='sm' c='dimmed' lineClamp={1}>{firstLine(item.description)}</Text>}
            </Box>
          )}
          {item.links && (
            <Group gap={6} mt={item.description ? 6 : 0}>
              {item.links.map((link) => <LinkChip key={link.path} link={link} />)}
            </Group>
          )}
        </Box>
      )}
    </Paper>
  );
}

/**
 * One item as a row of a list, as a phone shows a board: a box that ticks it off, moving it to Done,
 * and unticked moves it back; a spinner while it is in a started column (neither Todo nor Done); its
 * title; at the right its due day, whoever is to do it, the pencil, and a chevron that unfolds its
 * description when it has one; under the title what it links to, as their covers alone. The row is
 * what is lifted to move it. A line parts it from the next.
 */
function TodoRow({ item, members, expanded, onExpand, highlighted, onChanged, stage, dragHandle, dragging, prefix, onPrefix }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const overdue = !item.done && item.due !== undefined && item.due < today();

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const setDue = async (day: string) => {
    if (await run(`todo-set ${shq(item.path)} ${day ? `--due ${shq(day)}` : '--no-due'}`)) onChanged();
  };
  const tick = async (done: boolean) => {
    setBusy(true);
    if (await run(`todo-done ${done ? '' : '--undo '}${shq(item.path)}`)) onChanged();
    setBusy(false);
  };
  const edit = () => openDialog(`/todos/item?path=${encodeURIComponent(item.path)}`);

  return (
    <Box
      ref={ref}
      {...dragHandle}
      px='sm'
      py={10}
      title={item.done && (item.doneBy || item.doneAt) ? doneLabel(item, members) : undefined}
      style={{
        borderBottom: COLUMN_RULE,
        background: dragging ? 'var(--mrx-surface-raised)' : highlighted ? 'color-mix(in srgb, var(--mantine-primary-color-filled) 14%, transparent)' : undefined,
        boxShadow: dragging ? 'var(--mantine-shadow-md)' : highlighted ? 'inset 3px 0 0 var(--mantine-primary-color-filled)' : undefined,
      }}
    >
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <Checkbox
          size='md'
          radius='xl'
          mt={1}
          checked={item.done}
          disabled={busy}
          onChange={(event) => void tick(event.currentTarget.checked)}
          aria-label={item.done ? `${item.title}: not done after all` : `${item.title}: done`}
        />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap='nowrap' align='flex-start'>
            {stage === 'doing' && !item.done && <Loader size={14} mt={5} style={{ flex: 'none' }} aria-label='Ongoing' />}
            <Text size='md' lineClamp={3} td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined} style={{ flex: 1, minWidth: 0 }}>
              {prefix && (
                <Text
                  span
                  inherit
                  c='dimmed'
                  onClick={onPrefix && ((event: MouseEvent<HTMLSpanElement>) => {
                    event.stopPropagation();
                    onPrefix();
                  })}
                >
                  {prefix} ›{' '}
                </Text>
              )}
              {item.title}
            </Text>
          </Group>
          {item.description && expanded && (
            <Box fz='sm' mt={4}>
              <Markdown content={item.description} breaks />
            </Box>
          )}
          {item.links && (
            <Group gap={6} mt={6}>
              {item.links.map((link) => <LinkChip key={link.path} link={link} bare />)}
            </Group>
          )}
        </Box>
        <Group gap={2} wrap='nowrap' align='center' style={{ flex: 'none' }}>
          <DueControl value={item.due ?? ''} overdue={overdue} onChange={(day) => void setDue(day)} opened={dueOpen} onOpened={setDueOpen} />
          <AssigneeButton item={item} members={members} onChanged={onChanged} />
          <ActionIcon variant='subtle' color='gray' size='md' aria-label={`Change ${item.title}`} onClick={edit}>
            <TablerIcon name='pencil' size={16} />
          </ActionIcon>
          {item.description && (
            <ActionIcon
              variant='subtle'
              color='gray'
              size='md'
              aria-label={expanded ? 'Fold the description' : 'Show the description'}
              aria-expanded={expanded}
              onClick={() => onExpand(!expanded)}
            >
              <TablerIcon name='chevron-down' size={16} style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }} />
            </ActionIcon>
          )}
        </Group>
      </Group>
    </Box>
  );
}

/** A card's border; the accent for the card a link opened the page at. */
const CARD_EDGE = 'var(--mantine-color-default-border)';
const CARD_EDGE_HIGHLIGHTED = 'var(--mantine-primary-color-filled)';
/** A card's border while the pointer is over it, which also casts a shadow and brightens its heading. */
const CARD_EDGE_HOVERED = 'var(--mantine-color-dark-2)';

/** The band a card's heading stands on, in the card's age colour (`ageColor`), its hat field behind the heading. */
const CARD_BAND = {
  position: 'relative',
  overflow: 'hidden',
  isolation: 'isolate',
  transition: 'filter 120ms ease',
  // A dark edge under the heading's light text and icons, so they read over any tile.
  textShadow: '0 1px 2px rgb(0 0 0 / .9)',
} as const;

/**
 * A shade over a card's band, ground and tiles alike, behind the heading: near black over its
 * left, where the title is, giving way to the band's own colour only towards its right edge.
 */
const CARD_BAND_SHADE = {
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  pointerEvents: 'none',
  background: 'linear-gradient(90deg, rgb(0 0 0 / .85), rgb(0 0 0 / .7) 40%, rgb(0 0 0 / .3) 70%, transparent 90%)',
} as const;

/** The same dark edge for the heading's buttons and faces, which a text shadow does not reach. */
const CARD_BAND_ICON_SHADOW = 'drop-shadow(0 1px 1.5px rgb(0 0 0 / .85))';

/** How long a card takes to turn from green to red, in days. */
const AGE_SPAN = 28;

/**
 * The colour of a card's band by how long it has been on the board: green when added today, through
 * yellow, to red at `AGE_SPAN` days and after; a done card, or one whose file says nothing of when it
 * was made, grey. The band is the dark `ground`, solid, so the title reads on it, and its tiles a
 * lighter shade of the same hue.
 */
const ageColor = (item: TodoItem): { ground: string; tiles: string } => {
  if (item.done || !item.added) return { ground: 'hsl(220 8% 16%)', tiles: 'hsl(220 8% 30%)' };
  const days = Math.max(0, (Date.now() - Date.parse(item.added)) / 86_400_000);
  const hue = Math.round(130 * (1 - Math.min(1, days / AGE_SPAN)));
  return { ground: `hsl(${hue} 35% 14%)`, tiles: `hsl(${hue} 40% 30%)` };
};

/** When a card was added, in words, for its band's hover. */
const addedLabel = (item: TodoItem): string | undefined =>
  item.added ? `Added ${new Date(item.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : undefined;

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

/**
 * The board: all of the page under the bar, on the page's own ground as the open tab is, its columns side by side sharing its width and filling
 * its height, sideways when they do not fit; on a phone stacked, the board scrolling down as one.
 */
function BoardScroller({ children }: { children: ReactNode }) {
  const phone = usePhone();
  return (
    <Box
      h='100%'
      style={phone ? { overflowY: 'auto' } : { display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden' }}
    >
      {children}
    </Box>
  );
}

/** The line between two columns. */
const COLUMN_RULE = '1px solid var(--mantine-color-default-border)';

/**
 * A column: its heading — the title, how many cards it holds, `edit` beside them (on a desktop while
 * the heading is hovered or what `edit` opens is open, `editing`), `controls` at the right — a line
 * under it short of the column's edges, its cards, and a `footer` under them. It is ruled off from
 * the column before it (`index`). Side by side the columns share the board's width, none narrower
 * than 260px and none wider for what is in it (a card dropped in leaves every column as wide as it
 * was); stacked on a phone each is as tall as its cards.
 */
function ColumnFrame({ index, title, count, edit, editing, controls, footer, children }: {
  index: number;
  title: string;
  count: number;
  edit?: ReactNode;
  editing?: boolean;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  const [hovered, setHovered] = useState(false);
  const rule = index === 0 ? {} : phone ? { borderTop: COLUMN_RULE } : { borderLeft: COLUMN_RULE };
  const editShown = phone || hovered || editing;
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...rule, ...(phone ? {} : { flex: '1 0 260px', minWidth: 0 }) }}>
      <Group gap={6} wrap='nowrap' px='sm' py={8} style={{ flex: 'none' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <Text fw={600} size='sm' truncate style={{ minWidth: 0 }}>{title}</Text>
        <Badge size='sm' variant='light' color='gray' radius='sm' style={{ flex: 'none' }}>{count}</Badge>
        {edit && <Box style={{ display: 'flex', opacity: editShown ? 1 : 0, pointerEvents: editShown ? undefined : 'none', transition: 'opacity 120ms ease' }}>{edit}</Box>}
        <Box style={{ flex: 1 }} />
        {controls}
      </Group>
      <Box mx='sm' style={{ flex: 'none', borderBottom: COLUMN_RULE }} />
      {children}
      {footer && <Box px={8} pb={8} style={{ flex: 'none' }}>{footer}</Box>}
    </Box>
  );
}

/**
 * A column's cards, the drop target `droppable` gives them: side by side a box that takes what the
 * heading and footer leave and scrolls with the app's own scrollbar over its edge, which takes no
 * width and so reflows nothing as it comes and goes; stacked on a phone, as tall as its rows, edge to edge.
 */
function ColumnCards({ droppable, children }: { droppable: DroppableProvided; children: ReactNode }) {
  const phone = usePhone();
  const style: CSSProperties = { position: 'relative', ...(phone ? { minHeight: 48 } : { padding: 8 }) };
  if (phone) return <div ref={droppable.innerRef} {...droppable.droppableProps} style={style}>{children}</div>;
  return (
    <ScrollBox frameStyle={{ flex: 1, minHeight: 0 }} viewportRef={droppable.innerRef} {...droppable.droppableProps} style={style}>
      {children}
    </ScrollBox>
  );
}

/** One of the phone's panel's targets: a column by name; `disabled` takes no drop. */
type PanelTarget = { id: string; title: string; disabled?: boolean };

/**
 * The panel target under the pointer or finger while `lifted`, as a ref the drop reads and as
 * state the panel lights by. It is found from where the pointer is, not from where the drag
 * library places the card, since its estimate for targets fixed on the screen is off by tens of
 * pixels; a finger on a name is what is meant.
 */
function usePanelTarget(lifted: boolean): { over: string | null; overRef: { current: string | null } } {
  const [over, setOver] = useState<string | null>(null);
  const overRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lifted) {
      overRef.current = null;
      setOver(null);
      return;
    }
    const at = (x: number, y: number) => {
      const tile = [...document.querySelectorAll<HTMLElement>('[data-panel-target]')].find((each) => {
        const box = each.getBoundingClientRect();
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      });
      const id = tile && tile.dataset.disabled === undefined ? tile.dataset.panelTarget ?? null : null;
      overRef.current = id;
      setOver(id);
    };
    const onMouse = (event: globalThis.MouseEvent) => at(event.clientX, event.clientY);
    const onTouch = (event: TouchEvent) => event.touches[0] && at(event.touches[0].clientX, event.touches[0].clientY);
    globalThis.addEventListener('mousemove', onMouse);
    globalThis.addEventListener('touchmove', onTouch);
    return () => {
      globalThis.removeEventListener('mousemove', onMouse);
      globalThis.removeEventListener('touchmove', onTouch);
    };
  }, [lifted]);
  return { over, overRef };
}

/**
 * On a phone, while a card is lifted, a panel at the foot of the screen with a target for every
 * column, by name: a card let go over one goes to the end of that column, with no dragging down the
 * stacked board. The targets fill it two to a row, edge to edge with a line between, one alone on
 * the last row taking all of it. `over` is the one under the pointer, lit; a `disabled` one is faded
 * and takes none.
 */
function DropPanel({ targets, over }: { targets: PanelTarget[]; over: string | null }) {
  return (
    <Box
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: 300,
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        // The gap shows the ground through as the lines between the targets.
        gap: 1,
        background: 'var(--mantine-color-default-border)',
        borderTop: COLUMN_RULE,
        boxShadow: 'var(--mantine-shadow-lg)',
      }}
    >
      {targets.map((target, index) => (
        <Box
          key={target.id}
          data-panel-target={target.id}
          data-disabled={target.disabled || undefined}
          px='md'
          style={{
            gridColumn: index === targets.length - 1 && targets.length % 2 === 1 ? '1 / -1' : undefined,
            minHeight: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: over === target.id ? 'var(--mantine-primary-color-filled)' : 'var(--mrx-surface-chrome)',
            opacity: target.disabled ? .4 : 1,
          }}
        >
          <Text size='md' fw={600} truncate c={over === target.id ? 'white' : undefined}>{target.title}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The pencil in a column's heading: a popover with the column's title, saved as the folder's `name`
 * attr, and, for a column of the list's own making, Left and Right, which write every such column's
 * `order` attr in the new order, and Delete, which takes the folder away once no card is left in it;
 * Done and Todo stay where they are.
 */
function ColumnMenu({ column, columns, count, onChanged, onOpen }: {
  column: TodoColumn;
  columns: TodoColumn[];
  count: number;
  onChanged: () => void;
  /** Told the column's path when its popover opens and null when it closes, so the pencil stays in sight meanwhile. */
  onOpen?: (path: string | null) => void;
}) {
  const [opened, setOpened] = useState(false);
  useEffect(() => onOpen?.(opened ? column.path : null), [opened]);
  // The list's own columns, between Todo and Done, which are all that move.
  const own = columns.filter((each) => each.stage === 'doing');
  const at = own.findIndex((each) => each.path === column.path);
  /** Swap this column with its neighbour `by` places along, and number every own column in the new order. */
  const move = async (by: -1 | 1) => {
    const order = [...own];
    [order[at], order[at + by]] = [order[at + by], order[at]];
    setBusy(true);
    if (await run(order.map((each, index) => `attrs ${shq(each.path)} -J order=${index + 1}`).join(' && '))) onChanged();
    setBusy(false);
  };
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
        <Tooltip label={column.stage === 'doing' ? 'Rename, move or delete the column' : 'Rename the column'}>
          <ActionIcon variant='subtle' color='gray' size='sm' aria-label={`Change ${column.title}`} onClick={() => setOpened((shown) => !shown)}>
            <TablerIcon name='pencil' size={14} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack component='form' onSubmit={submit} gap='xs' w={240}>
          <TextInput size='xs' label='Column name' value={name} onChange={(event) => setName(event.currentTarget.value)} data-autofocus />
          {column.stage === 'doing' && own.length > 1 && (
            <Group gap='xs' grow>
              <Button size='xs' variant='default' leftSection={<TablerIcon name='arrow-left' size={14} />} onClick={() => void move(-1)} disabled={busy || at === 0}>
                Left
              </Button>
              <Button
                size='xs'
                variant='default'
                rightSection={<TablerIcon name='arrow-right' size={14} />}
                onClick={() => void move(1)}
                disabled={busy || at === own.length - 1}
              >
                Right
              </Button>
            </Group>
          )}
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

/**
 * What is typed into the add line as an item: the first line with anything on it the title, the
 * lines after it the description, blank ones at its top and foot left out.
 */
const splitTyped = (text: string): { title: string; description: string } => {
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim());
  const rest = lines.slice(first + 1);
  while (rest.length > 0 && !rest[0].trim()) rest.shift();
  while (rest.length > 0 && !rest[rest.length - 1].trim()) rest.pop();
  return { title: first === -1 ? '' : lines[first].trim(), description: rest.join('\n') };
};

/**
 * The line at the foot of Todo that adds an item. It takes several lines, pasted or with
 * Shift+Enter: the first is the title and the rest the description. Enter adds it and leaves the
 * line for the next.
 */
function AddCard({ list, onAdded }: { list: string; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { title, description } = splitTyped(text);

  const add = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!title) return;
    setBusy(true);
    if (await run(`todo-add ${shq(list)} ${shq(title)}${description ? ` --description ${shq(description)}` : ''}`)) {
      setText('');
      onAdded();
    }
    setBusy(false);
  };

  return (
    <Box component='form' onSubmit={add}>
      <Textarea
        size='sm'
        placeholder='Add an item'
        autosize
        minRows={1}
        maxRows={8}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void add();
        }}
        disabled={busy}
        aria-label='New item: the first line its title, the rest its description'
        title='Shift+Enter for a new line: the first line is the title, the rest the description'
        leftSection={<TablerIcon name='plus' size={14} />}
        rightSection={
          <ActionIcon type='submit' variant='subtle' size='sm' loading={busy} disabled={!title} aria-label='Add'>
            <TablerIcon name='corner-down-left' size={14} />
          </ActionIcon>
        }
      />
    </Box>
  );
}

/** Where a dragged card would land: its column, and the top and height of its frame there. */
type Landing = { column: string; top: number; height: number; inset: number };

/**
 * The space under each card on a board; none under a phone's rows, which a line parts. It is the
 * draggable's own padding rather than the column's gap, so that the room a drag opens, which is the
 * draggable's height, has it under the card too.
 */
const CARD_SPACE = 6;
const cardSpace = (phone: boolean): number => phone ? 0 : CARD_SPACE;

/**
 * Where the card `draggableId` would land at `destination`, measured from the board as it is drawn:
 * under the column's padding and the cards before that place, as tall as the card without the space
 * under it, as wide as the column's padding leaves. Undefined when it is over no column.
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
  const space = parseFloat(getComputedStyle(dragged).paddingBottom) || 0;
  return { column: destination.droppableId, top, height: dragged.getBoundingClientRect().height - space, inset: parseFloat(style.paddingLeft) || 0 };
};

/** A dashed frame the size of a dragged card where it would land. */
function LandingFrame({ landing }: { landing: Landing }) {
  return (
    <Box
      aria-hidden
      style={{
        position: 'absolute',
        top: landing.top,
        left: landing.inset,
        right: landing.inset,
        height: landing.height,
        boxSizing: 'border-box',
        border: '2px dashed var(--mantine-color-dimmed)',
        borderRadius: 'var(--mantine-radius-sm)',
        pointerEvents: 'none',
      }}
    />
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
  const [landing, setLanding] = useState<Landing | null>(null);
  const phone = usePhone();
  // Whether a card is lifted on a phone, which brings up the panel of columns to drop it on.
  const [lifted, setLifted] = useState(false);
  const { over: overPanel, overRef: panelRef } = usePanelTarget(lifted);
  // The column whose pencil's popover is open.
  const [editing, setEditing] = useState<string | null>(null);
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

  const drop = async ({ source, destination: over, draggableId }: DropResult) => {
    setLanding(null);
    // A card let go over the phone's panel goes to the end of the column it names.
    const panel = panelRef.current;
    setLifted(false);
    const destination = panel ? { droppableId: panel, index: (arranged[panel] ?? []).filter((each) => each !== draggableId).length } : over;
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
      onBeforeCapture={() => setLifted(phone)}
      onDragStart={(start) => setLanding(landingOf(start.draggableId, start.source))}
      onDragUpdate={(update) => setLanding(landingOf(update.draggableId, update.destination))}
      onDragEnd={(result) => void drop(result)}
    >
      {lifted && <DropPanel targets={columns.map((column) => ({ id: column.path, title: column.title }))} over={overPanel} />}
      <BoardScroller>
        {columns.map((column, index) => {
          const cards = cardsOf(column);
          return (
            <ColumnFrame
              key={column.path}
              index={index}
              title={column.title}
              count={cards.length}
              edit={column.stage !== 'todo' && <ColumnMenu column={column} columns={columns} count={cards.length} onChanged={changed} onOpen={setEditing} />}
              editing={editing === column.path}
              controls={column.stage === 'done' && doneControls}
              footer={column.stage === 'todo' && <AddCard list={list.path} onAdded={changed} />}
            >
              <Droppable droppableId={column.path}>
                {(droppable) => (
                  <ColumnCards droppable={droppable}>
                    {cards.map((item, index) => (
                      <Draggable key={item.path} draggableId={item.path} index={index}>
                        {(draggable, drag) => (
                          <div ref={draggable.innerRef} {...draggable.draggableProps} style={{ ...draggable.draggableProps.style, paddingBottom: cardSpace(phone) }}>
                            <TodoCard
                              item={item}
                              members={people}
                              expanded={expanded.has(item.path)}
                              highlighted={item.path === highlight}
                              onExpand={(open) =>
                                expand(item, open)}
                              onChanged={changed}
                              stage={column.stage}
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
                    {landing?.column === column.path && <LandingFrame landing={landing} />}
                  </ColumnCards>
                )}
              </Droppable>
            </ColumnFrame>
          );
        })}
      </BoardScroller>
    </DragDropContext>
  );
}

/** An Overview column: the columns of one title on the reader's lists put together, and where each list has it. */
type MergedColumn = { key: string; title: string; stage: TodoColumn['stage']; paths: Map<string, string> };

/** What puts columns together: Todo with Todo, Done with Done, the others by their title, letter case aside. */
const mergeKey = (column: TodoColumn): string => column.stage === 'doing' ? `doing:${column.title.trim().toLocaleLowerCase()}` : column.stage;

const STAGE_RANK = { todo: 0, doing: 1, done: 2 } as const;

/** The columns of `lists` put together: Todo, every other title in the order first met, then Done. */
const mergeColumns = (lists: TodoList[]): MergedColumn[] => {
  const merged = new Map<string, MergedColumn>();
  for (const list of lists) {
    for (const column of list.columns ?? []) {
      const key = mergeKey(column);
      const entry = merged.get(key) ??
        { key, title: column.stage === 'todo' ? 'Todo' : column.stage === 'done' ? 'Done' : column.title, stage: column.stage, paths: new Map() };
      entry.paths.set(list.path, column.path);
      merged.set(key, entry);
    }
  }
  return [...merged.values()].sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage]);
};

/**
 * What is the reader's on every list, done too, as one board of their lists' columns put together
 * by title. A card's title starts with its list, which opens that list's tab. A card is dragged to
 * a column its own list has, and moved there on its list; a column its list lacks takes no drop.
 */
function OverviewBoard({ lists, onOpen }: { lists: TodoList[]; onOpen: (path: string) => void }) {
  const mine = useCommand<TodoMine[]>('todo-mine --done');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Where cards were dropped, by path, shown until the items are read again.
  const [dropped, setDropped] = useState<Record<string, string>>({});
  // The list of the card being dragged: the columns it lacks take no drop.
  const [dragList, setDragList] = useState<string | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const phone = usePhone();
  const { over: overPanel, overRef: panelRef } = usePanelTarget(phone && dragList !== null);
  useEffect(() => onOutsideEdit(() => void mine.refetch()), [mine.refetch]);
  useEffect(() => setDropped({}), [mine.data]);
  if (mine.loading && !mine.data) return <PageLoader />;
  if (mine.error) return <EmptyState title='Your items could not be read'>{mine.error.message}</EmptyState>;
  const items = mine.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState title='Nothing for you'>
        {lists.length === 0
          ? "Make a list with New list in the bar's menu. Items assigned to you on any list, and those of your own lists assigned to nobody, gather here."
          : 'Items assigned to you on any list, and those of your own lists assigned to nobody, gather here.'}
      </EmptyState>
    );
  }

  const changed = () => void mine.refetch();
  const columns = mergeColumns(lists.filter((list) => items.some((item) => item.list === list.path)));
  const keyOf = new Map(columns.flatMap((column) => [...column.paths.values()].map((path) => [path, column.key] as const)));
  const placed = (item: TodoMine): string => dropped[item.path] ?? keyOf.get(item.column) ?? item.stage;
  const listOf = (path: string) => items.find((item) => item.path === path)?.list ?? null;

  const drop = async ({ source, destination, draggableId }: DropResult) => {
    // A card let go over the phone's panel goes to the column it names.
    const key = panelRef.current ?? destination?.droppableId;
    setDragList(null);
    setLanding(null);
    if (!key || key === source.droppableId) return;
    const list = listOf(draggableId);
    const target = columns.find((column) => column.key === key)?.paths.get(list ?? '');
    if (!target) return;
    setDropped((shown) => ({ ...shown, [draggableId]: key }));
    if (await run(`todo-move ${shq(draggableId)} --column ${shq(target)}`)) changed();
    else setDropped({});
  };

  return (
    <DragDropContext
      onBeforeCapture={({ draggableId }) => setDragList(listOf(draggableId))}
      onDragStart={(start) => setLanding(landingOf(start.draggableId, start.source))}
      onDragUpdate={(update) => setLanding(update.destination?.droppableId === update.source.droppableId ? null : landingOf(update.draggableId, update.destination))}
      onDragEnd={(result) => void drop(result)}
    >
      {phone && dragList !== null && (
        <DropPanel targets={columns.map((column) => ({ id: column.key, title: column.title, disabled: !column.paths.has(dragList) }))} over={overPanel} />
      )}
      <BoardScroller>
        {columns.map((column, index) => {
          const cards = items.filter((item) => placed(item) === column.key);
          return (
            <ColumnFrame key={column.key} index={index} title={column.title} count={cards.length}>
              <Droppable droppableId={column.key} isDropDisabled={dragList !== null && !column.paths.has(dragList)}>
                {(droppable) => (
                  <ColumnCards droppable={droppable}>
                    {cards.map((item, at) => (
                      <Draggable key={item.path} draggableId={item.path} index={at}>
                        {(draggable, drag) => (
                          <div ref={draggable.innerRef} {...draggable.draggableProps} style={{ ...draggable.draggableProps.style, paddingBottom: cardSpace(phone) }}>
                            <TodoCard
                              item={item}
                              members={[]}
                              expanded={expanded.has(item.path)}
                              onExpand={(open) =>
                                setExpanded((shown) => {
                                  const next = new Set(shown);
                                  if (open) {
                                    next.add(item.path);
                                  } else next.delete(item.path);
                                  return next;
                                })}
                              onChanged={changed}
                              stage={item.stage}
                              dragHandle={draggable.dragHandleProps}
                              dragging={drag.isDragging}
                              prefix={item.listTitle}
                              onPrefix={() =>
                                onOpen(item.list)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {droppable.placeholder}
                    {landing?.column === column.key && <LandingFrame landing={landing} />}
                  </ColumnCards>
                )}
              </Droppable>
            </ColumnFrame>
          );
        })}
      </BoardScroller>
    </DragDropContext>
  );
}
