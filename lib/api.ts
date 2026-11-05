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
  /** Items not done yet. */
  open: number;
  total: number;
};

/** One item, as `todo-items`, `todo-mine`, `todo-add` and the other item commands answer it. */
export type TodoItem = {
  path: string;
  /** The list it is in. */
  list: string;
  title: string;
  /** What the file says after its title. */
  notes?: string;
  /** Whether it is in its list's `done/`. */
  done: boolean;
  /** When it was marked done, as an ISO timestamp, when its file says so. */
  doneAt?: string;
  /** The username of whoever marked it done. */
  doneBy?: string;
  /** The day it is due, `YYYY-MM-DD`. */
  due?: string;
  /** The username of whoever is to do it. */
  assignee?: string;
  /** Its place on its list, from its front matter; items without one come after those with one. */
  order?: number;
  /** What it is about: the softlinks its file holds. */
  links?: TodoLink[];
};

/** A link an item holds to something it is about, such as a picture or an album. */
export type TodoLink = {
  name: string;
  /** The link's own path, under the item's. */
  path: string;
  /** The path it points at. */
  target: string;
  /** The type of the node it points at; absent when that is gone or hidden from the reader. */
  type?: string;
  mimetype?: string;
};

/** `todo-items`: the list and its items, the open ones and then the done ones, each in their order: by `order`, then as they were added. */
export type TodoListing = { list: TodoList; items: TodoItem[] };

/** `todo-mine`: an item, with the list it is in. */
export type TodoMine = TodoItem & { listTitle: string; group?: string };

/** `todo-members`: someone an item of the list may be given to. */
export type TodoMember = { username: string; name: string };
