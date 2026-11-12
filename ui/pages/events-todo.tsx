import { Box, Group, Text, ThemeIcon } from '@mantine/core';
import { TablerIcon } from '@ein/ui/components';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * One `events-todo` entry, as Home's events and a dashboard's Coming up draw it: the item's title
 * and its list, linking to the item on its list's board. Everything it shows is in its query
 * (`item`, `list`, `title`, `listTitle`), so it runs nothing; the page beside it says when.
 */
export default function EventsTodoEntry() {
  const [params] = useSearchParams();
  const item = params.get('item') ?? '';
  const list = params.get('list') ?? '';
  return (
    <Box component={Link} to={`/todos?list=${encodeURIComponent(list)}&item=${encodeURIComponent(item)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
        <ThemeIcon size={30} radius='xl' variant='light' color='yellow' style={{ flex: 'none' }}>
          <TablerIcon name='list-check' size={16} />
        </ThemeIcon>
        <Text size='sm' lineClamp={2} style={{ minWidth: 0 }}>
          {params.get('title')} <Text span c='dimmed' inherit>· {params.get('listTitle')}</Text>
        </Text>
      </Group>
    </Box>
  );
}
