import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletButton } from '../components/common/WalletButton';
import { useLobbyStore } from '../stores/useLobbyStore';
import { useGameStore } from '../stores/useGameStore';
import { getSocket } from '../net/socket';
import { buildEntryFeeTx } from '../solana/entryFee';

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
import { playBGM, stopBGM } from '../audio/bgm';
import { ENTRY_FEE_LAMPORTS, COP_COUNT, THIEF_COUNT } from '@heist/shared';
import type { Team, RoomInfo } from '@heist/shared';

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 700px;
  margin-bottom: 32px;
`;

const Title = styled.h1`
  font-size: 36px;
  font-weight: 800;
  background: linear-gradient(135deg, #00d4ff, #ff6b35);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 4px;
`;

const Content = styled.div`
  width: 100%;
  max-width: 700px;
`;

const Section = styled.div`
  background: #131a2b;
  border: 1px solid #1e2a3a;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.h2`
  font-size: 18px;
  margin-bottom: 16px;
  color: #e8e8e8;
`;

const Input = styled.input`
  width: 100%;
  padding: 10px 14px;
  background: #0a0e17;
  border: 1px solid #1e2a3a;
  border-radius: 6px;
  color: #e8e8e8;
  font-size: 14px;
  margin-bottom: 12px;

  &::placeholder {
    color: #8892a4;
  }
`;

const Button = styled.button<{ $variant?: string }>`
  padding: 10px 24px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  background: ${(p) =>
    p.$variant === 'secondary'
      ? '#1e2a3a'
      : p.$variant === 'success'
        ? '#2ed573'
        : '#00d4ff'};
  color: ${(p) => (p.$variant === 'secondary' ? '#e8e8e8' : '#000')};
  margin-right: 8px;
`;

const TeamColumns = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 12px;
`;

const TeamColumn = styled.div<{ $team: string }>`
  flex: 1;
  border: 1px solid ${(p) => (p.$team === 'cop' ? 'rgba(74, 158, 255, 0.3)' : 'rgba(255, 71, 87, 0.3)')};
  border-radius: 8px;
  padding: 12px;
  background: ${(p) => (p.$team === 'cop' ? 'rgba(74, 158, 255, 0.05)' : 'rgba(255, 71, 87, 0.05)')};
`;

const TeamColumnTitle = styled.div<{ $team: string }>`
  font-size: 13px;
  font-weight: 700;
  color: ${(p) => (p.$team === 'cop' ? '#4a9eff' : '#ff4757')};
  margin-bottom: 8px;
  text-align: center;
`;

const PlayerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PlayerRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #0a0e17;
  border-radius: 6px;
  font-size: 13px;
`;

const EmptySlot = styled.div`
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed #1e2a3a;
  color: #555;
  font-size: 12px;
  text-align: center;
`;

const Badge = styled.span<{ $color: string }>`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${(p) => p.$color};
  color: #000;
  font-weight: 600;
`;

const InfoText = styled.p`
  color: #8892a4;
  font-size: 13px;
  margin-top: 8px;
`;

const RoomCard = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #0a0e17;
  border: 1px solid #1e2a3a;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover {
    border-color: #00d4ff;
  }
`;

const RoomCardInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RoomCardName = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: #e8e8e8;
`;

const RoomCardPlayers = styled.span`
  font-size: 12px;
  color: #8892a4;
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  color: #8892a4;
  font-size: 12px;

  &::before, &::after {
    content: '';
    flex: 1;
    border-top: 1px solid #1e2a3a;
  }
`;

const TeamSelector = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
`;

const TeamButton = styled.button<{ $active: boolean; $team: string; $disabled?: boolean }>`
  flex: 1;
  padding: 16px;
  border-radius: 10px;
  font-weight: 700;
  font-size: 16px;
  border: 3px solid ${(p) =>
    p.$disabled
      ? '#1e2a3a'
      : p.$active
        ? p.$team === 'cop' ? '#4a9eff' : '#ff4757'
        : '#1e2a3a'};
  background: ${(p) =>
    p.$disabled
      ? '#0a0e17'
      : p.$active
        ? p.$team === 'cop' ? 'rgba(74, 158, 255, 0.15)' : 'rgba(255, 71, 87, 0.15)'
        : '#0a0e17'};
  color: ${(p) =>
    p.$disabled
      ? '#555'
      : p.$team === 'cop' ? '#4a9eff' : '#ff4757'};
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.15s;

  &:hover {
    border-color: ${(p) => p.$disabled ? '#1e2a3a' : p.$team === 'cop' ? '#4a9eff' : '#ff4757'};
  }
`;

export function LobbyPage() {
  const navigate = useNavigate();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const currentRoom = useLobbyStore((s) => s.currentRoom);
  const entryPaid = useLobbyStore((s) => s.entryPaid);
  const isReady = useLobbyStore((s) => s.isReady);
  const setEntryPaid = useLobbyStore((s) => s.setEntryPaid);
  const setReady = useLobbyStore((s) => s.setReady);
  const snapshot = useGameStore((s) => s.snapshot);

  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [paying, setPaying] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team>('thief');
  const [availableRooms, setAvailableRooms] = useState<RoomInfo[]>([]);

  useEffect(() => {
    playBGM('/bgm/lobby.mp3');
    return () => stopBGM();
  }, []);

  // Leave room when wallet disconnects
  const reset = useLobbyStore((s) => s.reset);
  useEffect(() => {
    if (!connected && currentRoom) {
      getSocket().disconnect();
      getSocket().connect();
      reset();
    }
  }, [connected, currentRoom, reset]);

  // Fetch room list periodically
  useEffect(() => {
    if (currentRoom) return;
    const fetchRooms = () => {
      getSocket().emit('list_rooms', (rooms) => {
        setAvailableRooms(rooms);
      });
    };
    fetchRooms();
    const interval = setInterval(fetchRooms, 3000);
    return () => clearInterval(interval);
  }, [currentRoom]);

  // Navigate to game when game starts
  useEffect(() => {
    if (snapshot && snapshot.phase !== 'lobby') {
      navigate(`/game/${currentRoom?.id || 'live'}`);
    }
  }, [snapshot, currentRoom, navigate]);

  // Fetch balance
  useEffect(() => {
    if (!publicKey) return;
    connection.getBalance(publicKey).then((bal) => {
      setBalance(bal / LAMPORTS_PER_SOL);
    });
  }, [publicKey, connection]);

  const handleJoin = useCallback(() => {
    if (!connected || !publicKey) return;
    const name = playerName.trim() || `Player-${publicKey.toBase58().slice(0, 4)}`;
    const socket = getSocket();

    socket.emit(
      'join_room',
      roomId,
      { name, walletAddress: publicKey.toBase58(), requestId: createRequestId() },
      (result) => {
        if (!result.ok) {
          // 서버가 핫샤드 회피용 roomId를 제안하면 입력값을 갱신해 다음 시도를 돕는다.
          if (result.suggestedRoomId) {
            setRoomId(result.suggestedRoomId);
          }
          const message = result.retryAfterSec
            ? `${result.error || 'Failed to join room'} (retry in ${result.retryAfterSec}s)`
            : result.error || 'Failed to join room';
          alert(result.suggestedRoomId ? `${message}\nSuggested room: ${result.suggestedRoomId}` : message);
        }
      },
    );
  }, [connected, publicKey, playerName, roomId]);

  const handlePayEntry = useCallback(async () => {
    if (!publicKey || !sendTransaction) return;

    // Free entry: skip payment
    if (ENTRY_FEE_LAMPORTS === 0) {
      getSocket().emit('confirm_entry', 'free', (result) => {
        if (result.ok) {
          setEntryPaid(true, 'free');
        }
      });
      return;
    }

    setPaying(true);
    try {
      const escrowPubkey = new PublicKey(
        import.meta.env.VITE_ESCROW_PUBKEY || publicKey.toBase58(),
      );
      const tx = buildEntryFeeTx(publicKey, escrowPubkey);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      getSocket().emit('confirm_entry', sig, (result) => {
        if (result.ok) {
          setEntryPaid(true, sig);
        }
      });
    } catch (err) {
      console.error('Entry fee payment failed:', err);
      alert('Payment failed. Make sure you have enough SOL on devnet.');
    } finally {
      setPaying(false);
    }
  }, [publicKey, sendTransaction, connection, setEntryPaid]);

  const handleSelectTeam = useCallback((team: Team) => {
    getSocket().emit('select_team', team, (result) => {
      if (result.ok) {
        setSelectedTeam(team);
      }
    });
  }, []);

  const handleReady = useCallback(() => {
    getSocket().emit('ready');
    setReady(true);
  }, [setReady]);

  return (
    <Container>
      <Header>
        <Title>HEIST</Title>
        <WalletButton />
      </Header>

      <Content>
        {!currentRoom ? (
          <>
            <Section>
              <SectionTitle>Your Name</SectionTitle>
              <Input
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
              />
              {balance !== null && (
                <InfoText>Balance: {balance.toFixed(4)} SOL (devnet)</InfoText>
              )}
            </Section>

            {availableRooms.length > 0 && (
              <Section>
                <SectionTitle>Available Rooms</SectionTitle>
                {availableRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    onClick={() => {
                      setRoomId(room.id);
                      if (connected && publicKey) {
                        const name = playerName.trim() || `Player-${publicKey.toBase58().slice(0, 4)}`;
                        getSocket().emit(
                          'join_room',
                          room.id,
                          { name, walletAddress: publicKey.toBase58(), requestId: createRequestId() },
                          (result) => {
                            if (!result.ok) {
                              if (result.suggestedRoomId) {
                                setRoomId(result.suggestedRoomId);
                              }
                              const message = result.retryAfterSec
                                ? `${result.error || 'Failed to join'} (retry in ${result.retryAfterSec}s)`
                                : result.error || 'Failed to join';
                              alert(result.suggestedRoomId ? `${message}\nSuggested room: ${result.suggestedRoomId}` : message);
                            }
                          },
                        );
                      }
                    }}
                  >
                    <RoomCardInfo>
                      <RoomCardName>{room.name}</RoomCardName>
                      <RoomCardPlayers>
                        {room.players.length}/{room.maxPlayers} players
                      </RoomCardPlayers>
                    </RoomCardInfo>
                    <Badge $color="#00d4ff">JOIN</Badge>
                  </RoomCard>
                ))}
              </Section>
            )}

            <Section>
              <SectionTitle>Create or Join Room</SectionTitle>
              <Input
                placeholder="Room ID (e.g. my-room)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
              <Button onClick={handleJoin} disabled={!connected || !roomId.trim()}>
                {connected ? 'Create / Join Room' : 'Connect Wallet First'}
              </Button>
            </Section>
          </>
        ) : (
          <>
            <Section>
              <SectionTitle>
                {currentRoom.name} ({currentRoom.players.length}/{currentRoom.maxPlayers})
              </SectionTitle>

              <TeamColumns>
                <TeamColumn $team="cop">
                  <TeamColumnTitle $team="cop">POLICE ({currentRoom.players.filter((p) => p.selectedTeam === 'cop').length}/{COP_COUNT})</TeamColumnTitle>
                  <PlayerList>
                    {currentRoom.players.filter((p) => p.selectedTeam === 'cop').map((p) => (
                      <PlayerRow key={p.id}>
                        <span>{p.name}</span>
                        <div>
                          {p.ready && <Badge $color="#4a9eff">Ready</Badge>}
                        </div>
                      </PlayerRow>
                    ))}
                    {Array.from({ length: COP_COUNT - currentRoom.players.filter((p) => p.selectedTeam === 'cop').length }).map((_, i) => (
                      <EmptySlot key={`cop-empty-${i}`}>BOT</EmptySlot>
                    ))}
                  </PlayerList>
                </TeamColumn>
                <TeamColumn $team="thief">
                  <TeamColumnTitle $team="thief">THIEF ({currentRoom.players.filter((p) => p.selectedTeam === 'thief').length}/{THIEF_COUNT})</TeamColumnTitle>
                  <PlayerList>
                    {currentRoom.players.filter((p) => p.selectedTeam === 'thief').map((p) => (
                      <PlayerRow key={p.id}>
                        <span>{p.name}</span>
                        <div>
                          {p.ready && <Badge $color="#ff4757">Ready</Badge>}
                        </div>
                      </PlayerRow>
                    ))}
                    {Array.from({ length: THIEF_COUNT - currentRoom.players.filter((p) => p.selectedTeam === 'thief').length }).map((_, i) => (
                      <EmptySlot key={`thief-empty-${i}`}>BOT</EmptySlot>
                    ))}
                  </PlayerList>
                </TeamColumn>
              </TeamColumns>
            </Section>

            <Section>
              <SectionTitle>Choose Your Team</SectionTitle>
              {(() => {
                const copCount = currentRoom.players.filter((p) => p.selectedTeam === 'cop').length;
                const thiefCount = currentRoom.players.filter((p) => p.selectedTeam === 'thief').length;
                const copFull = selectedTeam !== 'cop' && copCount >= COP_COUNT;
                const thiefFull = selectedTeam !== 'thief' && thiefCount >= THIEF_COUNT;
                return (
                  <TeamSelector>
                    <TeamButton
                      $active={selectedTeam === 'cop'}
                      $team="cop"
                      $disabled={copFull}
                      onClick={() => !copFull && handleSelectTeam('cop')}
                    >
                      POLICE ({copCount}/{COP_COUNT})
                    </TeamButton>
                    <TeamButton
                      $active={selectedTeam === 'thief'}
                      $team="thief"
                      $disabled={thiefFull}
                      onClick={() => !thiefFull && handleSelectTeam('thief')}
                    >
                      THIEF ({thiefCount}/{THIEF_COUNT})
                    </TeamButton>
                  </TeamSelector>
                );
              })()}
              <InfoText>Remaining slots will be filled with bots.</InfoText>
            </Section>

            <Section>
              <SectionTitle>Ready Up</SectionTitle>

              {ENTRY_FEE_LAMPORTS > 0 && !entryPaid ? (
                <>
                  <Button onClick={handlePayEntry} disabled={paying}>
                    {paying
                      ? 'Processing...'
                      : `Pay Entry Fee (${ENTRY_FEE_LAMPORTS / LAMPORTS_PER_SOL} SOL)`}
                  </Button>
                  <InfoText>
                    Entry fee will be sent to the escrow wallet. Winners split the pool.
                  </InfoText>
                </>
              ) : !isReady ? (
                <Button $variant="success" onClick={handleReady}>
                  Start Game!
                </Button>
              ) : (
                <InfoText>Waiting for all players to be ready...</InfoText>
              )}
            </Section>
          </>
        )}
      </Content>
    </Container>
  );
}
