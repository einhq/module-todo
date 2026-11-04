/**
 * Where todo lists live and how they are read and written.
 *
 * A list is a `todo-list` node holding its items, `todo` nodes named by when they were added. A
 * reader's own lists are in `~/todos`, which only they may enter; a group's are in `todos/` of the
 * group's shared home, `/groups/<group>/todos`, which every member may read and write and nobody
 * else sees. So who may see and change a list is the tree's own access, and nothing here checks
 * it: every read and write is made with the caller's access.
 */
import { basename, dirname, resolve } from '@std/path';
import { monotonicUlid } from '@std/ulid';
import { accessOfUser, ADMIN_ACCESS, type Command, type NodeChildEntry, NodeNotFoundError, type UserAttrs } from '@ein/client';
import { GROUP_HOMES_PATH, groupHomePath, USERS_PATH } from '@ein/paths';
import type { TodoItem, TodoList, TodoMember } from './api.ts';

const LIST_TYPE = 'todo-list';
const ITEM_TYPE = 'todo';

/** The folder of lists in a home, a person's or a group's. */
const TODOS_DIR = 'todos';

/** A reader's own lists: closed to everyone else, so neither they nor search see them. */
const PERSONAL_MODE = 0o700;

type ListAttrs = { title?: string };
type ItemAttrs = { title?: string; done?: boolean; doneAt?: string; doneBy?: string; due?: string; assignee?: string };

/** A `todo` command's failure, said to the caller as it is. */
export class TodoError extends Error {}

const personalRoot = (cmd: Command): string => {
  const home = cmd.env.HOME;
  if (!home || home === '/') throw new TodoError('no home directory (log in first)');
  return `${home}/${TODOS_DIR}`;
};

const groupRoot = (group: string): string => `${groupHomePath(group)}/${TODOS_DIR}`;

/** The group whose shared home holds `path`, or undefined for anything else. */
const groupOf = (path: string): string | undefined => {
  const prefix = `${GROUP_HOMES_PATH}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] || undefined : undefined;
};

/** A real calendar day as `YYYY-MM-DD`. */
export const isDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};

/** `value` as a due day, or a `TodoError` saying what a due day is. */
export const dueDay = (value: string): string => {
  if (!isDay(value)) throw new TodoError(`--due must be a day as YYYY-MM-DD, got '${value}'`);
  return value;
};

/** The name a list of this title is made under: lower case, dashes, never empty. */
const slugOf = (title: string): string => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'list';

const children = async <T extends ListAttrs | ItemAttrs>(cmd: Command, path: string): Promise<NodeChildEntry<T>[]> => {
  try {
    return await cmd.sys.vfs.children<T>(cmd.access, path);
  } catch (error) {
    if (error instanceof NodeNotFoundError) return [];
    throw error;
  }
};

const itemOf = (list: string, entry: NodeChildEntry<ItemAttrs>): TodoItem => {
  const attrs = entry.node.attrs;
  return {
    path: `${list}/${entry.name}`,
    list,
    title: attrs.title ?? entry.name,
    done: attrs.done === true,
    ...(attrs.doneAt ? { doneAt: attrs.doneAt } : {}),
    ...(attrs.doneBy ? { doneBy: attrs.doneBy } : {}),
    ...(attrs.due ? { due: attrs.due } : {}),
    ...(attrs.assignee ? { assignee: attrs.assignee } : {}),
  };
};

/** The items of the list at `path`, in the order they were added. */
const itemsOf = async (cmd: Command, path: string): Promise<TodoItem[]> =>
  (await children<ItemAttrs>(cmd, path))
    .filter((entry) => entry.node.type === ITEM_TYPE)
    // Names are ULIDs, so their order is the order the items were added in.
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((entry) => itemOf(path, entry));

const listOf = (path: string, title: string, items: TodoItem[]): TodoList => {
  const group = groupOf(path);
  return { path, title, ...(group ? { group } : {}), open: items.filter((item) => !item.done).length, total: items.length };
};

/** Every list the caller can see: their own, then each of their groups', by title. */
export const allLists = async (cmd: Command): Promise<{ list: TodoList; items: TodoItem[] }[]> => {
  // `/groups` lists only the homes of the caller's groups: the others are hidden from them.
  const groups = (await children(cmd, GROUP_HOMES_PATH)).map((entry) => entry.name).sort();
  const roots = [personalRoot(cmd), ...groups.map(groupRoot)];
  const found: { list: TodoList; items: TodoItem[] }[] = [];
  for (const root of roots) {
    const lists = (await children<ListAttrs>(cmd, root)).filter((entry) => entry.node.type === LIST_TYPE);
    for (const entry of lists.sort((a, b) => (a.node.attrs.title ?? a.name).localeCompare(b.node.attrs.title ?? b.name))) {
      const path = `${root}/${entry.name}`;
      const items = await itemsOf(cmd, path);
      found.push({ list: listOf(path, entry.node.attrs.title ?? entry.name, items), items });
    }
  }
  return found;
};

/** The list `arg` names, a path, with its items; a `TodoError` when it is not a list the caller can read. */
export const readList = async (cmd: Command, arg: string | undefined): Promise<{ list: TodoList; items: TodoItem[] }> => {
  if (!arg) throw new TodoError('missing list');
  const path = resolve(cmd.cwd, arg);
  let node;
  try {
    node = await cmd.sys.vfs.get<ListAttrs>(cmd.access, path);
  } catch {
    throw new TodoError(`${path}: no such list`);
  }
  if (node.type !== LIST_TYPE) throw new TodoError(`${path}: not a todo list`);
  const items = await itemsOf(cmd, path);
  return { list: listOf(path, node.attrs.title ?? basename(path), items), items };
};

/** The item `arg` names, a path; a `TodoError` when it is not an item the caller can read. */
export const readItem = async (cmd: Command, arg: string | undefined): Promise<TodoItem> => {
  if (!arg) throw new TodoError('missing item');
  const path = resolve(cmd.cwd, arg);
  let node;
  try {
    node = await cmd.sys.vfs.get<ItemAttrs>(cmd.access, path);
  } catch {
    throw new TodoError(`${path}: no such item`);
  }
  if (node.type !== ITEM_TYPE) throw new TodoError(`${path}: not a todo item`);
  return itemOf(dirname(path), { node, name: basename(path), childCount: 0 });
};

/**
 * Make a list titled `title`, the caller's own or, with `group`, in that group's shared home. The
 * name is the title's, with a number after it when that is taken.
 */
export const createList = async (cmd: Command, title: string, group?: string): Promise<TodoList> => {
  const name = title.trim();
  if (!name) throw new TodoError('a list needs a title');
  let root: string;
  if (group) {
    const home = groupHomePath(group);
    if (!await cmd.sys.vfs.exists(cmd.access, home)) throw new TodoError(`group '${group}' has no shared home you are in`);
    root = groupRoot(group);
    await cmd.sys.vfs.ensure(cmd.access, 'directory', home, TODOS_DIR);
  } else {
    root = personalRoot(cmd);
    await cmd.sys.vfs.ensure(cmd.access, 'directory', dirname(root), TODOS_DIR, { props: { mode: PERSONAL_MODE } });
  }
  const taken = new Set((await children(cmd, root)).map((entry) => entry.name));
  const slug = slugOf(name);
  let candidate = slug;
  for (let n = 2; taken.has(candidate); n++) candidate = `${slug}-${n}`;
  await cmd.sys.vfs.create<ListAttrs>(cmd.access, LIST_TYPE, root, candidate, { attrs: { title: name } });
  return listOf(`${root}/${candidate}`, name, []);
};

/**
 * Who an item of the list at `path` may be given to: on a list of one's own only oneself, on a
 * group's every active member of the group. Membership is read as the administrator, since a
 * member need not be able to list `/etc/groups`, and only of a list the caller can already read.
 */
export const membersOf = async (cmd: Command, path: string): Promise<TodoMember[]> => {
  const group = groupOf(path);
  const self = cmd.env.USER ?? '';
  const accounts = await cmd.sys.vfs.children<UserAttrs>(ADMIN_ACCESS, USERS_PATH);
  const named = (username: string, attrs?: UserAttrs): TodoMember => ({ username, name: attrs?.name || username });
  if (!group) return [named(self, accounts.find((entry) => entry.name === self)?.node.attrs)];

  const gid = (await cmd.sys.vfs.get(cmd.access, groupHomePath(group))).props.gid;
  const members: TodoMember[] = [];
  for (const entry of accounts) {
    if (entry.node.type !== 'user' || entry.node.attrs.inactive) continue;
    const access = await accessOfUser(cmd.sys.vfs, ADMIN_ACCESS, entry.name).catch(() => undefined);
    if (access?.gids.includes(gid)) members.push(named(entry.name, entry.node.attrs));
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
};

/** `username` as an assignee of an item on the list at `path`, or a `TodoError` saying why not. */
export const assignable = async (cmd: Command, path: string, username: string): Promise<string> => {
  const members = await membersOf(cmd, path);
  if (members.some((member) => member.username === username)) return username;
  throw new TodoError(groupOf(path) ? `'${username}' is not in the group '${groupOf(path)}'` : `an item on your own list can only be yours`);
};

/** Add an item titled `title` to the list at `list`, at its end. */
export const addItem = async (cmd: Command, list: string, title: string, extra: { due?: string; assignee?: string }): Promise<TodoItem> => {
  const name = title.trim();
  if (!name) throw new TodoError('an item needs a title');
  const attrs: ItemAttrs = { title: name, done: false };
  if (extra.due) attrs.due = dueDay(extra.due);
  if (extra.assignee) attrs.assignee = await assignable(cmd, list, extra.assignee);
  const id = monotonicUlid();
  await cmd.sys.vfs.create<ItemAttrs>(cmd.access, ITEM_TYPE, list, id, { attrs });
  return readItem(cmd, `${list}/${id}`);
};

/** Write `attrs` to the item at `path`; null takes an attr away. */
export const updateItem = async (cmd: Command, path: string, attrs: Record<string, unknown>): Promise<TodoItem> => {
  await cmd.sys.vfs.update(cmd.access, path, { attrs });
  return readItem(cmd, path);
};

/** Say `error` on stderr as `name`'s failure, and answer the exit code for it. */
export const fail = async (cmd: Command, name: string, error: unknown): Promise<number> => {
  await cmd.writeError(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
};

/** One line for an item: whether it is done, its title, when it is due and whose it is. */
export const itemLine = (item: TodoItem): string =>
  `[${item.done ? 'x' : ' '}] ${item.title}${item.due ? `  due ${item.due}` : ''}${item.assignee ? `  @${item.assignee}` : ''}`;
