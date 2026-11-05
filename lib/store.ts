/**
 * Where todo lists live and how they are read and written.
 *
 * A list is a directory in `todos/` of a home: a reader's own in `~/todos`, which only they may
 * enter, a group's in `/groups/<group>/todos`, which every member may read and write and nobody
 * else sees. Its name is its title. An item is a markdown file in the list: YAML front matter for
 * `due`, `assignee`, `done` and `done-by`, the first `# heading` its title and the rest its notes.
 * The file is named for when it was added unless someone names it otherwise. Items are in the
 * order their `order` says, and those without one after them by birthtime. The softlinks the
 * file holds as children are what the item is about: a picture, an album. A done item is in the list's `done/`, whether or not its front matter
 * says when, so `ls` of a list is what is left on it. Who may see and change a list is the tree's
 * own access, and nothing here checks it: every read and write is made with the caller's access.
 */
import { basename, dirname, resolve } from '@std/path';
import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml';
import {
  accessOfUser,
  ADMIN_ACCESS,
  type Command,
  NodeAlreadyExistsError,
  type NodeAttrs,
  type NodeChildEntry,
  NodeNotFoundError,
  SYSTEM_TIME_ZONE,
  type UserAttrs,
} from '@ein/client';
import { GROUP_HOMES_PATH, groupHomePath, USERS_PATH } from '@ein/paths';
import type { TodoItem, TodoLink, TodoList, TodoMember } from './api.ts';

/** The folder of lists in a home, a person's or a group's. */
const TODOS_DIR = 'todos';

/** The folder in a list that its done items are moved to. */
const DONE_DIR = 'done';

const ITEM_MIMETYPE = 'text/markdown';

/** A reader's own lists: closed to everyone else, so neither they nor search see them. */
const PERSONAL_MODE = 0o700;

type FileAttrs = { mimetype?: string };

/** A node's type, as a softlink's own node has it. */
const SOFTLINK_TYPE = 'softlink';

/** An item file as read: its front matter, and the markdown after it. */
type ItemDoc = { meta: Record<string, unknown>; body: string };

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

/** Whether `path` is a folder of lists: the caller's `~/todos`, or a group's. */
const isRoot = (cmd: Command, path: string): boolean => {
  const group = groupOf(path);
  return group ? path === groupRoot(group) : cmd.env.HOME !== undefined && path === `${cmd.env.HOME}/${TODOS_DIR}`;
};

/** A real calendar day as `YYYY-MM-DD`. */
export const isDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};

/** `value` as a due day, or a `TodoError` saying what a due day is. */
const dueDay = (value: string): string => {
  if (!isDay(value)) throw new TodoError(`--due must be a day as YYYY-MM-DD, got '${value}'`);
  return value;
};

const children = async <T extends NodeAttrs = NodeAttrs>(cmd: Command, path: string): Promise<NodeChildEntry<T>[]> => {
  try {
    return await cmd.sys.vfs.children<T>(cmd.access, path);
  } catch (error) {
    if (error instanceof NodeNotFoundError) return [];
    throw error;
  }
};

/** Whether a child of a list is one of its items: a text file, or one named `.md`. */
const isItem = (entry: NodeChildEntry<FileAttrs>): boolean =>
  entry.node.type === 'file' && (entry.name.endsWith('.md') || (entry.node.attrs.mimetype ?? '').startsWith('text/'));

/** Items in the order they were added: by birthtime, then by name. */
const byAdded = (a: NodeChildEntry<FileAttrs>, b: NodeChildEntry<FileAttrs>): number =>
  (a.node.props.birthtime?.timestamp ?? 0) - (b.node.props.birthtime?.timestamp ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// --- The file -----------------------------------------------------------------------------------

const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const HEADING = /^#[ \t]+(.*?)[ \t#]*$/m;

/** An item's text as front matter and body; front matter that is not a YAML mapping counts as none. */
const parseItem = (text: string): ItemDoc => {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { meta: {}, body: text };
  let meta: unknown;
  try {
    meta = match[1] ? parseYaml(match[1]) : {};
  } catch {
    meta = {};
  }
  return { meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {}, body: text.slice(match[0].length) };
};

/** The front matter's keys the module writes, in the order it writes them. */
const KNOWN_KEYS = ['due', 'assignee', 'order', 'done', 'done-by'];

/** An item's text from its front matter and body: the known keys first, then whatever else it had. */
const renderItem = ({ meta, body }: ItemDoc): string => {
  const lines: string[] = [];
  // A day and a timestamp are written bare, as YAML reads them back: as dates, which `itemOf` takes.
  if (meta.due !== undefined) lines.push(`due: ${dayOf(meta.due) ?? JSON.stringify(String(meta.due))}`);
  if (meta.assignee !== undefined) lines.push(stringifyYaml({ assignee: meta.assignee }).trimEnd());
  if (meta.order !== undefined) lines.push(stringifyYaml({ order: meta.order }).trimEnd());
  if (meta.done !== undefined) lines.push(`done: ${timeOf(meta.done) ?? JSON.stringify(String(meta.done))}`);
  if (meta['done-by'] !== undefined) lines.push(stringifyYaml({ 'done-by': meta['done-by'] }).trimEnd());
  const rest = Object.fromEntries(Object.entries(meta).filter(([key, value]) => !KNOWN_KEYS.includes(key) && value !== undefined));
  if (Object.keys(rest).length > 0) lines.push(stringifyYaml(rest).trimEnd());
  const text = body.replace(/^\s*\n/, '').replace(/\s*$/, '\n');
  return lines.length > 0 ? `---\n${lines.join('\n')}\n---\n${text}` : text;
};

/** The body with its title as the first heading, the one there replaced or a new one put first. */
const withTitle = (body: string, title: string): string => HEADING.test(body) ? body.replace(HEADING, () => `# ${title}`) : `# ${title}\n\n${body.replace(/^\s+/, '')}`;

/** The body with `notes` after its heading in place of what was there. */
const withNotes = (title: string, notes: string): string => `# ${title}\n${notes.trim() ? `\n${notes.trim()}\n` : ''}`;

const dayOf = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return typeof value === 'string' && isDay(value) ? value : undefined;
};

const timeOf = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return undefined;
};

const textOf = (value: unknown): string | undefined => typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

/** A file's name without its extension, for an item with no heading. */
const stem = (name: string): string => name.replace(/\.[^.]+$/, '') || name;

const orderOf = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const itemOf = (list: string, path: string, doc: ItemDoc, done: boolean, links: TodoLink[]): TodoItem => {
  const heading = HEADING.exec(doc.body);
  const notes = (heading ? doc.body.replace(HEADING, '') : doc.body).trim();
  const due = dayOf(doc.meta.due);
  const assignee = textOf(doc.meta.assignee);
  const doneAt = done ? timeOf(doc.meta.done) : undefined;
  const doneBy = done ? textOf(doc.meta['done-by']) : undefined;
  const order = orderOf(doc.meta.order);
  return {
    path,
    list,
    title: heading?.[1].trim() || stem(basename(path)),
    ...(notes ? { notes } : {}),
    done,
    ...(doneAt ? { doneAt } : {}),
    ...(doneBy ? { doneBy } : {}),
    ...(due ? { due } : {}),
    ...(assignee ? { assignee } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(links.length > 0 ? { links } : {}),
  };
};

/** Items with an `order` by it, then the rest as they came; the sort is stable. */
const byOrder = (a: TodoItem, b: TodoItem): number => a.order === undefined ? (b.order === undefined ? 0 : 1) : b.order === undefined ? -1 : a.order - b.order;

/** The links among an item's children, each with what it points at; one pointing at nothing the caller can see has no type. */
const linksIn = async (cmd: Command, item: string, entries: NodeChildEntry[]): Promise<TodoLink[]> =>
  await Promise.all(
    entries.filter((entry) => entry.node.type === SOFTLINK_TYPE && entry.node.props.softlink).sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
      const target = resolve(item, entry.node.props.softlink!);
      const node = await cmd.sys.vfs.get<FileAttrs>(cmd.access, target).catch(() => undefined);
      return {
        name: entry.name,
        path: `${item}/${entry.name}`,
        target,
        ...(node ? { type: node.type } : {}),
        ...(node?.attrs.mimetype ? { mimetype: node.attrs.mimetype } : {}),
      };
    }),
  );

const readText = async (cmd: Command, path: string): Promise<string> => {
  const handle = await cmd.sys.vfs.open(cmd.access, path, { mode: 'r' });
  try {
    return await new Response(handle.readable).text();
  } finally {
    await handle.close();
  }
};

const writeText = async (cmd: Command, path: string, text: string): Promise<void> => {
  const handle = await cmd.sys.vfs.open(cmd.access, path, { mode: 'w' });
  try {
    await handle.write(new TextEncoder().encode(text));
  } finally {
    await handle.close();
  }
};

/** The items of the list at `list` among `entries`, read with their links, in their order. */
const readItems = async (cmd: Command, list: string, dir: string, entries: NodeChildEntry<FileAttrs>[], done: boolean): Promise<TodoItem[]> => {
  const items = entries.filter(isItem).sort(byAdded);
  // Only an item with children can hold links, and those are listed in one read.
  const holding = items.filter((entry) => entry.childCount > 0).map((entry) => `${dir}/${entry.name}`);
  const listed = await cmd.sys.vfs.childrenMany(cmd.access, holding);
  const childrenOf = new Map(holding.map((path, index) => [path, listed[index].status === 'fulfilled' ? listed[index].value : []]));
  const read = await Promise.all(items.map(async (entry) => {
    const path = `${dir}/${entry.name}`;
    const [text, links] = await Promise.all([readText(cmd, path), linksIn(cmd, path, childrenOf.get(path) ?? [])]);
    return itemOf(list, path, parseItem(text), done, links);
  }));
  return read.sort(byOrder);
};

// --- Lists --------------------------------------------------------------------------------------

const listOf = (path: string, open: number, total: number): TodoList => {
  const group = groupOf(path);
  return { path, title: basename(path), ...(group ? { group } : {}), open, total };
};

/**
 * Every list the caller can see, their own and then each of their groups', by title; with
 * `withOpen`, each list's open items read too. Done items are only counted.
 */
export const allLists = async (cmd: Command, withOpen = false): Promise<{ list: TodoList; open: TodoItem[] }[]> => {
  // `/groups` lists only the homes of the caller's groups: the others are hidden from them.
  const groups = (await children(cmd, GROUP_HOMES_PATH)).map((entry) => entry.name).sort();
  const roots = [personalRoot(cmd), ...groups.map(groupRoot)];
  const listed = <T extends NodeAttrs>(settled: PromiseSettledResult<NodeChildEntry<T>[]>) => settled.status === 'fulfilled' ? settled.value : [];

  const paths = (await cmd.sys.vfs.childrenMany(cmd.access, roots)).flatMap((settled, index) =>
    listed(settled).filter((entry) => entry.node.type === 'directory').map((entry) => entry.name).sort((a, b) => a.localeCompare(b)).map((name) => `${roots[index]}/${name}`)
  );
  const contents = await cmd.sys.vfs.childrenMany<FileAttrs>(cmd.access, [...paths, ...paths.map((path) => `${path}/${DONE_DIR}`)]);
  return await Promise.all(paths.map(async (path, index) => {
    const open = listed(contents[index]).filter(isItem);
    const done = listed(contents[paths.length + index]).filter(isItem);
    return { list: listOf(path, open.length, open.length + done.length), open: withOpen ? await readItems(cmd, path, path, open, false) : [] };
  }));
};

/** The list `arg` names, a path; a `TodoError` when it is not a list the caller can read. */
export const listAt = async (cmd: Command, arg: string | undefined): Promise<string> => {
  if (!arg) throw new TodoError('missing list');
  const path = resolve(cmd.cwd, arg);
  let node;
  try {
    node = await cmd.sys.vfs.get(cmd.access, path);
  } catch {
    throw new TodoError(`${path}: no such list`);
  }
  if (node.type !== 'directory' || !isRoot(cmd, dirname(path))) throw new TodoError(`${path}: not a todo list`);
  return path;
};

/** The list `arg` names with its items, the open ones and then the done ones. */
export const readList = async (cmd: Command, arg: string | undefined): Promise<{ list: TodoList; items: TodoItem[] }> => {
  const path = await listAt(cmd, arg);
  const open = await readItems(cmd, path, path, await children<FileAttrs>(cmd, path), false);
  const done = await readItems(cmd, path, `${path}/${DONE_DIR}`, await children<FileAttrs>(cmd, `${path}/${DONE_DIR}`), true);
  return { list: listOf(path, open.length, open.length + done.length), items: [...open, ...done] };
};

/**
 * Make a list called `title`, the caller's own or, with `group`, in that group's shared home. The
 * title is the folder's name, so a list of that title already there is refused.
 */
export const createList = async (cmd: Command, title: string, group?: string): Promise<TodoList> => {
  const name = title.trim();
  if (!name) throw new TodoError('a list needs a title');
  if (name.includes('/') || name === '.' || name === '..') throw new TodoError(`a list cannot be called '${name}'`);
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
  try {
    await cmd.sys.vfs.create(cmd.access, 'directory', root, name);
  } catch (error) {
    if (error instanceof NodeAlreadyExistsError) throw new TodoError(`there is already a list called '${name}' in ${root}`);
    throw error;
  }
  return listOf(`${root}/${name}`, 0, 0);
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
const assignable = async (cmd: Command, path: string, username: string): Promise<string> => {
  const members = await membersOf(cmd, path);
  if (members.some((member) => member.username === username)) return username;
  throw new TodoError(groupOf(path) ? `'${username}' is not in the group '${groupOf(path)}'` : `an item on your own list can only be yours`);
};

// --- Items --------------------------------------------------------------------------------------

/** Where the item at `path` is: its list, and whether it is in the list's `done/`; undefined for anything else. */
const placeOf = (cmd: Command, path: string): { list: string; done: boolean } | undefined => {
  const parent = dirname(path);
  if (isRoot(cmd, dirname(parent))) return { list: parent, done: false };
  if (basename(parent) === DONE_DIR && isRoot(cmd, dirname(dirname(parent)))) return { list: dirname(parent), done: true };
  return undefined;
};

/** The item `arg` names, a path, with its text; a `TodoError` when it is not an item the caller can read. */
const itemAt = async (cmd: Command, arg: string | undefined): Promise<{ item: TodoItem; doc: ItemDoc }> => {
  if (!arg) throw new TodoError('missing item');
  const path = resolve(cmd.cwd, arg);
  let node;
  try {
    node = await cmd.sys.vfs.get<FileAttrs>(cmd.access, path);
  } catch {
    throw new TodoError(`${path}: no such item`);
  }
  const place = placeOf(cmd, path);
  if (!place || !isItem({ node, name: basename(path), childCount: 0 })) throw new TodoError(`${path}: not a todo item`);
  const [text, entries] = await Promise.all([readText(cmd, path), children(cmd, path)]);
  const doc = parseItem(text);
  return { item: itemOf(place.list, path, doc, place.done, await linksIn(cmd, path, entries)), doc };
};

/** The item `arg` names, a path; a `TodoError` when it is not an item the caller can read. */
const readItem = async (cmd: Command, arg: string | undefined): Promise<TodoItem> => (await itemAt(cmd, arg)).item;

/** A name in `dirs` that none of them has yet: `wanted`, or it with a number before its extension. */
const freeName = async (cmd: Command, dirs: string[], wanted: string): Promise<string> => {
  const taken = new Set((await Promise.all(dirs.map((dir) => children(cmd, dir)))).flat().map((entry) => entry.name));
  const dot = wanted.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ''];
  let name = wanted;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}${ext}`;
  return name;
};

/** Now, in the system's time zone, as a file name: `2026-11-05-140322.md`. */
const addedName = (): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: SYSTEM_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}.md`;
};

/** Add an item titled `title` to the list at `list`, named for now. */
export const addItem = async (cmd: Command, list: string, title: string, extra: { due?: string; assignee?: string; links?: string[] }): Promise<TodoItem> => {
  const name = title.trim();
  if (!name) throw new TodoError('an item needs a title');
  const meta: Record<string, unknown> = {};
  if (extra.due) meta.due = dueDay(extra.due);
  if (extra.assignee) meta.assignee = await assignable(cmd, list, extra.assignee);
  const targets = await linkable(cmd, extra.links ?? []);
  // The name is free in done/ too, so the item can be ticked off and back without being renamed.
  const file = await freeName(cmd, [list, `${list}/${DONE_DIR}`], addedName());
  await cmd.sys.vfs.create(cmd.access, 'file', list, file, { props: { tier: 'db' }, attrs: { name: file, mimetype: ITEM_MIMETYPE, size: 0 } });
  await writeText(cmd, `${list}/${file}`, renderItem({ meta, body: `# ${name}\n` }));
  await makeLinks(cmd, `${list}/${file}`, targets);
  return readItem(cmd, `${list}/${file}`);
};

/** `paths` resolved, each something the caller can see, or a `TodoError` naming the first that is not. */
const linkable = async (cmd: Command, paths: string[]): Promise<string[]> =>
  await Promise.all(paths.map(async (arg) => {
    const target = resolve(cmd.cwd, arg);
    if (!await cmd.sys.vfs.exists(cmd.access, target)) throw new TodoError(`${target}: nothing there to link`);
    return target;
  }));

/** A softlink under the item at `item` to each of `targets`, named as the target is, numbered when that is taken. */
const makeLinks = async (cmd: Command, item: string, targets: string[]): Promise<void> => {
  for (const target of targets) {
    const name = await freeName(cmd, [item], basename(target) || 'root');
    await cmd.sys.vfs.create(cmd.access, SOFTLINK_TYPE, item, name, { props: { mode: 0o777, softlink: target } });
  }
};

/** Link the item at `arg` to each of `paths`: what it is about. */
export const linkItem = async (cmd: Command, arg: string, paths: string[]): Promise<TodoItem> => {
  if (paths.length === 0) throw new TodoError('nothing to link: give one or more paths');
  const { item } = await itemAt(cmd, arg);
  await makeLinks(cmd, item.path, await linkable(cmd, paths));
  return readItem(cmd, item.path);
};

/**
 * Put the open item at `arg` just before or just after `other` on its list, and number every open
 * item of the list from 1 in its new order, writing only those whose number changed.
 */
export const moveItem = async (cmd: Command, arg: string, other: string, after: boolean): Promise<TodoItem> => {
  const { item } = await itemAt(cmd, arg);
  const { item: beside } = await itemAt(cmd, other);
  if (item.done || beside.done) throw new TodoError('only an open item has a place on its list');
  if (beside.list !== item.list) throw new TodoError(`${beside.path} is not on the same list`);
  const open = (await readList(cmd, item.list)).items.filter((each) => !each.done && each.path !== item.path);
  const at = open.findIndex((each) => each.path === beside.path);
  if (at === -1) throw new TodoError(`${beside.path}: not an item of the list`);
  open.splice(after ? at + 1 : at, 0, item);
  for (const [index, each] of open.entries()) {
    if (each.order === index + 1) continue;
    const { doc } = await itemAt(cmd, each.path);
    await writeText(cmd, each.path, renderItem({ ...doc, meta: { ...doc.meta, order: index + 1 } }));
  }
  return readItem(cmd, item.path);
};

/** The changes `todo-set` makes; null takes a field away. */
export type ItemChange = { title?: string; notes?: string; due?: string | null; assignee?: string | null };

/** Change the item at `arg`: its title, notes, due day or assignee, the rest of its text kept. */
export const updateItem = async (cmd: Command, arg: string, change: ItemChange): Promise<TodoItem> => {
  const { item, doc } = await itemAt(cmd, arg);
  const meta = { ...doc.meta };
  let body = doc.body;
  if (change.title !== undefined) {
    if (!change.title.trim()) throw new TodoError('an item needs a title');
    body = withTitle(body, change.title.trim());
  }
  if (change.notes !== undefined) body = withNotes(change.title?.trim() || item.title, change.notes);
  if (change.due === null) delete meta.due;
  else if (change.due !== undefined) meta.due = dueDay(change.due);
  if (change.assignee === null) delete meta.assignee;
  else if (change.assignee !== undefined) meta.assignee = await assignable(cmd, item.list, change.assignee);
  await writeText(cmd, item.path, renderItem({ meta, body }));
  return readItem(cmd, item.path);
};

/**
 * Mark the item at `arg` done, saying who and when, and move it to its list's `done/`; with
 * `undo`, take that away and move it back. An item already where it is asked to be is left alone.
 */
export const markDone = async (cmd: Command, arg: string, undo: boolean): Promise<TodoItem> => {
  const { item, doc } = await itemAt(cmd, arg);
  if (item.done !== undo) return item;
  const meta = { ...doc.meta };
  if (undo) {
    delete meta.done;
    delete meta['done-by'];
  } else {
    meta.done = new Date().toISOString();
    meta['done-by'] = cmd.env.USER ?? String(cmd.access.uid);
  }
  await writeText(cmd, item.path, renderItem({ ...doc, meta }));
  const to = undo ? item.list : `${item.list}/${DONE_DIR}`;
  if (!undo) await cmd.sys.vfs.ensure(cmd.access, 'directory', item.list, DONE_DIR);
  const name = await freeName(cmd, [to], basename(item.path));
  await cmd.sys.vfs.rename(cmd.access, dirname(item.path), basename(item.path), to, name, { failIfExists: true });
  return readItem(cmd, `${to}/${name}`);
};

/** Say `error` on stderr as `name`'s failure, and answer the exit code for it. */
export const fail = async (cmd: Command, name: string, error: unknown): Promise<number> => {
  await cmd.writeError(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
};

/** One line for an item: whether it is done, its title, when it is due and whose it is. */
export const itemLine = (item: TodoItem): string =>
  `[${item.done ? 'x' : ' '}] ${item.title}${item.due ? `  due ${item.due}` : ''}${item.assignee ? `  @${item.assignee}` : ''}`;
