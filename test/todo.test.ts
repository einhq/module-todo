/**
 * Todo lists through their commands: a list of one's own is nobody else's, a group's is every
 * member's and nobody else's, an item is a markdown file anyone may write by hand, a done item is
 * in its list's done/, a list's folders are the columns of its board, an item goes only to someone
 * who can see it, and Home's events carry the items falling due that are the reader's to do.
 */
import { assertEquals, assertMatch, assertRejects } from '@std/assert';
import { basename } from '@std/path';
import { createTestContext, type ShellClient } from '@ein/testing';
import { shq } from '@ein/client';
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
      assertEquals(list, { path: '/home/anna/todos/Before the trip', title: 'Before the trip', open: 0, total: 0 });
      trip = list.path;
      assertEquals((await bo.execJson<TodoList[]>('todo-lists')).some((each) => each.path === trip), false);
      await assertRejects(() => bo.execJson(`todo-items ${shq(trip)}`));
    });

    await t.step("a group's list is every member's, and nobody else's", async () => {
      const list = await anna.execJson<TodoList>('todo-list-create Shopping --group family');
      assertEquals(list, { path: '/groups/family/todos/Shopping', title: 'Shopping', group: 'family', open: 0, total: 0 });
      shopping = list.path;
      await bo.execJson<TodoItem>(`todo-add ${shopping} Milk`);
      const listing = await anna.execJson<TodoListing>(`todo-items ${shopping}`);
      assertEquals(listing.items.map((item) => item.title), ['Milk']);
      assertEquals((await cleo.execJson<TodoList[]>('todo-lists')).some((each) => each.path === shopping), false);
      await assertRejects(() => cleo.execJson(`todo-add ${shopping} Bread`));
      await assertRejects(() => cleo.execJson('todo-list-create Mine --group family'));
    });

    await t.step("a list's name is its title, so a second of the same title is refused", async () => {
      await assertRejects(() => bo.execJson<TodoList>('todo-list-create Shopping --group family'));
    });

    await t.step('an item is a markdown file named for when it was added, its title a heading', async () => {
      const [milk] = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items;
      assertMatch(milk.path, /^\/groups\/family\/todos\/Shopping\/\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
      assertEquals(await anna.execString(`cat ${milk.path}`), '# Milk\n');
    });

    await t.step('a file written by hand is an item whatever its name, its front matter read', async () => {
      await bo.execString(`printf '%s\\n' '---' 'due: 2026-11-30' '---' '# Candles' '' 'Unscented, for the table.' > ${shopping}/candles.md`);
      const candles = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items.find((item) => item.path.endsWith('/candles.md'));
      assertEquals([candles?.title, candles?.due, candles?.notes, candles?.done], ['Candles', '2026-11-30', 'Unscented, for the table.', false]);
      assertEquals((await bo.execJson<TodoItem>(`todo-item ${shopping}/candles.md`)).notes, 'Unscented, for the table.');
      const changed = await anna.execJson<TodoItem>(`todo-set ${shopping}/candles.md --title 'Tall candles'`);
      assertEquals([changed.title, changed.notes, changed.due], ['Tall candles', 'Unscented, for the table.', '2026-11-30']);
      await bo.execString(`rm ${shopping}/candles.md`);
    });

    await t.step("an item goes only to a member of the list's group, or on one's own list to oneself", async () => {
      assertEquals(await anna.execJson<TodoMember[]>(`todo-members ${shopping}`), [{ username: 'anna', name: 'Anna Andersson' }, { username: 'bo', name: 'Bo Andersson' }]);
      const item = await anna.execJson<TodoItem>(`todo-add ${shopping} Bread --assignee bo --due 2026-11-05`);
      assertEquals([item.assignee, item.due], ['bo', '2026-11-05']);
      assertEquals(await anna.execString(`cat ${item.path}`), '---\ndue: 2026-11-05\nassignee: bo\n---\n# Bread\n');
      await assertRejects(() => anna.execJson(`todo-add ${shopping} Cheese --assignee cleo`));
      await assertRejects(() => anna.execJson(`todo-add ${shq(trip)} Passport --assignee bo`));
      await assertRejects(() => anna.execJson(`todo-add ${shopping} Cheese --due tomorrow`));
      const changed = await anna.execJson<TodoItem>(`todo-set ${item.path} --no-assignee --title 'Rye bread'`);
      assertEquals([changed.title, changed.assignee], ['Rye bread', undefined]);
    });

    await t.step("todo-done moves the item to the list's done/ and says who did it and when, and --undo takes that back", async () => {
      const [milk] = (await bo.execJson<TodoListing>(`todo-items ${shopping}`)).items;
      const done = await anna.execJson<TodoItem>(`todo-done ${milk.path}`);
      assertEquals([done.path, done.done, done.doneBy, typeof done.doneAt], [milk.path.replace('/Shopping/', '/Shopping/done/'), true, 'anna', 'string']);
      assertEquals(await bo.execString(`cat ${done.path}`), `---\ndone: ${done.doneAt}\ndone-by: anna\n---\n# Milk\n`);
      assertEquals((await bo.execJson<TodoListing>(`todo-items ${shopping}`)).list, { path: shopping, title: 'Shopping', group: 'family', open: 1, total: 2 });
      assertEquals((await bo.execString(`ls ${shopping}`)).includes(basename(milk.path)), false);
      const undone = await bo.execJson<TodoItem>(`todo-done ${done.path} --undo`);
      assertEquals([undone.path, undone.done, undone.doneBy, undone.doneAt], [milk.path, false, undefined, undefined]);
      assertEquals(await bo.execString(`cat ${milk.path}`), '# Milk\n');
    });

    await t.step('an item in done/ is done whether or not its file says when', async () => {
      await bo.execString(`printf '# Batteries\\n' > ${shopping}/done/batteries.md`);
      const batteries = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items.find((item) => item.title === 'Batteries');
      assertEquals([batteries?.done, batteries?.doneAt], [true, undefined]);
      assertEquals((await anna.execJson<TodoItem>(`todo-done ${batteries!.path} --undo`)).path, `${shopping}/batteries.md`);
      await bo.execString(`rm ${shopping}/batteries.md`);
    });

    await t.step('todo-move puts an item before or after another, numbering the open items in their front matter', async () => {
      const titles = async () => (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items.filter((item) => !item.done).map((item) => item.title);
      const before = await titles();
      assertEquals(before, ['Milk', 'Rye bread']);
      const [milk, bread] = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items;
      const moved = await anna.execJson<TodoItem>(`todo-move ${bread.path} --before ${milk.path}`);
      assertEquals(moved.order, 1);
      assertEquals(await titles(), ['Rye bread', 'Milk']);
      assertEquals(await anna.execString(`cat ${milk.path}`), '---\norder: 2\n---\n# Milk\n');
      // An item added later, with no order, comes after those that have one.
      await bo.execJson(`todo-add ${shopping} Eggs`);
      assertEquals(await titles(), ['Rye bread', 'Milk', 'Eggs']);
      await assertRejects(() => anna.execJson(`todo-move ${milk.path}`));
    });

    await t.step("a list's folders are its board's columns, named by their name attr, between Todo and Done", async () => {
      const columns = async () => (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).columns.map((column) => [column.title, column.stage]);
      assertEquals(await columns(), [['Todo', 'todo'], ['Done', 'done']]);
      await bo.execString(`mkdir ${shopping}/basket ${shopping}/archived`);
      assertEquals(await columns(), [['Todo', 'todo'], ['basket', 'doing'], ['Done', 'done']]);
      await bo.execString(`attrs ${shopping}/basket -s 'name=In the basket'`);
      assertEquals(await columns(), [['Todo', 'todo'], ['In the basket', 'doing'], ['Done', 'done']]);
    });

    await t.step('todo-move takes an item between columns, marking it done in Done and not done out of it', async () => {
      const [bread, milk] = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items;
      const started = await anna.execJson<TodoItem>(`todo-move ${bread.path} --column ${shopping}/basket`);
      assertEquals([started.column, started.done, started.order], [`${shopping}/basket`, false, 1]);
      assertEquals((await anna.execJson<TodoListing>(`todo-items ${shopping}`)).list.open, 3);
      const done = await bo.execJson<TodoItem>(`todo-move ${milk.path} --column ${shopping}/done`);
      assertEquals([done.column, done.done, done.doneBy], [`${shopping}/done`, true, 'bo']);
      const back = await bo.execJson<TodoItem>(`todo-move ${done.path} --after ${started.path}`);
      assertEquals([back.column, back.done, back.doneAt, back.order], [`${shopping}/basket`, false, undefined, 2]);
      const mine = await anna.execJson<TodoItem>(`todo-move ${started.path} --before ${back.path}`);
      assertEquals(mine.order, 1);
      await assertRejects(() => anna.execJson(`todo-move ${back.path} --column ${shopping}/archived`));
      await assertRejects(() => anna.execJson(`todo-move ${back.path} --column ${shopping}/nothing`));
      const milkAgain = await anna.execJson<TodoItem>(`todo-move ${back.path} --column ${shopping}`);
      await anna.execJson(`todo-move ${started.path} --before ${milkAgain.path}`);
      assertEquals((await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items.map((item) => [item.title, item.column]), [
        ['Eggs', shopping],
        ['Rye bread', shopping],
        ['Milk', shopping],
      ]);
    });

    await t.step('todo-archive puts done items in archived/, off the board, and only done ones', async () => {
      const eggs = (await anna.execJson<TodoListing>(`todo-items ${shopping}`)).items.find((item) => item.title === 'Eggs')!;
      await assertRejects(() => anna.execJson(`todo-archive ${eggs.path}`));
      const done = await anna.execJson<TodoItem>(`todo-done ${eggs.path}`);
      const [archived] = await anna.execJson<TodoItem[]>(`todo-archive ${done.path}`);
      assertEquals([archived.column, archived.done, archived.doneBy], [`${shopping}/archived`, true, 'anna']);
      const listing = await anna.execJson<TodoListing>(`todo-items ${shopping}`);
      assertEquals([listing.items.some((item) => item.title === 'Eggs'), listing.list.open, listing.list.total], [false, 2, 2]);
      assertEquals((await anna.execJson<TodoItem>(`todo-done --undo ${archived.path}`)).column, shopping);
    });

    await t.step('an item links to what it is about, the links softlinks under its file that go with it to done/', async () => {
      await admin.execString('mkdir -p /groups/family/pictures && echo x > /groups/family/pictures/beach.jpg');
      const fix = await bo.execJson<TodoItem>(`todo-add ${shopping} 'Frame the picture' --link /groups/family/pictures/beach.jpg`);
      assertEquals(fix.links?.map((link) => [link.name, link.target, link.type]), [['beach.jpg', '/groups/family/pictures/beach.jpg', 'file']]);
      const twice = await anna.execJson<TodoItem>(`todo-link ${fix.path} /groups/family/pictures/beach.jpg`);
      assertEquals(twice.links?.map((link) => link.name), ['beach-2.jpg', 'beach.jpg']);
      await anna.execString(`rm ${fix.path}/beach-2.jpg`);
      const done = await anna.execJson<TodoItem>(`todo-done ${fix.path}`);
      // rm of a link leaves the picture where it was.
      assertEquals(done.links?.map((link) => [link.target, link.type]), [['/groups/family/pictures/beach.jpg', 'file']]);
      await assertRejects(() => anna.execJson(`todo-link ${done.path} /groups/family/pictures/nothing.jpg`));
      await bo.execString(`rm -r ${done.path}`);
    });

    await t.step("todo-mine is what is given to one, and one's own lists' items given to nobody", async () => {
      await anna.execJson(`todo-add ${shq(trip)} 'Renew the passport' --due 2026-11-20`);
      await bo.execJson(`todo-add ${shopping} Apples --assignee anna --due 2026-11-10`);
      const mine = await anna.execJson<TodoMine[]>('todo-mine');
      assertEquals(mine.map((item) => [item.title, item.listTitle, item.columnTitle, item.stage]), [['Apples', 'Shopping', 'Todo', 'todo'], [
        'Renew the passport',
        'Before the trip',
        'Todo',
        'todo',
      ]]);
      assertEquals((await bo.execJson<TodoMine[]>('todo-mine')).map((item) => item.title), []);
    });

    await t.step("Home's events carry what falls due that is the reader's to do", async () => {
      const window = '--today 2026-11-04 --days-ahead 30 --days-past 7 --limit 16';
      const annas = await anna.execJson<EventEntry[]>(`events-todo ${window}`);
      assertEquals(annas.map((entry) => [entry.date, entry.title]), [['2026-11-05', 'Rye bread (Shopping)'], ['2026-11-10', 'Apples (Shopping)'], [
        '2026-11-20',
        'Renew the passport (Before the trip)',
      ]]);
      assertEquals(annas[1].route.startsWith(`/todos?list=${encodeURIComponent(shopping)}&item=`), true);
      // Bo sees the unassigned bread, not Anna's apples nor her own list.
      assertEquals((await bo.execJson<EventEntry[]>(`events-todo ${window}`)).map((entry) => entry.title), ['Rye bread (Shopping)']);
      assertEquals(await cleo.execJson<EventEntry[]>(`events-todo ${window}`), []);
    });
  } finally {
    for (const client of clients) client.close();
  }
});
