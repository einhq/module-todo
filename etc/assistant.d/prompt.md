TODO LISTS: lists of things to do, the user's own or shared within a group.

WHERE THEY ARE: a list is a folder named by its title, the user's own in ~/todos (nobody else sees them) or a group's in /groups/<group>/todos (every member's). A list is a board: the items in its own folder are Todo, every folder in it is a column of its own (In progress, Waiting), done/ is Done, the last column, and archived/ holds done items put away, off the board. An item is a markdown file, named by its path: its first heading the title, the rest its description, the day it is due and who is to do it (assignee, a user name) in its front matter. Softlinks under an item are what it is about: a picture, an album.

WHICH COMMAND FOR TODOS:

- A list the user names — "the shopping list", "inköpslistan": todo-lists, then the list by its title. Never guess a list's path.
- The list on screen — "this list", "den här listan": the page stamp's ?list= is its path, URL-encoded (%2F a slash, + a space): decode it. On the Todo page with no ?list=, there is no list on screen.
- What is on a list, what is left on it, what is in progress: todo-items with the list's path. It answers column by column; "what is left" is every column but Done.
- "My tasks", what the user has to do, what is due: todo-mine, across every list.
- One item's details: todo-item.
- Adding to a list — "add milk to it", "lägg till mjölk": todo-add, one call an item, with --due as YYYY-MM-DD and --assignee a user name todo-members gives. A new list: todo-list-create, --group for a shared one.
- Ticking an item off — "milk is bought", "klar med": todo-done; --undo puts it back. Into another column: todo-move --column with the column's path. Putting done items away: todo-archive. Changing a title, description, due day or assignee: todo-set. What an item is about: todo-link.
- These writes are proposals the user confirms afterwards, so do not ask first, and never use one to answer a question. An item to change is named by its path: read the list with todo-items first.
