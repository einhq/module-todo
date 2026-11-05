/**
 * What the todo commands answer under `JSON_OUTPUT=1`. Import-free, for the commands, the pages and
 * other modules alike.
 */

/** A todo list, as `todo-lists` and `todo-items` answer it. */
export type TodoList = {
  path: string;
  /** Its folder's name. */
  title: string;
  /** The group whose shared home holds it; absent for a list of the reader's own. */
  group?: string;
  /** Items not done yet, in any column but Done. */
  open: number;
  /** Items in every column, Done too; archived ones are not counted. */
  total: number;
};

/**
 * A column of a list's board. The list's own folder is Todo, what is not started; every folder in
 * it is a column, its `done/` Done, last, whether or not the folder is there yet. `archived/` is
 * no column.
 */
export type TodoColumn = {
  path: string;
  /** Todo for the list itself; else the folder's `name` attr, or its name (Done for `done/`). */
  title: string;
  /** Not started, started, or done. */
  stage: 'todo' | 'doing' | 'done';
};

/** One item, as `todo-items`, `todo-mine`, `todo-add` and the other item commands answer it. */
export type TodoItem = {
  path: string;
  /** The list it is in. */
  list: string;
  /** The column it is in: the list itself, a folder in it, or the list's `archived/`. */
  column: string;
  title: string;
  /** What the file says after its title. */
  description?: string;
  /** When it was added, as an ISO timestamp: when its file was made. */
  added?: string;
  /** Whether it is in its list's `done/` or `archived/`. */
  done: boolean;
  /** When it was marked done, as an ISO timestamp, when its file says so. */
  doneAt?: string;
  /** The username of whoever marked it done. */
  doneBy?: string;
  /** The day it is due, `YYYY-MM-DD`. */
  due?: string;
  /** The username of whoever is to do it. */
  assignee?: string;
  /** Its place in its column, from its front matter; items without one come after those with one. */
  order?: number;
  /** What it is about: the softlinks its file holds. */
  links?: TodoLink[];
};

/** A link an item holds to something it is about, such as a picture or an album. */
export type TodoLink = {
  /** The link's own name, under the item. */
  name: string;
  /** What it points at is called: that node's `name` attr, else its node name. */
  title: string;
  /** The link's own path, under the item's. */
  path: string;
  /** The path it points at. */
  target: string;
  /** The type of the node it points at; absent when that is gone or hidden from the reader. */
  type?: string;
  mimetype?: string;
};

/**
 * `todo-items`: the list, its columns in their order, and the items of each column in turn, each
 * column's in their order: by `order`, then as they were added.
 */
export type TodoListing = { list: TodoList; columns: TodoColumn[]; items: TodoItem[] };

/** `todo-mine`: an item, with the list and the column it is in. */
export type TodoMine = TodoItem & { listTitle: string; group?: string; columnTitle: string; stage: TodoColumn['stage'] };

/** `todo-members`: someone an item of the list may be given to. */
export type TodoMember = {
  username: string;
  name: string;
  /** The person the account is, whose picture stands for it, when the account is linked to one. */
  personPath?: string;
};
