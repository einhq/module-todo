import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { EmptyState, MarkdownEditor, PageLoader, TablerIcon } from '@ein/ui/components';
import { useCommand, useSurface } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, noteOutsideEdit, notify } from '@ein/ui/signals';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoItem, TodoMember } from '../../lib/api.ts';
import { Face } from '../components/Face.tsx';
import { LinkChip } from '../components/LinkChip.tsx';
import { NodeFinder } from '../components/NodeFinder.tsx';

/** The shell's dialog takes its frame from here; as a page, this is its heading. */
export const handle = { title: 'Todo item', icon: 'list-check', pattern: 'mixed', dialogSize: 'lg', signedIn: true };

const errorText = (err: unknown): string => err instanceof Error ? err.message : String(err);

/**
 * `/todos/item?path=<item>`, in the dialog from a card's pencil or as a page of its own: the item's
 * title, its description in markdown, its due day and who is to do it, saved together; its links,
 * each taken away or added at once, found by name; or the item deleted. Whatever it changes, the
 * pages behind it read again.
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
  const [description, setDescription] = useState(item.description ?? '');
  const [due, setDue] = useState<string | null>(item.due ?? null);
  const [assignee, setAssignee] = useState<string | null>(item.assignee ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [title, description, due, assignee]);

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
    const command = `todo-set ${shq(item.path)} --title ${shq(title.trim())} --description ${shq(description)} ${due ? `--due ${shq(due)}` : '--no-due'} ${
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

  // For good, not to the trash; its links go with it, and what they point at stays.
  const remove = async () => {
    setBusy(true);
    if (await run(`rm -r ${shq(item.path)}`)) {
      notify({ message: `Deleted "${item.title}".`, color: 'green' });
      surface.close();
    }
    setBusy(false);
  };
  const people = members.data ?? [];

  return (
    <Stack component='form' onSubmit={save} gap='md'>
      <TextInput label='Title' value={title} onChange={(event) => setTitle(event.currentTarget.value)} required data-autofocus />
      <MarkdownEditor label='Description' description='Markdown: lists, links, **bold** and the rest.' value={description} onChange={setDescription} minRows={6} />
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
          label='Assign to'
          placeholder='Type a name'
          searchable
          clearable
          nothingFoundMessage='Nobody of that name on this list'
          data={people.map((member) => ({ value: member.username, label: member.name }))}
          value={assignee}
          onChange={setAssignee}
          leftSection={assignee ? <Face username={assignee} members={people} size={22} /> : <TablerIcon name='user' size={16} />}
          renderOption={({ option, checked }) => (
            <Group gap='xs' wrap='nowrap'>
              <Face username={option.value} members={people} size={24} />
              <Text size='sm' style={{ flex: 1 }}>{option.label}</Text>
              {checked && <TablerIcon name='check' size={14} />}
            </Group>
          )}
        />
      </Group>
      <Stack gap={6}>
        <NodeFinder onPick={(target) => void link(target)} disabled={busy} />
        {item.links && (
          <Group gap={6}>
            {item.links.map((each) => <LinkChip key={each.path} link={each} onRemove={() => void unlink(each.path)} />)}
          </Group>
        )}
      </Stack>
      {error && <Text size='sm' c='red'>{error}</Text>}
      <Group justify='space-between'>
        <Button color='red' leftSection={<TablerIcon name='trash' size={16} />} onClick={() => void remove()} disabled={busy}>Delete</Button>
        <Group gap='xs'>
          <Button variant='default' onClick={surface.close} disabled={busy}>Cancel</Button>
          <Button type='submit' loading={busy} disabled={!title.trim()}>Save</Button>
        </Group>
      </Group>
    </Stack>
  );
}
