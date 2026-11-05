import { Avatar } from '@mantine/core';
import { CoverAvatar } from '@ein/ui/components';
import type { TodoMember } from '../../lib/api.ts';

/** A name's initials, for a face with no picture. */
const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toLocaleUpperCase()).join('') || '?';

/** Someone as a small round face: their person's picture, else their initials. */
export function Face({ username, members, size = 26 }: { username: string; members: TodoMember[]; size?: number }) {
  const member = members.find((each) => each.username === username);
  const name = member?.name ?? username;
  if (member?.personPath) return <CoverAvatar path={member.personPath} fallback={initialsOf(name)} size={size} radius='xl' alt={name} eager />;
  return <Avatar size={size} radius='xl' name={name} color='initials' alt={name} />;
}
