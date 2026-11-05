import { ActionIcon, Button, Checkbox, Group, Indicator, Paper, ScrollArea, Stack, Text, Transition, UnstyledButton } from '@mantine/core';
import { useClickOutside, useViewportSize } from '@mantine/hooks';
import { useSignals } from '@preact/signals-react/runtime';
import { TablerIcon } from '@ein/ui/components';
import { useCommand, useShownNode } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { dialogPath, execCommand, noteOutsideEdit, notify, onOutsideEdit, openDialog, pageShown, userConfigFlag } from '@ein/ui/signals';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import type { TodoMine } from '../../lib/api.ts';

/** The setting that shows the widget, the reader's own; the Todo page's button sets it. */
export const WIDGET_SETTING = 'CFG_USER_TODO_WIDGET';

/** The button's size and the least room it keeps from the window's edges, in px. */
const SIZE = 48;
const EDGE = 8;

/** How far a press moves before it is a drag rather than a click, in px. */
const DRAG = 6;

/** Where the button stands: its distance from the window's right and bottom edges, so it keeps its corner as the window changes. */
type Place = { right: number; bottom: number };

const PLACE_KEY = 'todo.widget.place';
const START: Place = { right: 24, bottom: 96 };

const savedPlace = (): Place => {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
    if (typeof saved?.right === 'number' && typeof saved?.bottom === 'number') return saved;
  } catch {
    // Storage may be out of reach (a private window); the button starts where it starts.
  }
  return START;
};

const savePlace = (place: Place) => {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // Not kept, then; it stays where it was put until the page is loaded again.
  }
};

/** `place` kept inside a window of `width` by `height`. */
const within = (place: Place, width: number, height: number): Place => ({
  right: Math.min(Math.max(place.right, EDGE), Math.max(EDGE, width - SIZE - EDGE)),
  bottom: Math.min(Math.max(place.bottom, EDGE), Math.max(EDGE, height - SIZE - EDGE)),
});

/** What the node on screen is called: as a todo's link to it says, else as the page names it, else its last segment. */
const nodeTitle = (node: string, about: TodoMine[]): string => {
  const link = about.flatMap((item) => item.links ?? []).find((each) => each.target === node);
  if (link) return link.title;
  const shown = pageShown();
  return (shown?.node === node ? shown.title : undefined) ?? node.split('/').pop() ?? node;
};

/**
 * `/todo-widget`, a `shell.float` panel: while the reader's Todo widget setting is on, a round
 * button floating over every page and the lightbox, which they drag where they like. Its badge
 * counts the open todos about the node on screen — the picture in the lightbox, the album, person
 * or place the page is about — on any list they can see. Pressed, it slides out a menu of them,
 * each to tick off or open, with New todo, which links the new one to the node; with none, it opens
 * New todo at once.
 */
export default function TodoWidget() {
  useSignals();
  if (!userConfigFlag(WIDGET_SETTING, false)) return null;
  return <Widget />;
}

function Widget() {
  const node = useShownNode();
  // Every open todo about anything, read once and again after a change: stepping through the
  // lightbox then counts each picture's without a command.
  const linked = useCommand<TodoMine[]>('todo-about');
  const about = node ? (linked.data ?? []).filter((item) => item.links?.some((link) => link.target === node)) : [];
  useEffect(() => onOutsideEdit(() => void linked.refetch()), [linked.refetch]);
  // A todo added or changed in a dialog opened from here: read again when it closes.
  const dialog = dialogPath.value;
  const hadDialog = useRef(false);
  useEffect(() => {
    if (dialog) hadDialog.current = true;
    else if (hadDialog.current) {
      hadDialog.current = false;
      void linked.refetch();
    }
  }, [dialog]);

  const { width, height } = useViewportSize();
  const [place, setPlace] = useState(savedPlace);
  const shown = width > 0 ? within(place, width, height) : place;
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  useClickOutside(() => setOpen(false), null, [button, menu]);
  const press = useRef<{ x: number; y: number; from: Place; dragged: boolean } | null>(null);

  const newTodo = () => {
    setOpen(false);
    openDialog('/todos/new?stay=1');
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, from: shown, dragged: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const pressed = press.current;
    if (!pressed) return;
    const dx = event.clientX - pressed.x;
    const dy = event.clientY - pressed.y;
    if (!pressed.dragged && Math.hypot(dx, dy) < DRAG) return;
    pressed.dragged = true;
    setPlace(within({ right: pressed.from.right - dx, bottom: pressed.from.bottom - dy }, width, height));
  };
  const onPointerUp = () => {
    const pressed = press.current;
    press.current = null;
    if (!pressed) return;
    if (pressed.dragged) return savePlace(shown);
    if (about.length === 0) return newTodo();
    setOpen((was) => !was);
  };

  // The menu opens towards the middle of the window: below a button in its upper half, above one
  // in its lower half, and on the side of the button towards the window's nearer edge.
  const below = height - shown.bottom - SIZE / 2 < height / 2;
  const rightSide = shown.right + SIZE / 2 < width / 2;
  const menuWidth = Math.min(340, width - 2 * EDGE);

  return (
    <>
      <Indicator
        label={about.length}
        size={20}
        offset={6}
        color='teal'
        disabled={about.length === 0}
        zIndex={1}
        style={{ position: 'fixed', right: shown.right, bottom: shown.bottom }}
      >
        <ActionIcon
          ref={setButton}
          size={SIZE}
          radius='50%'
          variant='filled'
          color='dark'
          aria-label={about.length > 0 ? `${about.length} todo${about.length === 1 ? '' : 's'} about this` : node ? 'New todo about this' : 'New todo'}
          title={about.length > 0 ? 'Todos about this' : node ? 'New todo about this' : 'New todo'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (press.current = null)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (about.length === 0) newTodo();
            else setOpen((was) => !was);
          }}
          style={{ touchAction: 'none', boxShadow: 'var(--mantine-shadow-lg)', border: '1px solid var(--mrx-surface-raised)' }}
        >
          <TablerIcon name='list-check' size={24} />
        </ActionIcon>
      </Indicator>
      <Transition mounted={open && about.length > 0} transition={below ? 'slide-down' : 'slide-up'} duration={160}>
        {(styles) => (
          <Paper
            ref={setMenu}
            shadow='lg'
            radius='md'
            p='xs'
            style={{
              ...styles,
              position: 'fixed',
              width: menuWidth,
              ...(rightSide ? { right: Math.min(shown.right, width - EDGE - menuWidth) } : { left: Math.min(width - shown.right - SIZE, width - EDGE - menuWidth) }),
              ...(below ? { top: height - shown.bottom + 8 } : { bottom: shown.bottom + SIZE + 8 }),
              background: 'var(--mrx-surface-raised)',
            }}
          >
            {node && <Menu node={node} about={about} onChanged={() => void linked.refetch()} onOpen={() => setOpen(false)} onNew={newTodo} />}
          </Paper>
        )}
      </Transition>
    </>
  );
}

function Menu({ node, about, onChanged, onOpen, onNew }: { node: string; about: TodoMine[]; onChanged: () => void; onOpen: () => void; onNew: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const done = async (item: TodoMine) => {
    setBusy(item.path);
    try {
      await execCommand(`todo-done ${shq(item.path)}`);
      noteOutsideEdit();
      onChanged();
    } catch (error) {
      notify({ message: error instanceof Error ? error.message : String(error), color: 'red' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Stack gap={4}>
      <Text size='xs' c='dimmed' px={4} truncate>About {nodeTitle(node, about)}</Text>
      <ScrollArea.Autosize mah='45dvh' type='auto'>
        <Stack gap={2}>
          {about.map((item) => (
            <Group key={item.path} gap='xs' wrap='nowrap' px={4} py={4} align='flex-start'>
              <Checkbox
                size='sm'
                mt={2}
                checked={false}
                disabled={busy === item.path}
                onChange={() => void done(item)}
                aria-label={`Mark ${item.title} done`}
              />
              <UnstyledButton
                onClick={() => {
                  onOpen();
                  openDialog(`/todos/item?path=${encodeURIComponent(item.path)}`);
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text size='sm' lineClamp={2}>{item.title}</Text>
                <Text size='xs' c='dimmed' truncate>
                  {[item.listTitle, item.columnTitle, item.due].filter(Boolean).join(' · ')}
                </Text>
              </UnstyledButton>
            </Group>
          ))}
        </Stack>
      </ScrollArea.Autosize>
      <Button variant='subtle' size='xs' leftSection={<TablerIcon name='plus' size={14} />} onClick={onNew} justify='flex-start'>
        New todo about this
      </Button>
    </Stack>
  );
}
