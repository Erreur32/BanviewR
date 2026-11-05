import { useState } from 'react';
import type { UserInfo } from '../../shared/auth.ts';
import { initials, tintOf } from '../avatar.ts';

export function Avatar({ user, size = 28 }: { user: Pick<UserInfo, 'id' | 'username' | 'avatarAt'>; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (user.avatarAt && broken !== user.avatarAt) {
    return (
      <img
        src={`/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarAt)}`}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover"
        onError={() => setBroken(user.avatarAt)}
      />
    );
  }
  const [bg, ink] = tintOf(user.username);
  return (
    <span
      aria-hidden="true"
      style={{ ...style, background: bg, color: ink, fontSize: Math.round(size * 0.4) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
    >
      {initials(user.username)}
    </span>
  );
}
