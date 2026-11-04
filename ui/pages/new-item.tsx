import { Button } from '@mantine/core';
import { CommandForm, EmptyState, type FormField, type FormValues, PageLoader } from '@ein/ui/components';
import { useCommand, useSurface } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import { useSearchParams } from 'react-router-dom';
import type { TodoList } from '../../lib/api.ts';

/** The shell's dialog takes its frame from here; as a page, this is its heading. */
export const handle = { title: 'New todo item', icon: 'list-check', pattern: 'mixed', dialogSize: 'md', signedIn: true };

const fields = (lists: TodoList[]): FormField[] => [
  { key: 'title', label: 'What is to be done', type: 'text', required: true, placeholder: 'Buy milk' },
  {
    key: 'list',
    label: 'List',
    type: 'select',
    required: true,
    options: lists.map((list) => ({ value: list.path, label: list.group ? `${list.title}, shared with ${list.group}` : list.title })),
  },
  { key: 'due', label: 'Due', type: 'text', placeholder: 'YYYY-MM-DD', description: 'Optional: the day it is due, shown on Home as it comes near' },
];

const build = (v: FormValues) => {
  let command = `todo-add ${shq(v.list)} ${shq(v.title.trim())}`;
  if (v.due?.trim()) command += ` --due ${shq(v.due.trim())}`;
  return { command, navigateTo: `/todos?list=${encodeURIComponent(v.list)}` };
};

/**
 * `/todos/new`, in the dialog from the top bar's Create menu or as a page of its own: an item for
 * any list the reader can see, `?list=` the one picked to start with, else the first.
 */
export default function NewTodoItemPage() {
  const [params] = useSearchParams();
  const surface = useSurface();
  const lists = useCommand<TodoList[]>('todo-lists');
  if (lists.loading && !lists.data) return <PageLoader />;
  const all = lists.data ?? [];
  if (all.length === 0) {
    return (
      <EmptyState title='No lists yet' actions={<Button onClick={() => surface.openPage('/todos')}>Open Todo</Button>}>
        An item goes on a list. Make one on the Todo page with New list.
      </EmptyState>
    );
  }
  return <CommandForm fields={fields(all)} initial={{ list: params.get('list') ?? all[0].path }} build={build} submitLabel='Add' />;
}
