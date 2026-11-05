import { Button, Group, Stack, TextInput } from '@mantine/core';
import { useCommand, useSurface } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { execCommand, noteOutsideEdit } from '@ein/ui/signals';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TodoListing } from '../../lib/api.ts';

/** The shell's dialog takes its frame from here; as a page, this is its heading. */
export const handle = { title: 'New column', icon: 'layout-columns', pattern: 'mixed', dialogSize: 'sm', signedIn: true };

/** The folders a list keeps for itself, which are no column the reader can add. */
const RESERVED = ['done', 'archived'];

/**
 * `/todos/new-column?list=<path>`, in the dialog from the Todo page's menu: a column for the list,
 * a folder in it named as typed, which the board shows before Done.
 */
export default function NewColumnPage() {
  const [params] = useSearchParams();
  const list = params.get('list') ?? '';
  const surface = useSurface();
  const listing = useCommand<TodoListing>(`todo-items ${shq(list)}`);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const typed = name.trim();
  const taken = listing.data?.columns.some((column) => column.path.split('/').pop() === typed || column.title === typed);
  const problem = !typed
    ? undefined
    : typed.includes('/') || typed.startsWith('.')
    ? 'A column cannot be called that'
    : RESERVED.includes(typed.toLocaleLowerCase())
    ? `The list keeps ${typed} for itself`
    : taken
    ? 'There is a column of that name'
    : undefined;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed || problem) return;
    setBusy(true);
    try {
      await execCommand(`mkdir ${shq(`${list}/${typed}`)}`);
      noteOutsideEdit();
      surface.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <Stack component='form' onSubmit={create} gap='md'>
      <TextInput
        label='Name'
        description={listing.data ? `A column of ${listing.data.list.title}, before Done` : undefined}
        placeholder='In progress'
        value={name}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setError('');
        }}
        error={problem ?? (error || undefined)}
        data-autofocus
      />
      <Group justify='flex-end'>
        <Button variant='default' onClick={surface.close} disabled={busy}>Cancel</Button>
        <Button type='submit' loading={busy} disabled={!typed || problem !== undefined}>Add column</Button>
      </Group>
    </Stack>
  );
}
