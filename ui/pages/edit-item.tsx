import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { EmptyState, MarkdownEditor, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand, useSurface } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, noteOutsideEdit, notify } from '@ein/ui/signals';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoItem, TodoMember } from '../../lib/api.ts';
import { LinkChip } from '../components/LinkChip.tsx';
import { NodeFinder } from '../components/NodeFinder.tsx';

/** The shell's dialog takes its frame from here; as a page, this is its heading. */
export const handle = { title: 'Todo item', icon: 'list-check', pattern: 'mixed', dialogSize: 'lg', signedIn: true };

const errorText = (err: unknown): string => err instanceof Error ? err.message : String(err);

/**
 * `/todos/item?path=<item>`, in the dialog from a card's pencil or as a page of its own: the item's
 * title, its notes in markdown, its due day and who is to do it, saved together; its links, each
 * taken away or added at once, found by name; or the item taken to the trash. Whatever it changes,
 * the pages behind it read again.
 */
export default function EditItemPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const item = useCommand<TodoItem>(`todo-item ${shq(path)}`);
  if (item.loading && !item.data) return <PageLoader />;
  if (item.error || !item.data) return <EmptyState title='This item could not be read'>{item.error?.message}</EmptyState>;
  return <ItemForm key={item.data.path} item={item.data} onLinked={() => void item.refetch()} />;
}

function ItemForm({ item, onLinked }: { item: TodoItem; onLinked: () => void }) {
  const surface = useSurface();
  const members = useCommand<TodoMember[]>(`todo-members ${shq(item.list)}`);
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [due, setDue] = useState<string | null>(item.due ?? null);
  const [assignee, setAssignee] = useState<string | null>(item.assignee ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [title, notes, due, assignee]);

  const run = async (command: string): Promise<boolean> => {
    try {
      await execCommand(command);
      noteOutsideEdit();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const command = `todo-set ${shq(item.path)} --title ${shq(title.trim())} --notes ${shq(notes)} ${due ? `--due ${shq(due)}` : '--no-due'} ${
      assignee ? `--assignee ${shq(assignee)}` : '--no-assignee'
    }`;
    if (await run(command)) surface.close();
    setBusy(false);
  };

  const link = async (target: string) => {
    if (await run(`todo-link ${shq(item.path)} ${shq(target)}`)) onLinked();
  };
  const unlink = async (path: string) => {
    if (await run(`rm ${shq(path)}`)) onLinked();
  };

  const remove = async () => {
    setBusy(true);
    if (await run(`trash put ${shq(item.path)}`)) {
      notify({ message: `Moved "${item.title}" to the trash.`, color: 'green' });
      surface.close();
    }
    setBusy(false);
  };

  return (
    <Stack component='form' onSubmit={save} gap='md'>
      <TextInput label='Title' value={title} onChange={(event) => setTitle(event.currentTarget.value)} required data-autofocus />
      <MarkdownEditor label='Notes' description='Markdown: lists, links, **bold** and the rest.' value={notes} onChange={setNotes} minRows={6} />
      <Group grow align='flex-start'>
        <DatePickerInput
          label='Due'
          placeholder='No particular day'
          value={due}
          onChange={setDue}
          clearable
          valueFormat='D MMM YYYY'
          leftSection={<TablerIcon name='calendar' size={16} />}
        />
        <Select
          label='Who is to do it'
          placeholder='Nobody in particular'
          clearable
          data={(members.data ?? []).map((member) => ({ value: member.username, label: member.name }))}
          value={assignee}
          onChange={setAssignee}
        />
      </Group>
      <Stack gap={6}>
        <NodeFinder onPick={(target) => void link(target)} disabled={busy} />
        {item.links
          ? (
            <Group gap={6}>
              {item.links.map((each) => <LinkChip key={each.path} link={each} onRemove={() => void unlink(each.path)} />)}
            </Group>
          )
          : <Text size='xs' c='dimmed'>Not linked to anything.</Text>}
      </Stack>
      {error && <Text size='sm' c='red'>{error}</Text>}
      <Group justify='space-between'>
        <Button variant='subtle' color='red' leftSection={<TablerIcon name='trash' size={16} />} onClick={() => void remove()} disabled={busy}>Move to trash</Button>
        <Group gap='xs'>
          <Button variant='default' onClick={surface.close} disabled={busy}>Cancel</Button>
          <Button type='submit' loading={busy} disabled={!title.trim()}>Save</Button>
        </Group>
      </Group>
    </Stack>
  );
}
