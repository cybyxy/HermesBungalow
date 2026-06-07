import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Agent } from '../types/game';
import { professionColor } from './theme';
import { getPersonSheetUrl, isPersonSheetBase } from './personSprites';
import { getSpriteFrame, getSpriteSliceUrl, resolveSpriteBase } from './spriteMap';

/** 圆形头像：`person` 雪碧首格 / 对齐散图 / 根目录散图，失败则首字。 */
export function AgentAvatar(props: {
  agent: Agent | null | undefined;
  size?: number;
  title?: string;
}) {
  const { agent, size = 36, title } = props;
  const [imgError, setImgError] = useState(false);
  const [sliceSrc, setSliceSrc] = useState('');

  const ring = professionColor(agent?.profession ?? '');
  const spriteSeed = agent ? (agent.profile ?? agent.id) : '';
  const base = agent
    ? resolveSpriteBase(agent.avatar, agent.gender, agent.personality, agent.name, spriteSeed)
    : '';
  const personMode = Boolean(agent && isPersonSheetBase(base));

  function getAvatarLabel(a: Agent): string {
    const raw = a.display_name || a.name;
    const m = raw.match(/[\u4e00-\u9fff]/);
    if (m) return m[0];
    return raw[0] ?? '?';
  }

  const label = agent ? getAvatarLabel(agent) : '?';

  useEffect(() => {
    if (!agent || personMode) {
      setSliceSrc('');
      setImgError(false);
      return;
    }
    setSliceSrc(
      getSpriteFrame(agent.avatar, agent.gender, agent.personality, agent.name, 'down', 0, spriteSeed),
    );
    setImgError(false);
  }, [agent, personMode, spriteSeed]);

  const onSliceError = useCallback(() => {
    if (!agent) return;
    const b = resolveSpriteBase(agent.avatar, agent.gender, agent.personality, agent.name, spriteSeed);
    const raw = getSpriteSliceUrl(b, 'down', 0);
    if (sliceSrc !== raw) {
      setSliceSrc(raw);
    } else {
      setImgError(true);
    }
  }, [agent, sliceSrc, spriteSeed]);

  const outer: CSSProperties = {
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
    position: 'relative',
  };

  const wScale = 3 * size;
  const hScale = 4 * size;

  return (
    <span
      title={title ?? (agent ? `${agent.display_name || agent.name} · ${agent.profession}` : '')}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <span style={outer}>
        {agent && personMode && !imgError ? (
          <img
            src={getPersonSheetUrl(base)}
            alt=""
            width={wScale}
            height={hScale}
            onError={() => setImgError(true)}
            draggable={false}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: wScale,
              height: hScale,
              objectFit: 'fill',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
            }}
          />
        ) : agent && sliceSrc && !imgError ? (
          <img
            src={sliceSrc}
            alt={label}
            width={size}
            height={size}
            onError={onSliceError}
            draggable={false}
            style={{
              width: size,
              height: size,
              objectFit: 'cover',
              borderRadius: '50%',
              imageRendering: 'pixelated',
            }}
          />
        ) : (
          label
        )}
      </span>
    </span>
  );
}
