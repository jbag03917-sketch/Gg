import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { LobbyView } from './components/LobbyView';
import { GameView } from './components/GameView';
import { DictionaryView } from './components/DictionaryView';
import { RankingView } from './components/RankingView';
import { MyRecordsView } from './components/MyRecordsView';
import { RulesModal } from './components/RulesModal';
import { NoticeModal } from './components/NoticeModal';
import { PublicRoomsModal } from './components/PublicRoomsModal';
import { ShareModal } from './components/ShareModal';
import { ResultModal } from './components/ResultModal';
import { UserStats, GameRoom, Player, ChatMessage, WordChainItem } from './types';
import { supabase } from './lib/supabaseClient';
import { sounds } from './lib/soundEffects';

// Initial default user state
const INITIAL_STATS: UserStats = {
  nickname: `손님${Math.floor(1000 + Math.random() * 9000)}`,
  level: 1,
  exp: 0,
  avatarColor: 'white',
  totalGames: 0,
  wins: 0,
  winRate: 0,
  highestRank: '-',
  currentStreak: 0,
  maxStreak: 0,
  wordsHistory: [],
};

export function App() {
  // Local persistent user state
  const [userStats, setUserStats] = useState<UserStats>(() => {
    const saved = localStorage.getItem('kkeutitgi_user_stats');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return INITIAL_STATS;
  });

  // Current client player ID
  const [myPlayerId] = useState<string>(() => {
    let id = sessionStorage.getItem('kkeutitgi_player_id');
    if (!id) {
      id = 'usr_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('kkeutitgi_player_id', id);
    }
    return id;
  });

  // Navigation & View state
  const [currentTab, setCurrentTab] = useState<string>('HOME');
  const [activeRoom, setActiveRoom] = useState<GameRoom | null>(null);
  const [publicRooms, setPublicRooms] = useState<GameRoom[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [dictSearchWord, setDictSearchWord] = useState<string>('');

  // Modals state
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [isNoticeOpen, setIsNoticeOpen] = useState(false);
  const [isPublicRoomsOpen, setIsPublicRoomsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isGameOverOpen, setIsGameOverOpen] = useState(false);

  // Supabase Realtime channel ref
  const channelRef = useRef<any>(null);

  // Fetch real public rooms from server API
  const refreshPublicRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.rooms)) {
          setPublicRooms((prev) => {
            // Keep local rooms if active, merge with server active rooms
            const serverRooms: GameRoom[] = data.rooms.map((r: any) => ({
              id: r.id,
              title: r.title,
              hostId: r.id,
              hostName: r.hostName,
              status: r.status || 'WAITING',
              currentPlayers: [{
                id: r.id,
                nickname: r.hostName,
                avatarColor: 'white',
                isHost: true,
                isReady: true,
                isAlive: true,
                score: 0,
                wordsUsed: [],
                level: 1,
              }],
              maxPlayers: r.maxPlayers || 8,
              isPublic: true,
              turnDuration: 5,
              round: 1,
              currentTurnIndex: 0,
              usedWords: [],
              wordChain: [],
              createdAt: r.lastUpdated || Date.now(),
            }));

            // Avoid duplicating active room if already in server list
            const merged = [...prev];
            for (const sr of serverRooms) {
              if (!merged.some((m) => m.id === sr.id)) {
                merged.push(sr);
              }
            }
            return merged;
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch public rooms:', e);
    }
  };

  useEffect(() => {
    refreshPublicRooms();
    const interval = setInterval(refreshPublicRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  // Save user stats on change
  useEffect(() => {
    localStorage.setItem('kkeutitgi_user_stats', JSON.stringify(userStats));
  }, [userStats]);

  // Check URL params for ?room=XXXXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && !activeRoom) {
      handleJoinRoom(roomParam);
    }
  }, []);

  // Supabase Realtime Synchronization
  useEffect(() => {
    if (!activeRoom) {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      return;
    }

    const channelName = `room_${activeRoom.id}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'game_event' }, ({ payload }) => {
        if (!payload) return;
        const { type, data } = payload;

        if (type === 'SYNC_ROOM') {
          setActiveRoom(data.room);
          if (data.room.status === 'FINISHED') {
            setIsGameOverOpen(true);
          }
        } else if (type === 'CHAT_MESSAGE') {
          setChatMessages((prev) => [...prev, data.message]);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Connected to room channel: ${channelName}`);
        }
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [activeRoom?.id]);

  // Broadcast helper
  const broadcastRoomEvent = (type: string, data: any) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'game_event',
        payload: { type, data, senderId: myPlayerId, timestamp: Date.now() },
      });
    }
  };

  // Create Room
  const handleCreateRoom = (title?: string, maxPlayers: number = 8, isPublic: boolean = true) => {
    const newRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    const hostPlayer: Player = {
      id: myPlayerId,
      nickname: userStats.nickname,
      avatarColor: userStats.avatarColor,
      isHost: true,
      isReady: true,
      isAlive: true,
      score: 0,
      wordsUsed: [],
      level: userStats.level,
    };

    const newRoom: GameRoom = {
      id: newRoomId,
      title: title || `${userStats.nickname} 님의 방`,
      hostId: myPlayerId,
      hostName: userStats.nickname,
      status: 'WAITING',
      currentPlayers: [hostPlayer],
      maxPlayers,
      isPublic,
      turnDuration: 5,
      round: 1,
      currentTurnIndex: 0,
      usedWords: [],
      wordChain: [],
      createdAt: Date.now(),
    };

    setActiveRoom(newRoom);
    setCurrentTab('GAME');
    setChatMessages([
      {
        id: 'sys_create',
        senderId: 'SYSTEM',
        senderName: '시스템',
        text: `방이 개설되었습니다. (방 코드: ${newRoomId})`,
        timestamp: Date.now(),
        isSystem: true,
      },
    ]);

    setPublicRooms((prev) => [newRoom, ...prev.filter(r => r.id !== newRoomId)]);
    broadcastRoomEvent('SYNC_ROOM', { room: newRoom });

    if (isPublic) {
      fetch('/api/rooms/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newRoomId,
          title: newRoom.title,
          hostName: newRoom.hostName,
          playerCount: 1,
          maxPlayers,
          status: 'WAITING',
          isPublic: true,
        }),
      }).catch(() => {});
    }
  };

  // Join Room
  const handleJoinRoom = (roomId: string) => {
    let target = publicRooms.find((r) => r.id === roomId);
    if (!target && activeRoom?.id === roomId) {
      target = activeRoom;
    }

    if (!target) {
      // Create guest join representation if target wasn't found in memory
      const newGuestPlayer: Player = {
        id: myPlayerId,
        nickname: userStats.nickname,
        avatarColor: userStats.avatarColor,
        isHost: false,
        isReady: false,
        isAlive: true,
        score: 0,
        wordsUsed: [],
        level: userStats.level,
      };

      const fallbackRoom: GameRoom = {
        id: roomId,
        title: `${roomId}번 대기실`,
        hostId: 'unknown_host',
        hostName: '방장',
        status: 'WAITING',
        currentPlayers: [newGuestPlayer],
        maxPlayers: 8,
        isPublic: true,
        turnDuration: 5,
        round: 1,
        currentTurnIndex: 0,
        usedWords: [],
        wordChain: [],
        createdAt: Date.now(),
      };
      setActiveRoom(fallbackRoom);
      setCurrentTab('GAME');
      return;
    }

    // Check if player already exists
    const exists = target.currentPlayers.some((p) => p.id === myPlayerId);
    let updatedPlayers = [...target.currentPlayers];

    if (!exists) {
      if (target.currentPlayers.length >= target.maxPlayers) {
        alert('해당 방은 이미 만원입니다.');
        return;
      }

      const me: Player = {
        id: myPlayerId,
        nickname: userStats.nickname,
        avatarColor: userStats.avatarColor,
        isHost: false,
        isReady: false,
        isAlive: true,
        score: 0,
        wordsUsed: [],
        level: userStats.level,
      };
      updatedPlayers.push(me);
    }

    const updatedRoom: GameRoom = {
      ...target,
      currentPlayers: updatedPlayers,
    };

    setActiveRoom(updatedRoom);
    setCurrentTab('GAME');
    setChatMessages((prev) => [
      ...prev,
      {
        id: 'join_' + Date.now(),
        senderId: 'SYSTEM',
        senderName: '시스템',
        text: `${userStats.nickname}님이 방에 입장하셨습니다.`,
        timestamp: Date.now(),
        isSystem: true,
      },
    ]);

    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Add Test Player / Bot (allows user to easily test & play 2~8 multiplayer even solo)
  const handleAddTestPlayer = () => {
    if (!activeRoom || activeRoom.currentPlayers.length >= activeRoom.maxPlayers) return;

    const names = ['영희', '민우', '수진', '태양', '하늘', '보라', '다은'];
    const colors = ['yellow', 'mint', 'pink', 'purple', 'blue', 'orange'];
    const existingNames = activeRoom.currentPlayers.map((p) => p.nickname);
    const availableNames = names.filter((n) => !existingNames.includes(n));
    const randomName = availableNames[0] || `참가자${activeRoom.currentPlayers.length + 1}`;
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const botPlayer: Player = {
      id: 'bot_' + Math.random().toString(36).substring(2, 7),
      nickname: randomName,
      avatarColor: randomColor,
      isHost: false,
      isReady: true,
      isAlive: true,
      score: 0,
      wordsUsed: [],
      level: Math.floor(1 + Math.random() * 8),
    };

    const updatedRoom: GameRoom = {
      ...activeRoom,
      currentPlayers: [...activeRoom.currentPlayers, botPlayer],
    };

    setActiveRoom(updatedRoom);
    sounds.playPop();
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Toggle Ready
  const handleToggleReady = () => {
    if (!activeRoom) return;

    const updatedPlayers = activeRoom.currentPlayers.map((p) => {
      if (p.id === myPlayerId) {
        return { ...p, isReady: !p.isReady };
      }
      return p;
    });

    const updatedRoom: GameRoom = {
      ...activeRoom,
      currentPlayers: updatedPlayers,
    };

    setActiveRoom(updatedRoom);
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Change Color in Room
  const handleChangeColor = (color: string) => {
    if (!activeRoom) return;

    const updatedPlayers = activeRoom.currentPlayers.map((p) => {
      if (p.id === myPlayerId) {
        return { ...p, avatarColor: color };
      }
      return p;
    });

    const updatedRoom: GameRoom = {
      ...activeRoom,
      currentPlayers: updatedPlayers,
    };

    setUserStats((prev) => ({ ...prev, avatarColor: color }));
    setActiveRoom(updatedRoom);
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Start Game (Host only) - Section 1: 2~8명이 한 방에서 랜덤 순서로 시작
  const handleStartGame = () => {
    if (!activeRoom || activeRoom.currentPlayers.length < 2) return;

    // Shuffle players randomly (공식 게임 규칙 1: 게임 시작 시 참가자 순서를 랜덤으로 결정한다)
    const shuffled = [...activeRoom.currentPlayers]
      .sort(() => Math.random() - 0.5)
      .map((p) => ({
        ...p,
        isAlive: true,
        score: 0,
        wordsUsed: [],
        eliminatedReason: undefined,
      }));

    const updatedRoom: GameRoom = {
      ...activeRoom,
      status: 'PLAYING',
      currentPlayers: shuffled,
      currentTurnIndex: 0,
      round: 1,
      lastWord: undefined,
      usedWords: [],
      wordChain: [],
      startTime: Date.now(),
    };

    setActiveRoom(updatedRoom);
    sounds.playPop();
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Advance turn to next alive player
  const getNextAliveTurnIndex = (players: Player[], currentIndex: number): number => {
    let next = (currentIndex + 1) % players.length;
    let loopCount = 0;
    while (!players[next].isAlive && loopCount < players.length) {
      next = (next + 1) % players.length;
      loopCount++;
    }
    return next;
  };

  // Submit Word
  const handleSubmitWord = (
    word: string,
    isDueum: boolean,
    matchedChar: string,
    definition?: string,
    pos?: string
  ) => {
    if (!activeRoom) return;

    const activePlayer = activeRoom.currentPlayers[activeRoom.currentTurnIndex];
    if (!activePlayer) return;

    const earnedPoints = word.length * 100 + (isDueum ? 50 : 0);

    const newChainItem: WordChainItem = {
      id: 'chain_' + Date.now(),
      word,
      playerId: activePlayer.id,
      playerName: activePlayer.nickname,
      timestamp: Date.now(),
      isDueum,
      matchedChar,
      definition,
      pos,
    };

    const updatedPlayers = activeRoom.currentPlayers.map((p, idx) => {
      if (idx === activeRoom.currentTurnIndex) {
        return {
          ...p,
          score: p.score + earnedPoints,
          wordsUsed: [...p.wordsUsed, word],
        };
      }
      return p;
    });

    const nextIndex = getNextAliveTurnIndex(updatedPlayers, activeRoom.currentTurnIndex);

    const updatedRoom: GameRoom = {
      ...activeRoom,
      currentPlayers: updatedPlayers,
      currentTurnIndex: nextIndex,
      lastWord: word,
      usedWords: [...activeRoom.usedWords, word],
      wordChain: [...activeRoom.wordChain, newChainItem],
      round: activeRoom.round + 1,
    };

    // Update user stats history if it's me
    if (activePlayer.id === myPlayerId) {
      setUserStats((prev) => {
        const existingIdx = prev.wordsHistory.findIndex((w) => w.word === word);
        let newHistory = [...prev.wordsHistory];
        if (existingIdx >= 0) {
          newHistory[existingIdx] = {
            ...newHistory[existingIdx],
            count: newHistory[existingIdx].count + 1,
            lastUsed: Date.now(),
          };
        } else {
          newHistory.push({ word, count: 1, lastUsed: Date.now() });
        }
        return {
          ...prev,
          exp: prev.exp + 10,
          wordsHistory: newHistory,
        };
      });
    }

    setActiveRoom(updatedRoom);
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Player Timeout / Elimination
  const handlePlayerTimeout = (playerId: string) => {
    if (!activeRoom) return;

    const updatedPlayers = activeRoom.currentPlayers.map((p) => {
      if (p.id === playerId) {
        return {
          ...p,
          isAlive: false,
          eliminatedReason: '5초 시간 초과',
        };
      }
      return p;
    });

    const alivePlayers = updatedPlayers.filter((p) => p.isAlive);

    // Check if only 1 player remains (Winner found!)
    if (alivePlayers.length <= 1) {
      const winner = alivePlayers[0];
      const isMeWinner = winner?.id === myPlayerId;

      const finishedRoom: GameRoom = {
        ...activeRoom,
        status: 'FINISHED',
        currentPlayers: updatedPlayers,
      };

      setActiveRoom(finishedRoom);
      setIsGameOverOpen(true);

      // Update user stats
      setUserStats((prev) => {
        const newTotal = prev.totalGames + 1;
        const newWins = isMeWinner ? prev.wins + 1 : prev.wins;
        const newRate = Math.round((newWins / newTotal) * 100);
        const newStreak = isMeWinner ? prev.currentStreak + 1 : 0;
        const newMaxStreak = Math.max(prev.maxStreak, newStreak);
        const newExp = prev.exp + (isMeWinner ? 50 : 20);

        let level = prev.level;
        let exp = newExp;
        const expTarget = level * 100;
        if (exp >= expTarget) {
          level += 1;
          exp -= expTarget;
        }

        return {
          ...prev,
          totalGames: newTotal,
          wins: newWins,
          winRate: newRate,
          currentStreak: newStreak,
          maxStreak: newMaxStreak,
          highestRank: isMeWinner ? 1 : 2,
          exp,
          level,
        };
      });

      broadcastRoomEvent('SYNC_ROOM', { room: finishedRoom });
      return;
    }

    // Advance to next alive player
    const nextIndex = getNextAliveTurnIndex(updatedPlayers, activeRoom.currentTurnIndex);

    const updatedRoom: GameRoom = {
      ...activeRoom,
      currentPlayers: updatedPlayers,
      currentTurnIndex: nextIndex,
    };

    setActiveRoom(updatedRoom);
    broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
  };

  // Leave Room
  const handleLeaveRoom = () => {
    sounds.playPop();
    if (activeRoom) {
      const remainingPlayers = activeRoom.currentPlayers.filter((p) => p.id !== myPlayerId);
      if (remainingPlayers.length > 0) {
        if (activeRoom.hostId === myPlayerId) {
          remainingPlayers[0].isHost = true;
        }
        const updatedRoom: GameRoom = {
          ...activeRoom,
          hostId: remainingPlayers[0].id,
          hostName: remainingPlayers[0].nickname,
          currentPlayers: remainingPlayers,
        };
        broadcastRoomEvent('SYNC_ROOM', { room: updatedRoom });
      } else {
        fetch('/api/rooms/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeRoom.id }),
        }).catch(() => {});
      }
    }
    setActiveRoom(null);
    setCurrentTab('HOME');
  };

  // Send Chat Message
  const handleSendMessage = (text: string) => {
    const newMessage: ChatMessage = {
      id: 'msg_' + Date.now(),
      senderId: myPlayerId,
      senderName: userStats.nickname,
      text,
      timestamp: Date.now(),
    };

    setChatMessages((prev) => [...prev, newMessage]);
    broadcastRoomEvent('CHAT_MESSAGE', { message: newMessage });
  };

  // View word detail in Dictionary
  const handleViewWordDetail = (word: string) => {
    setDictSearchWord(word);
    setCurrentTab('DICT');
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] text-[#1e2022] flex flex-col font-sans selection:bg-purple-200">
      {/* Top Navigation Header */}
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (activeRoom && tab !== 'GAME') {
            // Keep room in background or prompt
          }
          setCurrentTab(tab);
        }}
        userStats={userStats}
        onUpdateUserStats={(updated) => setUserStats((prev) => ({ ...prev, ...updated }))}
        onOpenRules={() => setIsRulesOpen(true)}
        onOpenNotices={() => setIsNoticeOpen(true)}
      />

      {/* Main Container Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row gap-6">
        {/* Left Sidebar (Only visible on Main pages, or responsive) */}
        {!activeRoom && (
          <Sidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            userStats={userStats}
          />
        )}

        {/* Center Content Router */}
        <div className="flex-1 w-full overflow-hidden">
          {activeRoom ? (
            activeRoom.status === 'WAITING' ? (
              <LobbyView
                room={activeRoom}
                currentPlayerId={myPlayerId}
                chatMessages={chatMessages}
                onSendMessage={handleSendMessage}
                onToggleReady={handleToggleReady}
                onStartGame={handleStartGame}
                onLeaveRoom={handleLeaveRoom}
                onAddTestPlayer={handleAddTestPlayer}
                onChangeColor={handleChangeColor}
                onOpenShareModal={() => setIsShareOpen(true)}
              />
            ) : (
              <GameView
                room={activeRoom}
                currentPlayerId={myPlayerId}
                chatMessages={chatMessages}
                onSendMessage={handleSendMessage}
                onSubmitWord={handleSubmitWord}
                onPlayerTimeout={handlePlayerTimeout}
                onLeaveRoom={handleLeaveRoom}
              />
            )
          ) : currentTab === 'HOME' ? (
            <HomeView
              userStats={userStats}
              onCreateRoom={() => handleCreateRoom()}
              onOpenPublicRooms={() => setIsPublicRoomsOpen(true)}
              onOpenQuickJoin={() => setIsPublicRoomsOpen(true)}
              onSelectTab={setCurrentTab}
              onViewWordDetail={handleViewWordDetail}
              onOpenNotices={() => setIsNoticeOpen(true)}
              onOpenRules={() => setIsRulesOpen(true)}
            />
          ) : currentTab === 'GAME' ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center max-w-lg mx-auto my-12 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-purple-100 text-purple-700 flex items-center justify-center mx-auto mb-4 text-2xl">
                🎮
              </div>
              <h2 className="font-extrabold text-xl text-[#1e2022] mb-2">
                게임 방에 입장해보세요!
              </h2>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                방을 직접 개설하여 친구를 초대하거나,<br />
                공개 방 목록에서 바로 다른 플레이어와 끝말잇기를 시작할 수 있습니다.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => handleCreateRoom()}
                  className="px-6 py-3 rounded-xl bg-[#1e2022] hover:bg-black text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  새 방 만들기
                </button>
                <button
                  onClick={() => setIsPublicRoomsOpen(true)}
                  className="px-6 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  공개 방 목록 보기
                </button>
              </div>
            </div>
          ) : currentTab === 'DICT' ? (
            <DictionaryView initialSearch={dictSearchWord} />
          ) : currentTab === 'RANK' ? (
            <RankingView userStats={userStats} />
          ) : (
            <MyRecordsView userStats={userStats} onSelectTab={setCurrentTab} />
          )}
        </div>
      </main>

      {/* Global Footer with National Institute of Korean Language & CCL 2.0 Attribution */}
      {!activeRoom && (
        <footer className="border-t border-slate-200/80 bg-white/70 backdrop-blur-md py-6 px-4 sm:px-8 mt-auto">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex flex-col sm:flex-row items-center gap-2 text-center sm:text-left">
              <span className="font-bold text-slate-700">끝잇기 (Kkeutitgi)</span>
              <span className="hidden sm:inline">•</span>
              <span>
                본 서비스는 <strong>국립국어원 표준국어대사전 Open API</strong>를 연동하여 표준어를 검증합니다.
              </span>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-semibold">
                CCL 2.0 KR (저작자표시-동일조건변경허락)
              </span>
              <a
                href="https://stdict.korean.go.kr"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-purple-600 transition-colors"
              >
                국립국어원 표준국어대사전
              </a>
            </div>
          </div>
        </footer>
      )}

      {/* Official Rules Modal (14대 규칙) */}
      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />

      {/* System Notice Modal */}
      <NoticeModal
        isOpen={isNoticeOpen}
        onClose={() => setIsNoticeOpen(false)}
      />

      {/* Public Rooms / Create Room Modal */}
      <PublicRoomsModal
        isOpen={isPublicRoomsOpen}
        onClose={() => setIsPublicRoomsOpen(false)}
        publicRooms={publicRooms}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        defaultHostName={userStats.nickname}
      />

      {/* QR Code & Share Modal */}
      {activeRoom && (
        <ShareModal
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          room={activeRoom}
        />
      )}

      {/* Game Over Result Modal */}
      {isGameOverOpen && activeRoom && (
        <ResultModal
          room={activeRoom}
          currentPlayerId={myPlayerId}
          onReturnToLobby={() => {
            setIsGameOverOpen(false);
            const resetRoom: GameRoom = {
              ...activeRoom,
              status: 'WAITING',
              usedWords: [],
              wordChain: [],
              round: 1,
              currentPlayers: activeRoom.currentPlayers.map((p) => ({
                ...p,
                isAlive: true,
                isReady: p.isHost,
                score: 0,
                wordsUsed: [],
              })),
            };
            setActiveRoom(resetRoom);
            broadcastRoomEvent('SYNC_ROOM', { room: resetRoom });
          }}
          onLeaveToHome={() => {
            setIsGameOverOpen(false);
            handleLeaveRoom();
          }}
        />
      )}
    </div>
  );
}
export default App;
