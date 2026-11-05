import { Combobox, Group, Loader, Text, TextInput, useCombobox } from '@mantine/core';
import { entityKindIcon, TablerIcon } from '@ein/ui/components';
import { type EntityCompleteKind, useEntityComplete } from '@ein/ui/hooks';
import { searchableKinds } from '@ein/ui/signals';
import { useState } from 'react';

/**
 * A box that finds something to link by its name, as the top bar's finder does: the people, places,
 * albums and the other kinds the Search page finds. A path typed whole, from `/`, is offered as it
 * is, which is how a picture or a folder is linked. `onPick` gets the path chosen.
 */
export function NodeFinder({ onPick, disabled }: { onPick: (path: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const kinds = searchableKinds.value.map((entry) => entry.kind as EntityCompleteKind);
  const typed = query.trim();
  const asPath = typed.startsWith('/');
  const { hits, loading } = useEntityComplete(typed && !asPath ? typed : undefined, kinds);

  const pick = (path: string) => {
    onPick(path);
    setQuery('');
    combobox.closeDropdown();
  };

  const options = [
    ...(asPath ? [{ path: typed, name: typed, kind: 'path', icon: <TablerIcon name='folder' size={18} /> }] : []),
    ...hits.map((hit) => ({ path: hit.path, name: hit.name, kind: hit.kind, icon: entityKindIcon(hit.kind, 18) })),
  ];

  return (
    <Combobox store={combobox} onOptionSubmit={pick} withinPortal={false}>
      <Combobox.Target>
        <TextInput
          label='Link to'
          placeholder='Find a person, a place or an album, or type a path'
          value={query}
          disabled={disabled}
          leftSection={<TablerIcon name='link' size={14} />}
          rightSection={loading ? <Loader size={14} /> : undefined}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={!typed}>
        <Combobox.Options mah={260} style={{ overflowY: 'auto' }}>
          {options.length === 0 && <Combobox.Empty>{loading ? 'Looking…' : 'Nothing of that name'}</Combobox.Empty>}
          {options.map((option) => (
            <Combobox.Option key={`${option.kind}:${option.path}`} value={option.path}>
              <Group gap='xs' wrap='nowrap'>
                {option.icon}
                <Text size='sm' truncate style={{ flex: 1, minWidth: 0 }}>{option.name}</Text>
                <Text size='xs' c='dimmed'>{option.kind}</Text>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
