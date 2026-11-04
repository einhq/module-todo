/**
 * What the todo commands answer under `JSON_OUTPUT=1`. Import-free, for the commands, the pages and
 * other modules alike.
 */

/** A todo list, as `todo-lists` and `todo-items` answer it. */
export type TodoList = {
  path: string;
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
  done: boolean;
  /** When it was marked done, as an ISO timestamp. */
  doneAt?: string;
  /** The username of whoever marked it done. */
  doneBy?: string;
  /** The day it is due, `YYYY-MM-DD`. */
  due?: string;
  /** The username of whoever is to do it. */
  assignee?: string;
};

/** `todo-items`: the list and its items, in the order they were added. */
export type TodoListing = { list: TodoList; items: TodoItem[] };

/** `todo-mine`: an item, with the list it is in. */
export type TodoMine = TodoItem & { listTitle: string; group?: string };

/** `todo-members`: someone an item of the list may be given to. */
export type TodoMember = { username: string; name: string };
