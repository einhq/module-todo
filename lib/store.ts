/**
 * Where todo lists live and how they are read and written.
 *
 * A list is a directory in `todos/` of a home: a reader's own in `~/todos`, which only they may
 * enter, a group's in `/groups/<group>/todos`, which every member may read and write and nobody
 * else sees. Its name is its title. An item is a markdown file in the list: YAML front matter for
 * `due`, `assignee`, `done` and `done-by`, the first `# heading` its title and the rest its description.
 * The file is named for when it was added unless someone names it otherwise. The softlinks the
 * file holds as children are what the item is about: a picture, an album.
 *
 * A list is a board of columns. Items in the list's own folder are not started (Todo); every
 * folder in it is a column, called by its `name` attr or else its own name, in the order the
 * folders were made; the list's `done/` is the Done column, last. A done item is in `done/`,
 * whether or not its front matter says when, so `ls` of a list is what is not started. Done items
 * are put away in `archived/`, which is no column. In each column items are in the order their
 * `order` says, and those without one after them by birthtime. Who may see and change a list is
 * the tree's own access, and nothing here checks it: every read and write is made with the
 * caller's access.
 */
import { basename, dirname, resolve } from '@std/path';
import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml';
import { ADMIN_ACCESS, type Command, NodeAlreadyExistsError, type NodeAttrs, type NodeChildEntry, NodeNotFoundError, SYSTEM_TIME_ZONE, type UserAttrs } from '@ein/client';
import { GROUP_HOMES_PATH, groupHomePath, GROUPS_PATH, USERS_PATH } from '@ein/paths';
import type { TodoColumn, TodoItem, TodoLink, TodoList, TodoMember } from './api.ts';

/** The folder of lists in a home, a person's or a group's. */
const TODOS_DIR = 'todos';

/** The folder in a list that its done items are moved to: the Done column. */
const DONE_DIR = 'done';

/** The folder in a list that done items are put away in, out of the board. */
const ARCHIVED_DIR = 'archived';

/** The attr that names a column, when its folder's name is not what it is to be called. */
const COLUMN_NAME_ATTR = 'name';

/** The attr that places a column among the list's own, written when they are put in an order by hand. */
const COLUMN_ORDER_ATTR = 'order';

const ITEM_MIMETYPE = 'text/markdown';

/** A reader's own lists: closed to everyone else, so neither they nor search see them. */
const PERSONAL_MODE = 0o700;

type FileAttrs = { mimetype?: string; name?: unknown };

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

/** Items or columns in the order they were added: by birthtime, then by name. */
const byAdded = (a: NodeChildEntry, b: NodeChildEntry): number =>
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

/** The body with `description` after its heading in place of what was there. */
const withDescription = (title: string, description: string): string => `# ${title}\n${description.trim() ? `\n${description.trim()}\n` : ''}`;

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

/** Where an item is: its list, the column it is in, and whether that makes it done. */
type Place = { list: string; column: string; done: boolean };

/** An item as read: its place, its path, its text, its links, and when its file was made (ms). */
const itemOf = ({ list, column, done }: Place, path: string, doc: ItemDoc, links: TodoLink[], born?: number): TodoItem => {
  const heading = HEADING.exec(doc.body);
  const description = (heading ? doc.body.replace(HEADING, '') : doc.body).trim();
  const due = dayOf(doc.meta.due);
  const assignee = textOf(doc.meta.assignee);
  const doneAt = done ? timeOf(doc.meta.done) : undefined;
  const doneBy = done ? textOf(doc.meta['done-by']) : undefined;
  const order = orderOf(doc.meta.order);
  return {
    path,
    list,
    column,
    title: heading?.[1].trim() || stem(basename(path)),
    ...(description ? { description } : {}),
    ...(born ? { added: new Date(born).toISOString() } : {}),
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
      const named = node?.attrs.name;
      return {
        name: entry.name,
        title: typeof named === 'string' && named.trim() ? named.trim() : basename(target) || entry.name,
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

/** The items at `place` among `entries`, a listing of its column, read with their links, in their order. */
const readItems = async (cmd: Command, place: Place, entries: NodeChildEntry<FileAttrs>[]): Promise<TodoItem[]> => {
  const dir = place.column;
  const items = entries.filter(isItem).sort(byAdded);
  // Only an item with children can hold links, and those are listed in one read.
  const holding = items.filter((entry) => entry.childCount > 0).map((entry) => `${dir}/${entry.name}`);
  const listed = await cmd.sys.vfs.childrenMany(cmd.access, holding);
  const childrenOf = new Map(holding.map((path, index) => [path, listed[index].status === 'fulfilled' ? listed[index].value : []]));
  const read = await Promise.all(items.map(async (entry) => {
    const path = `${dir}/${entry.name}`;
    const [text, links] = await Promise.all([readText(cmd, path), linksIn(cmd, path, childrenOf.get(path) ?? [])]);
    return itemOf(place, path, parseItem(text), links, entry.node.props.birthtime?.timestamp);
  }));
  return read.sort(byOrder);
};

// --- Lists and columns --------------------------------------------------------------------------

const listOf = (path: string, open: number, total: number): TodoList => {
  const group = groupOf(path);
  return { path, title: basename(path), ...(group ? { group } : {}), open, total };
};

/** Whether a child of a list is one of its columns: a folder, but not `archived/` nor a hidden one. */
const isColumnDir = (entry: NodeChildEntry): boolean => entry.node.type === 'directory' && entry.name !== ARCHIVED_DIR && !entry.name.startsWith('.');

/** What a column folder is called: its `name` attr, else its name, `done/` being Done. */
const columnTitle = (name: string, attrs: NodeAttrs): string => {
  const named = attrs[COLUMN_NAME_ATTR];
  if (typeof named === 'string' && named.trim()) return named.trim();
  return name === DONE_DIR ? 'Done' : name;
};

/** The columns of the list at `list`, from a listing of it: Todo, its folders as they were made, Done whether or not `done/` is there yet. */
const columnsOf = (list: string, entries: NodeChildEntry[]): TodoColumn[] => {
  const folders = entries.filter(isColumnDir).sort(byAdded).sort(byColumnOrder);
  const done = folders.find((entry) => entry.name === DONE_DIR);
  return [
    { path: list, title: 'Todo', stage: 'todo' },
    ...folders.filter((entry) => entry !== done).map((entry): TodoColumn => ({
      path: `${list}/${entry.name}`,
      title: columnTitle(entry.name, entry.node.attrs),
      stage: 'doing',
    })),
    { path: `${list}/${DONE_DIR}`, title: done ? columnTitle(DONE_DIR, done.node.attrs) : 'Done', stage: 'done' },
  ];
};

/** A column folder's place on the board, from its `order` attr. */
const columnOrder = (entry: NodeChildEntry): number | undefined => orderOf(entry.node.attrs[COLUMN_ORDER_ATTR]);

/** Column folders with an `order` by it, then the rest as they came; the sort is stable. */
const byColumnOrder = (a: NodeChildEntry, b: NodeChildEntry): number => {
  const [x, y] = [columnOrder(a), columnOrder(b)];
  return x === undefined ? (y === undefined ? 0 : 1) : y === undefined ? -1 : x - y;
};

const placeIn = (list: string, column: TodoColumn): Place => ({ list, column: column.path, done: column.stage === 'done' });

const settledChildren = <T extends NodeAttrs>(settled: PromiseSettledResult<NodeChildEntry<T>[]>): NodeChildEntry<T>[] => settled.status === 'fulfilled' ? settled.value : [];

/**
 * The lists at `paths` with their columns, the listings of each column beside them, keyed by the
 * column's path: the list's own listing, read first, is its Todo column's.
 */
const readBoards = async (cmd: Command, paths: string[]): Promise<{ columns: TodoColumn[]; listed: Map<string, NodeChildEntry<FileAttrs>[]> }[]> => {
  const lists = (await cmd.sys.vfs.childrenMany<FileAttrs>(cmd.access, paths)).map(settledChildren);
  const columns = paths.map((path, index) => columnsOf(path, lists[index]));
  const inner = columns.flatMap((each) => each.slice(1).map((column) => column.path));
  const innerListed = (await cmd.sys.vfs.childrenMany<FileAttrs>(cmd.access, inner)).map(settledChildren);
  const byPath = new Map(inner.map((path, index) => [path, innerListed[index]]));
  return paths.map((path, index) => ({
    columns: columns[index],
    listed: new Map(columns[index].map((column) => [column.path, column.path === path ? lists[index] : byPath.get(column.path) ?? []])),
  }));
};

/** The items of a board's `columns` in turn, read from their `listed` listings. */
const readColumns = async (cmd: Command, list: string, columns: TodoColumn[], listed: Map<string, NodeChildEntry<FileAttrs>[]>): Promise<TodoItem[]> =>
  (await Promise.all(columns.map((column) => readItems(cmd, placeIn(list, column), listed.get(column.path) ?? [])))).flat();

/** How many items a board has: those in any column but Done, and in every column. */
const countOf = (columns: TodoColumn[], listed: Map<string, NodeChildEntry<FileAttrs>[]>): { open: number; total: number } => {
  let open = 0;
  let total = 0;
  for (const column of columns) {
    const items = (listed.get(column.path) ?? []).filter(isItem).length;
    total += items;
    if (column.stage !== 'done') open += items;
  }
  return { open, total };
};

/**
 * Every list the caller can see, their own and then each of their groups', by title, with its
 * columns; with `read` `open`, each list's items in any column but Done read too, with `all` those
 * in Done as well. Archived items are never read.
 */
export const allLists = async (cmd: Command, read: 'none' | 'open' | 'all' = 'none'): Promise<{ list: TodoList; columns: TodoColumn[]; items: TodoItem[] }[]> => {
  // `/groups` lists only the homes of the caller's groups: the others are hidden from them.
  const groups = (await children(cmd, GROUP_HOMES_PATH)).map((entry) => entry.name).sort();
  const roots = [personalRoot(cmd), ...groups.map(groupRoot)];

  const paths = (await cmd.sys.vfs.childrenMany(cmd.access, roots)).flatMap((settled, index) =>
    settledChildren(settled).filter((entry) => entry.node.type === 'directory').map((entry) => entry.name).sort((a, b) => a.localeCompare(b)).map((name) =>
      `${roots[index]}/${name}`
    )
  );
  const boards = await readBoards(cmd, paths);
  return await Promise.all(paths.map(async (path, index) => {
    const { columns, listed } = boards[index];
    const { open, total } = countOf(columns, listed);
    const shown = read === 'all' ? columns : read === 'open' ? columns.filter((column) => column.stage !== 'done') : [];
    return { list: listOf(path, open, total), columns, items: await readColumns(cmd, path, shown, listed) };
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

/** The list `arg` names with its columns and their items, column by column. */
export const readList = async (cmd: Command, arg: string | undefined): Promise<{ list: TodoList; columns: TodoColumn[]; items: TodoItem[] }> => {
  const path = await listAt(cmd, arg);
  const [{ columns, listed }] = await readBoards(cmd, [path]);
  const { open, total } = countOf(columns, listed);
  return { list: listOf(path, open, total), columns, items: await readColumns(cmd, path, columns, listed) };
};

/**
 * Make a list called `title`, the caller's own or, with `group`, in that group's shared home, with
 * its `done/`. The title is the folder's name, so a list of that title already there is refused.
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
  await cmd.sys.vfs.create(cmd.access, 'directory', `${root}/${name}`, DONE_DIR);
  return listOf(`${root}/${name}`, 0, 0);
};

/**
 * Who an item of the list at `path` may be given to: on a list of one's own only oneself, on a
 * group's every active member of the group, whether by a membership link or as their primary
 * group. Accounts and memberships are read as the administrator, since a member need not be able
 * to list `/etc`, and only for a list the caller can already read.
 */
export const membersOf = async (cmd: Command, path: string): Promise<TodoMember[]> => {
  const group = groupOf(path);
  const self = cmd.env.USER ?? '';
  const membersDir = `${GROUPS_PATH}/${group}/users`;
  const [accounts, links, gid] = await Promise.all([
    cmd.sys.vfs.children<UserAttrs>(ADMIN_ACCESS, USERS_PATH),
    group ? cmd.sys.vfs.children(ADMIN_ACCESS, membersDir).catch(() => []) : [],
    group ? cmd.sys.vfs.get(cmd.access, groupHomePath(group)).then((home) => home.props.gid) : undefined,
  ]);
  const linked = new Set(
    links.filter((entry) => entry.node.type === SOFTLINK_TYPE && entry.node.props.softlink && resolve(membersDir, entry.node.props.softlink) === `${USERS_PATH}/${entry.name}`)
      .map((entry) => entry.name),
  );
  const members = accounts.filter((entry) =>
    entry.node.type === 'user' && (group ? !entry.node.attrs.inactive && (entry.node.attrs.gid === gid || linked.has(entry.name)) : entry.name === self)
  );
  // An account's `person` link is the person it is, whose picture stands for it.
  const listed = await cmd.sys.vfs.childrenMany(ADMIN_ACCESS, members.map((entry) => `${USERS_PATH}/${entry.name}`));
  return members.map((entry, index): TodoMember => {
    const person = settledChildren(listed[index]).find((child) => child.name === 'person' && child.node.type === SOFTLINK_TYPE)?.node.props.softlink;
    return { username: entry.name, name: entry.node.attrs.name || entry.name, ...(person ? { personPath: resolve(`${USERS_PATH}/${entry.name}`, person) } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
};

/** `username` as an assignee of an item on the list at `path`, or a `TodoError` saying why not. */
const assignable = async (cmd: Command, path: string, username: string): Promise<string> => {
  const members = await membersOf(cmd, path);
  if (members.some((member) => member.username === username)) return username;
  throw new TodoError(groupOf(path) ? `'${username}' is not in the group '${groupOf(path)}'` : `an item on your own list can only be yours`);
};

// --- Items --------------------------------------------------------------------------------------

/** Whether `dir`, a folder of the list at `list`, makes what is in it done: its `done/` and `archived/`. */
const holdsDone = (list: string, dir: string): boolean => dir === `${list}/${DONE_DIR}` || dir === `${list}/${ARCHIVED_DIR}`;

/** Where the item at `path` is: in a list, in one of its column folders, or put away; undefined for anything else. */
const placeOf = (cmd: Command, path: string): Place | undefined => {
  const parent = dirname(path);
  if (isRoot(cmd, dirname(parent))) return { list: parent, column: parent, done: false };
  const list = dirname(parent);
  if (!isRoot(cmd, dirname(list)) || basename(parent).startsWith('.')) return undefined;
  return { list, column: parent, done: holdsDone(list, parent) };
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
  return { item: itemOf(place, path, doc, await linksIn(cmd, path, entries), node.props.birthtime?.timestamp), doc };
};

/** The item `arg` names, a path; a `TodoError` when it is not an item the caller can read. */
export const readItem = async (cmd: Command, arg: string | undefined): Promise<TodoItem> => (await itemAt(cmd, arg)).item;

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

/** Add an item titled `title` to the list at `list`, named for now, with `description` under its title if it has one. */
export const addItem = async (
  cmd: Command,
  list: string,
  title: string,
  extra: { description?: string; due?: string; assignee?: string; links?: string[] },
): Promise<TodoItem> => {
  const name = title.trim();
  if (!name) throw new TodoError('an item needs a title');
  const meta: Record<string, unknown> = {};
  if (extra.due) meta.due = dueDay(extra.due);
  if (extra.assignee) meta.assignee = await assignable(cmd, list, extra.assignee);
  const targets = await linkable(cmd, extra.links ?? []);
  // The name is free in done/ too, so the item can be ticked off and back without being renamed.
  const file = await freeName(cmd, [list, `${list}/${DONE_DIR}`], addedName());
  await cmd.sys.vfs.create(cmd.access, 'file', list, file, { props: { tier: 'db' }, attrs: { name: file, mimetype: ITEM_MIMETYPE, size: 0 } });
  await writeText(cmd, `${list}/${file}`, renderItem({ meta, body: withDescription(name, extra.description ?? '') }));
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
 * Move `item`, read as `doc`, into the folder `to` of its list under a name free there, marking it
 * done, saying who and when, as it comes into `done/` or `archived/` from elsewhere, and not done
 * as it leaves them. Answers its new path.
 */
const moveTo = async (cmd: Command, { item, doc }: { item: TodoItem; doc: ItemDoc }, to: string): Promise<string> => {
  const done = holdsDone(item.list, to);
  if (done !== item.done) {
    const meta = { ...doc.meta };
    if (done) {
      meta.done = new Date().toISOString();
      meta['done-by'] = cmd.env.USER ?? String(cmd.access.uid);
    } else {
      delete meta.done;
      delete meta['done-by'];
    }
    await writeText(cmd, item.path, renderItem({ ...doc, meta }));
  }
  if (to === item.column) return item.path;
  if (to !== item.list) await cmd.sys.vfs.ensure(cmd.access, 'directory', item.list, basename(to));
  const name = await freeName(cmd, [to], basename(item.path));
  await cmd.sys.vfs.rename(cmd.access, item.column, basename(item.path), to, name, { failIfExists: true });
  return `${to}/${name}`;
};

/** The column `arg` names on the list at `list`, a path: the list itself, or a folder in it other than `archived/`. */
const columnAt = async (cmd: Command, list: string, arg: string): Promise<string> => {
  const path = resolve(cmd.cwd, arg);
  if (path === list || path === `${list}/${DONE_DIR}`) return path;
  if (dirname(path) !== list) throw new TodoError(`${path}: not a column of ${list}`);
  if (basename(path) === ARCHIVED_DIR) throw new TodoError(`${path}: archived items are no column; todo-archive puts them there`);
  const node = await cmd.sys.vfs.get(cmd.access, path).catch(() => undefined);
  if (node?.type !== 'directory' || basename(path).startsWith('.')) throw new TodoError(`${path}: no such column`);
  return path;
};

/** Where `todo-move` puts an item: into a column, beside another item, or both when they agree. */
type MoveTarget = { column?: string; before?: string; after?: string };

/**
 * Put the item at `arg` into a column of its list, at its end, or just before or just after another
 * item, in that item's column; then number every item of that column from 1 in its new order,
 * writing only those whose number changed. Into Done it is marked done, out of it not done.
 */
export const moveItem = async (cmd: Command, arg: string, target: MoveTarget): Promise<TodoItem> => {
  const moving = await itemAt(cmd, arg);
  const { item } = moving;
  const besideArg = target.before ?? target.after;
  let to: string;
  let beside: string | undefined;
  if (besideArg !== undefined) {
    const { item: other } = await itemAt(cmd, besideArg);
    if (other.path === item.path) throw new TodoError('an item cannot be put beside itself');
    if (other.list !== item.list) throw new TodoError(`${other.path} is not on the same list`);
    if (other.column === `${item.list}/${ARCHIVED_DIR}`) throw new TodoError(`${other.path} is archived: it has no place on the board`);
    if (target.column !== undefined && await columnAt(cmd, item.list, target.column) !== other.column) {
      throw new TodoError(`${other.path} is not in ${resolve(cmd.cwd, target.column)}`);
    }
    to = other.column;
    beside = other.path;
  } else if (target.column !== undefined) {
    to = await columnAt(cmd, item.list, target.column);
  } else {
    throw new TodoError('give --column, --before or --after');
  }

  const path = await moveTo(cmd, moving, to);
  const others = (await readItems(cmd, { list: item.list, column: to, done: holdsDone(item.list, to) }, await children<FileAttrs>(cmd, to)))
    .filter((each) => each.path !== path);
  const at = beside === undefined ? others.length : others.findIndex((each) => each.path === beside);
  if (at === -1) throw new TodoError(`${beside}: not an item of the column`);
  const ordered = others.map((each) => ({ path: each.path, order: each.order }));
  ordered.splice(beside !== undefined && target.after !== undefined ? at + 1 : at, 0, { path, order: undefined });
  for (const [index, each] of ordered.entries()) {
    if (each.order === index + 1) continue;
    const { doc } = await itemAt(cmd, each.path);
    await writeText(cmd, each.path, renderItem({ ...doc, meta: { ...doc.meta, order: index + 1 } }));
  }
  return readItem(cmd, path);
};

/** The changes `todo-set` makes; null takes a field away. */
export type ItemChange = { title?: string; description?: string; due?: string | null; assignee?: string | null };

/** Change the item at `arg`: its title, description, due day or assignee, the rest of its text kept. */
export const updateItem = async (cmd: Command, arg: string, change: ItemChange): Promise<TodoItem> => {
  const { item, doc } = await itemAt(cmd, arg);
  const meta = { ...doc.meta };
  let body = doc.body;
  if (change.title !== undefined) {
    if (!change.title.trim()) throw new TodoError('an item needs a title');
    body = withTitle(body, change.title.trim());
  }
  if (change.description !== undefined) body = withDescription(change.title?.trim() || item.title, change.description);
  if (change.due === null) delete meta.due;
  else if (change.due !== undefined) meta.due = dueDay(change.due);
  if (change.assignee === null) delete meta.assignee;
  else if (change.assignee !== undefined) meta.assignee = await assignable(cmd, item.list, change.assignee);
  await writeText(cmd, item.path, renderItem({ meta, body }));
  return readItem(cmd, item.path);
};

/**
 * Mark the item at `arg` done, saying who and when, and move it to its list's `done/`; with
 * `undo`, take that away and move it back to Todo. An item already where it is asked to be is left
 * alone.
 */
export const markDone = async (cmd: Command, arg: string, undo: boolean): Promise<TodoItem> => {
  const found = await itemAt(cmd, arg);
  if (found.item.done !== undo) return found.item;
  return readItem(cmd, await moveTo(cmd, found, undo ? found.item.list : `${found.item.list}/${DONE_DIR}`));
};

/** Put each done item `args` names away in its list's `archived/`, off the board; one there already is left alone. */
export const archiveItems = async (cmd: Command, args: string[]): Promise<TodoItem[]> => {
  if (args.length === 0) throw new TodoError('nothing to archive: give one or more items');
  const found = await Promise.all(args.map((arg) => itemAt(cmd, arg)));
  const open = found.find(({ item }) => !item.done);
  if (open) throw new TodoError(`${open.item.path}: only a done item is archived`);
  const archived: TodoItem[] = [];
  for (const each of found) archived.push(await readItem(cmd, await moveTo(cmd, each, `${each.item.list}/${ARCHIVED_DIR}`)));
  return archived;
};

/** Say `error` on stderr as `name`'s failure, and answer the exit code for it. */
export const fail = async (cmd: Command, name: string, error: unknown): Promise<number> => {
  await cmd.writeError(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
};

/** One line for an item: whether it is done, its title, when it is due and whose it is. */
export const itemLine = (item: TodoItem): string =>
  `[${item.done ? 'x' : ' '}] ${item.title}${item.due ? `  due ${item.due}` : ''}${item.assignee ? `  @${item.assignee}` : ''}`;
