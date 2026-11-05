import { CloseButton, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { TablerIcon } from '@ein/ui/components';
import { fileUrl, lightboxRoute, thumbnailUrl } from '@ein/ui/lib';
import { openFullscreen, openRoute } from '@ein/ui/signals';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TodoLink } from '../../lib/api.ts';

/** Whether a link points at a picture or a video, which the lightbox shows and which has a thumbnail. */
const isMedia = (link: TodoLink): boolean => link.type === 'file' && /^(image|video)\//.test(link.mimetype ?? '');

/** The glyph for what a link points at. */
const linkIcon = (link: TodoLink): string => {
  if (!link.type) return 'link-off';
  if (isMedia(link)) return 'photo';
  return ({ album: 'library-photo', directory: 'folder', person: 'user', location: 'map-pin' } as Record<string, string>)[link.type] ?? 'file';
};

/**
 * What an item is about: a thumbnail or a glyph, and the link's name. It opens what it points at —
 * the page a module gives its type, the lightbox for a picture, or the file itself — and with
 * `onRemove` has a cross that takes the link away.
 */
export function LinkChip({ link, onRemove }: { link: TodoLink; onRemove?: () => void }) {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);
  const open = () => {
    if (!link.type) return;
    const route = openRoute(link.type, link.target);
    if (route) navigate(route);
    else if (isMedia(link)) openFullscreen(lightboxRoute(link.target));
    else if (link.type === 'file') globalThis.open(fileUrl(link.target), '_blank');
  };
  return (
    <Group
      gap={6}
      wrap='nowrap'
      pl={4}
      pr={onRemove ? 2 : 8}
      py={2}
      style={{ borderRadius: 'var(--mantine-radius-sm)', background: 'var(--mrx-surface-raised)', maxWidth: 260 }}
    >
      <Tooltip label={link.type ? link.target : `${link.target}: gone, or not yours to see`}>
        <UnstyledButton onClick={open} disabled={!link.type} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {isMedia(link) && !broken
            ? (
              <img
                src={thumbnailUrl(link.target, true)}
                alt=''
                width={28}
                height={28}
                onError={() => setBroken(true)}
                style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, display: 'block', flexShrink: 0 }}
              />
            )
            : <TablerIcon name={linkIcon(link)} size={16} color={link.type ? undefined : 'var(--mantine-color-red-filled)'} />}
          <Text size='xs' truncate c={link.type ? undefined : 'dimmed'}>{link.name}</Text>
        </UnstyledButton>
      </Tooltip>
      {onRemove && <CloseButton size='xs' onClick={onRemove} aria-label={`Unlink ${link.name}`} />}
    </Group>
  );
}
