import { useState } from 'react';
import type { Agent } from '../types/game';
import { professionColor } from './theme';

/** Circular avatar with 128x128 image, falling back to Chinese first character. */
export function AgentAvatar(props: {
  agent: Agent | null | undefined;
  size?: number;
  title?: string;
}) {
  const { agent, size = 36, title } = props;
  const [imgError, setImgError] = useState(false);

  // 优先用 display_name 的中文首字，其次用 name 的中文首字，最后 fallback 到首字符
  function getAvatarLabel(a: Agent): string {
    const raw = a.display_name || a.name;
    const m = raw.match(/[\u4e00-\u9fff]/);
    if (m) return m[0];
    return raw[0] ?? '?';
  }

  const ring = professionColor(agent?.profession ?? '');
  const label = agent ? getAvatarLabel(agent) : '?';

  // 尝试加载 128x128 头像图片
  const avatarSrc = agent
    ? `/assets/avatars/avatar128_${agent.display_name || agent.name}.png`
    : null;

  return (
    <span
      title={title ?? (agent ? `${agent.name} · ${agent.profession}` : '')}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `2px solid ${agent ? ring : '#555'}`,
        background: agent ? '#252540' : '#1a1a28',
        color: ring,
        fontSize: Math.max(11, Math.round(size * 0.32)),
        fontWeight: 'bold',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {avatarSrc && !imgError ? (
        <img
          src={avatarSrc}
          alt={label}
          width={size}
          height={size}
          onError={() => setImgError(true)}
          style={{ objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        label
      )}
    </span>
  );
}
