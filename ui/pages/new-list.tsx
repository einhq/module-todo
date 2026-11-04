import { CommandForm, type FormField, type FormValues, PageLoader } from '@ein/ui/components';
import { useCommand } from '@ein/ui/hooks';
import { shq } from '@ein/ui/lib';
import type { TodoList } from '../../lib/api.ts';

/** The shell's dialog takes its frame from here; as a page, this is its heading. */
export const handle = { title: 'New list', icon: 'list-check', pattern: 'mixed', dialogSize: 'md', signedIn: true };

/** The choice that keeps a list the reader's own; every other is a group's name. */
const MINE = 'mine';

const fields = (groups: string[]): FormField[] => [
  { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Shopping' },
  {
    key: 'group',
    label: 'Shared with',
    type: 'select',
    required: true,
    description: 'A list of your own is yours alone; a group list is shared with every member of the group.',
    options: [{ value: MINE, label: 'Nobody, it is mine' }, ...groups.map((group) => ({ value: group, label: `The ${group} group` }))],
  },
];

const build = (v: FormValues) => ({
  command: `todo-list-create ${shq(v.title.trim())}${v.group && v.group !== MINE ? ` --group ${shq(v.group)}` : ''}`,
  navigateTo: (answer: unknown) => `/todos?list=${encodeURIComponent((answer as TodoList).path)}`,
});

/**
 * `/todos/new-list`, in the dialog from the Todo page's New list button or as a page of its own: a
 * list's title, and whether it is the reader's own or shared with one of their groups. It opens the
 * new list once made.
 */
export default function NewListPage() {
  // `/groups` lists the shared homes of the reader's own groups, and only those.
  const groups = useCommand<string[]>('ls /groups');
  if (groups.loading && !groups.data) return <PageLoader />;
  return <CommandForm fields={fields(groups.data ?? [])} initial={{ group: MINE }} build={build} submitLabel='Create list' />;
}
