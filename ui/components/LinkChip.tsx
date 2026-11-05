import { CloseButton, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { TablerIcon } from '@ein/ui/components';
import { useAlbumCover, useCover } from '@ein/ui/hooks';
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

/** The size of a link's picture beside its name, and alone. */
const COVER = 28;
const BARE_COVER = 36;

/**
 * The picture of what a link points at: a picture's own thumbnail, an album's cover or first
 * picture, the cover of a person, a place or a device; its glyph when it has none or it fails.
 */
function LinkCover({ link, size = COVER }: { link: TodoLink; size?: number }) {
  const [broken, setBroken] = useState(false);
  const media = isMedia(link);
  const album = useAlbumCover({ path: link.target, hasFilesDir: true }, link.type === 'album');
  const other = useCover(link.target, !!link.type && !media && link.type !== 'album' && link.type !== 'file' && link.type !== 'directory');
  const src = media ? thumbnailUrl(link.target, true) : link.type === 'album' ? album.coverUrl ?? album.coverFallbackUrl : other.coverUrl;
  if (!src || broken) return <TablerIcon name={linkIcon(link)} size={size === COVER ? 16 : 22} color={link.type ? undefined : 'var(--mantine-color-red-filled)'} />;
  return (
    <img
      src={src}
      alt=''
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4, display: 'block', flexShrink: 0 }}
    />
  );
}

/**
 * What an item is about: its cover or a glyph, and what it is called. It opens what it points at —
 * the page a module gives its type, the lightbox for a picture, or the file itself — and with
 * `onRemove` has a cross that takes the link away. `bare`, it is the cover alone, its name in the
 * tooltip, as a phone's row shows it.
 */
export function LinkChip({ link, onRemove, bare }: { link: TodoLink; onRemove?: () => void; bare?: boolean }) {
  const navigate = useNavigate();
  const open = () => {
    if (!link.type) return;
    const route = openRoute(link.type, link.target);
    if (route) navigate(route);
    else if (isMedia(link)) openFullscreen(lightboxRoute(link.target));
    else if (link.type === 'file') globalThis.open(fileUrl(link.target), '_blank');
  };
  const tip = link.type ? link.target : `${link.target}: gone, or not yours to see`;
  if (bare) {
    return (
      <Tooltip label={`${link.title} · ${tip}`}>
        <UnstyledButton onClick={open} disabled={!link.type} aria-label={link.title} style={{ display: 'flex', borderRadius: 4, opacity: link.type ? 1 : .5 }}>
          <LinkCover link={link} size={BARE_COVER} />
        </UnstyledButton>
      </Tooltip>
    );
  }
  return (
    <Group
      gap={6}
      wrap='nowrap'
      pl={4}
      pr={onRemove ? 2 : 8}
      py={2}
      style={{ borderRadius: 'var(--mantine-radius-sm)', background: 'var(--mrx-surface-raised)', maxWidth: 260 }}
    >
      <Tooltip label={tip}>
        <UnstyledButton onClick={open} disabled={!link.type} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <LinkCover link={link} />
          <Text size='xs' truncate c={link.type ? undefined : 'dimmed'}>{link.title}</Text>
        </UnstyledButton>
      </Tooltip>
      {onRemove && <CloseButton size='xs' onClick={onRemove} aria-label={`Unlink ${link.title}`} />}
    </Group>
  );
}
