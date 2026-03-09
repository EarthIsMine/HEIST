import styled from 'styled-components';
import { useGameStore } from '../../stores/useGameStore';
import { getSocket } from '../../net/socket';
import {
  STEAL_RANGE,
  ARREST_RANGE,
  BREAK_JAIL_RANGE,
  WALL_COST_COINS,
} from '@heist/shared';
import type { Player, Storage } from '@heist/shared';

const BarContainer = styled.div`
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 10;

  @media (pointer: coarse) {
    left: auto;
    right: 16px;
    bottom: 80px;
    transform: none;
    flex-direction: column;
    align-items: flex-end;
  }
`;

const SkillButton = styled.button<{ $enabled: boolean; $color: string }>`
  background: ${(p) => (p.$enabled ? p.$color : '#333')};
  color: ${(p) => (p.$enabled ? '#fff' : '#666')};
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  border: 2px solid ${(p) => (p.$enabled ? p.$color : '#444')};
  pointer-events: auto;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover {
    filter: ${(p) => (p.$enabled ? 'brightness(1.2)' : 'none')};
  }

  @media (pointer: coarse) {
    padding: 12px 16px;
    font-size: 13px;
    border-radius: 12px;
  }
`;

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function findNearestStorage(player: Player, storages: Storage[]): Storage | null {
  let nearest: Storage | null = null;
  let minDist = Infinity;
  for (const s of storages) {
    if (s.remainingCoins <= 0) continue;
    const d = dist(player.position, s.position);
    if (d < minDist) {
      minDist = d;
      nearest = s;
    }
  }
  return nearest && minDist <= STEAL_RANGE + nearest.radius ? nearest : null;
}

function findNearestThief(player: Player, players: Player[]): Player | null {
  let nearest: Player | null = null;
  let minDist = Infinity;
  for (const p of players) {
    if (p.team !== 'thief' || p.isJailed || p.id === player.id) continue;
    const d = dist(player.position, p.position);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  return nearest && minDist <= ARREST_RANGE ? nearest : null;
}

export function SkillBar() {
  const snapshot = useGameStore((s) => s.snapshot);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const myTeam = useGameStore((s) => s.myTeam);

  if (!snapshot || !localPlayerId) return null;
  if (snapshot.phase === 'ended') return null;

  const me = snapshot.players.find((p) => p.id === localPlayerId);
  if (!me) return null;
  if (me.isJailed || me.isStunned) return null;

  const socket = getSocket();

  if (myTeam === 'thief') {
    const nearStorage = findNearestStorage(me, snapshot.storages);
    const canSteal = !!nearStorage && !me.channeling;
    const nearJail =
      dist(me.position, snapshot.jail.position) <= BREAK_JAIL_RANGE + snapshot.jail.radius;
    const canBreakJail = nearJail && snapshot.jail.inmates.length > 0 && !me.channeling;
    const canDisguise = !me.channeling && !me.isDisguised;
    const canBuildWall = !me.channeling && (snapshot.teamCoins ?? snapshot.stolenCoins) >= WALL_COST_COINS;

    return (
      <BarContainer>
        <SkillButton
          $enabled={canSteal}
          $color="#ffd700"
          onClick={() => {
            if (canSteal && nearStorage) {
              socket.emit('request_steal', nearStorage.id);
            }
          }}
        >
          Steal [Space]
        </SkillButton>
        <SkillButton
          $enabled={canBreakJail}
          $color="#2ed573"
          onClick={() => {
            if (canBreakJail) {
              socket.emit('request_break_jail');
            }
          }}
        >
          Break Jail [Space]
        </SkillButton>
        <SkillButton
          $enabled={canDisguise}
          $color="#9b59b6"
          onClick={() => {
            if (canDisguise) {
              socket.emit('request_disguise');
            }
          }}
        >
          Disguise [Q]{me.isDisguised ? ' (ON)' : ''}
        </SkillButton>
        <SkillButton
          $enabled={canBuildWall}
          $color="#e67e22"
          onClick={() => {
            if (canBuildWall) {
              socket.emit('request_build_wall');
            }
          }}
        >
          Wall [E] ({WALL_COST_COINS}c) - {Math.floor(snapshot.teamCoins ?? snapshot.stolenCoins)}c available
        </SkillButton>
        {me.channeling && (
          <SkillButton
            $enabled={true}
            $color="#ff4757"
            onClick={() => socket.emit('cancel_skill')}
          >
            Cancel
          </SkillButton>
        )}
      </BarContainer>
    );
  }

  if (myTeam === 'cop') {
    const nearThief = findNearestThief(me, snapshot.players);
    const canArrest = !!nearThief && !me.channeling;

    return (
      <BarContainer>
        <SkillButton
          $enabled={canArrest}
          $color="#4a9eff"
          onClick={() => {
            if (canArrest && nearThief) {
              socket.emit('request_arrest', nearThief.id);
            }
          }}
        >
          Arrest [Space]
        </SkillButton>
      </BarContainer>
    );
  }

  return null;
}
