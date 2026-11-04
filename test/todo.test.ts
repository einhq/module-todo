/**
 * Todo lists through their commands: a list of one's own is nobody else's, a group's is every
 * member's and nobody else's, an item goes only to someone who can see it, and Home's events carry
 * the items falling due that are the reader's to do.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { createTestContext, type ShellClient } from '@ein/testing';
import type { EventEntry } from '@ein/api';
import type { TodoItem, TodoList, TodoListing, TodoMember, TodoMine } from '@todo/api';

const testCtx = createTestContext({ modules: ['todo'], boot: true });

Deno.test({ name: 'todo lists', sanitizeResources: false, sanitizeOps: false }, async (t) => {
  await testCtx.setup();
  const admin = await testCtx.server.createShellClient();
  const clients: ShellClient[] = [admin];

  try {
    for (const name of ['anna', 'bo', 'cleo']) {
      await admin.execString(`user-create ${name} --title '${name[0].toUpperCase()}${name.slice(1)} Andersson' && user-passwd ${name} --new-password hunter2`);
    }
    await admin.execString('group-create family --title Family --home && group-add-member family anna && group-add-member family bo');
    const signIn = async (username: string): Promise<ShellClient> => {
      const client = await testCtx.server.createShellClient({ username, password: 'hunter2' });
      clients.push(client);
      return client;
    };
    const anna = await signIn('anna');
    const bo = await signIn('bo');
    const cleo = await signIn('cleo');

    let shopping = '';
    let trip = '';

    await t.step("a list of one's own is in ~/todos, and nobody else sees it", async () => {
      const list = await anna.execJson<TodoList>("todo-list-create 'Before the trip'");
      assertEquals(list, { path: '/home/anna/todos/before-the-trip', title: 'Before the trip', open: 0, total: 0 });
      trip = list.path;
      assertEquals((await bo.execJson<TodoList[]>('todo-lists')).some((each) => each.path === trip), false);
      await assertRejects(() => bo.execJson(`todo-items ${trip}`));
    });

    await t.step("a group's list is every member's, and nobody else's", async () => {
      const list = await anna.execJson<TodoList>('todo-list-create Shopping --group family');
      assertEquals(list, { path: '/groups/family/todos/shopping', title: 'Shopping', group: 'family', open: 0, total: 0 });
      shopping = list.path;
      await bo.execJson<TodoItem>(`todo-add ${shopping} Milk`);
      const listing = await anna.execJson<TodoListing>(`todo-items ${shopping}`);
      assertEquals(listing.items.map((item) => item.title), ['Milk']);
      assertEquals((await cleo.execJson<TodoList[]>('todo-lists')).some((each) => each.path === shopping), false);
      await assertRejects(() => cleo.execJson(`todo-add ${shopping} Bread`));
      await assertRejects(() => cleo.execJson('todo-list-create Mine --group family'));
    });

    await t.step('a second list of the same title gets a name of its own', async () => {
      assertEquals((await bo.execJson<TodoList>('todo-list-create Shopping --group family')).path, '/groups/family/todos/shopping-2');
    });

    await t.step("an item goes only to a member of the list's group, or on one's own list to oneself", async () => {
      assertEquals(await anna.execJson<TodoMember[]>(`todo-members ${shopping}`), [{ username: 'anna', name: 'Anna Andersson' }, { username: 'bo', name: 'Bo Andersson' }]);
      const item = await anna.execJson<TodoItem>(`todo-add ${shopping} Bread --assignee bo --due 2026-11-05`);
      assertEquals([item.assignee, item.due], ['bo', '2026-11-05']);
      await assertRejects(() => anna.execJson(`todo-add ${shopping} Cheese --assignee cleo`));
      await assertRejects(() => anna.execJson(`todo-add ${trip} Passport --assignee bo`));
      await assertRejects(() => anna.execJson(`todo-add ${shopping} Cheese --due tomorrow`));
      const changed = await anna.execJson<TodoItem>(`todo-set ${item.path} --no-assignee --title 'Rye bread'`);
      assertEquals([changed.title, changed.assignee], ['Rye bread', undefined]);
    });

    await t.step('todo-done says who did it and when, and --undo takes that back', async () => {
      const [milk] = (await bo.execJson<TodoListing>(`todo-items ${shopping}`)).items;
      const done = await anna.execJson<TodoItem>(`todo-done ${milk.path}`);
      assertEquals([done.done, done.doneBy, typeof done.doneAt], [true, 'anna', 'string']);
      assertEquals((await bo.execJson<TodoListing>(`todo-items ${shopping}`)).list.open, 1);
      const undone = await bo.execJson<TodoItem>(`todo-done ${milk.path} --undo`);
      assertEquals([undone.done, undone.doneBy, undone.doneAt], [false, undefined, undefined]);
    });

    await t.step("todo-mine is what is given to one, and one's own lists' items given to nobody", async () => {
      await anna.execJson(`todo-add ${trip} 'Renew the passport' --due 2026-11-20`);
      await bo.execJson(`todo-add ${shopping} Apples --assignee anna --due 2026-11-10`);
      const mine = await anna.execJson<TodoMine[]>('todo-mine');
      assertEquals(mine.map((item) => [item.title, item.listTitle]), [['Apples', 'Shopping'], ['Renew the passport', 'Before the trip']]);
      assertEquals((await bo.execJson<TodoMine[]>('todo-mine')).map((item) => item.title), []);
    });

    await t.step("Home's events carry what falls due that is the reader's to do", async () => {
      const window = '--today 2026-11-04 --days-ahead 30 --days-past 7 --limit 16';
      const annas = await anna.execJson<EventEntry[]>(`events-todo ${window}`);
      assertEquals(annas.map((entry) => [entry.date, entry.title]), [['2026-11-05', 'Rye bread (Shopping)'], ['2026-11-10', 'Apples (Shopping)'], [
        '2026-11-20',
        'Renew the passport (Before the trip)',
      ]]);
      assertEquals(annas[1].route.startsWith('/todos?item='), true);
      // Bo sees the unassigned bread, not Anna's apples nor her own list.
      assertEquals((await bo.execJson<EventEntry[]>(`events-todo ${window}`)).map((entry) => entry.title), ['Rye bread (Shopping)']);
      assertEquals(await cleo.execJson<EventEntry[]>(`events-todo ${window}`), []);
    });
  } finally {
    for (const client of clients) client.close();
  }
});
