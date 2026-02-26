import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bomb, Flag, RefreshCw, Trophy, AlertCircle, Timer, Settings2, Crosshair, Zap, ShieldAlert, Users, Link as LinkIcon, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { io, Socket } from 'socket.io-client';

type Difficulty = 'beginner' | 'intermediate' | 'expert';

interface GameConfig {
  rows: number;
  cols: number;
  mines: number;
}

const CONFIGS: Record<Difficulty, GameConfig> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};

interface Cell {
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  neighborMines: number;
}

type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

export default function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [board, setBoard] = useState<Cell[][]>([]);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [minesLeft, setMinesLeft] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [roomId, setRoomId] = useState<string>('');
  const [copied, setCopied] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const isRemoteUpdate = useRef(false);

  // Initialize Room from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room') || Math.random().toString(36).substring(7);
    setRoomId(room);
    if (!params.get('room')) {
      window.history.replaceState({}, '', `?room=${room}`);
    }
  }, []);

  // Socket Connection
  useEffect(() => {
    if (!roomId) return;

    const socket = io();
    socketRef.current = socket;

    socket.emit('join-room', roomId);

    socket.on('sync-state', (state: any) => {
      isRemoteUpdate.current = true;
      setBoard(state.board);
      setStatus(state.status);
      setMinesLeft(state.minesLeft);
      setSeconds(state.seconds);
      setDifficulty(state.difficulty);
      setTimeout(() => { isRemoteUpdate.current = false; }, 50);
    });

    socket.on('remote-click', ({ r, c }: { r: number, c: number }) => {
      handleCellClick(r, c, true);
    });

    socket.on('remote-flag', ({ r, c }: { r: number, c: number }) => {
      handleRightClick(null, r, c, true);
    });

    socket.on('remote-reset', () => {
      initBoard(CONFIGS[difficulty], true);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  const emitState = useCallback((newBoard: Cell[][], newStatus: GameStatus, newMinesLeft: number, newSeconds: number, newDifficulty: Difficulty) => {
    if (isRemoteUpdate.current) return;
    socketRef.current?.emit('update-state', {
      roomId,
      state: { board: newBoard, status: newStatus, minesLeft: newMinesLeft, seconds: newSeconds, difficulty: newDifficulty }
    });
  }, [roomId]);

  const initBoard = useCallback((config: GameConfig, remote = false) => {
    const newBoard: Cell[][] = Array(config.rows).fill(null).map(() =>
      Array(config.cols).fill(null).map(() => ({
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0,
      }))
    );
    setBoard(newBoard);
    setStatus('idle');
    setMinesLeft(config.mines);
    setSeconds(0);
    
    if (!remote) {
      socketRef.current?.emit('reset-game', roomId);
      emitState(newBoard, 'idle', config.mines, 0, difficulty);
    }
  }, [roomId, difficulty, emitState]);

  useEffect(() => {
    if (board.length === 0) {
      initBoard(CONFIGS[difficulty]);
    }
  }, [difficulty, initBoard, board.length]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'playing') {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  const startGame = (firstRow: number, firstCol: number) => {
    const config = CONFIGS[difficulty];
    const newBoard = JSON.parse(JSON.stringify(board));
    
    let minesPlaced = 0;
    while (minesPlaced < config.mines) {
      const r = Math.floor(Math.random() * config.rows);
      const c = Math.floor(Math.random() * config.cols);
      
      if (!newBoard[r][c].isMine && (r !== firstRow || c !== firstCol)) {
        newBoard[r][c].isMine = true;
        minesPlaced++;
      }
    }

    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        if (!newBoard[r][c].isMine) {
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols && newBoard[nr][nc].isMine) {
                count++;
              }
            }
          }
          newBoard[r][c].neighborMines = count;
        }
      }
    }

    setStatus('playing');
    revealCell(firstRow, firstCol, newBoard, 'playing');
  };

  const revealCell = (r: number, c: number, currentBoard: Cell[][], currentStatus: GameStatus) => {
    if (r < 0 || r >= currentBoard.length || c < 0 || c >= currentBoard[0].length || 
        currentBoard[r][c].isRevealed || currentBoard[r][c].isFlagged) {
      return;
    }

    currentBoard[r][c].isRevealed = true;

    if (currentBoard[r][c].isMine) {
      setStatus('lost');
      currentBoard.forEach(row => row.forEach(cell => {
        if (cell.isMine) cell.isRevealed = true;
      }));
      emitState(currentBoard, 'lost', minesLeft, seconds, difficulty);
      return;
    }

    if (currentBoard[r][c].neighborMines === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          revealCell(r + dr, c + dc, currentBoard, currentStatus);
        }
      }
    }

    setBoard([...currentBoard]);
    checkWin(currentBoard);
  };

  const checkWin = (currentBoard: Cell[][]) => {
    const config = CONFIGS[difficulty];
    let revealedCount = 0;
    currentBoard.forEach(row => row.forEach(cell => {
      if (cell.isRevealed) revealedCount++;
    }));

    if (revealedCount === config.rows * config.cols - config.mines) {
      setStatus('won');
      confetti({
        particleCount: 200,
        spread: 90,
        colors: ['#ff0032', '#ffffff', '#1a1a1a'],
        origin: { y: 0.6 }
      });
      emitState(currentBoard, 'won', minesLeft, seconds, difficulty);
    } else {
      emitState(currentBoard, status === 'idle' ? 'playing' : status, minesLeft, seconds, difficulty);
    }
  };

  const handleCellClick = (r: number, c: number, remote = false) => {
    if (status === 'won' || status === 'lost') return;
    
    if (!remote) {
      socketRef.current?.emit('cell-click', { roomId, r, c });
    }

    if (status === 'idle') {
      startGame(r, c);
    } else {
      const newBoard = [...board];
      revealCell(r, c, newBoard, status);
    }
  };

  const handleRightClick = (e: React.MouseEvent | null, r: number, c: number, remote = false) => {
    if (e) e.preventDefault();
    if (status === 'idle' || status === 'won' || status === 'lost' || board[r][c].isRevealed) return;

    if (!remote) {
      socketRef.current?.emit('cell-flag', { roomId, r, c });
    }

    const newBoard = [...board];
    const cell = newBoard[r][c];
    cell.isFlagged = !cell.isFlagged;
    const newMinesLeft = cell.isFlagged ? minesLeft - 1 : minesLeft + 1;
    setMinesLeft(newMinesLeft);
    setBoard(newBoard);
    emitState(newBoard, status, newMinesLeft, seconds, difficulty);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCellContent = (cell: Cell) => {
    if (cell.isFlagged) return <Flag className="w-4 h-4 text-[#ff0032] drop-shadow-[0_0_5px_#ff0032]" />;
    if (!cell.isRevealed) return null;
    if (cell.isMine) return <Bomb className="w-4 h-4 text-[#ff0032] animate-pulse" />;
    if (cell.neighborMines > 0) return cell.neighborMines;
    return null;
  };

  const getNumberColor = (num: number) => {
    const colors = [
      '', 'text-blue-400', 'text-emerald-400', 'text-rose-500', 
      'text-violet-400', 'text-amber-400', 'text-cyan-400', 
      'text-white', 'text-zinc-500'
    ];
    return colors[num] || 'text-white';
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white font-sans rog-grid relative overflow-hidden">
      <div className="rog-scanline" />
      
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[60%] bg-[#ff0032]/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[40%] h-[60%] bg-[#ff0032]/5 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 p-4 md:p-8 flex flex-col items-center">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-end mb-8 gap-6 border-b border-zinc-800 pb-6"
        >
          <div className="relative">
            <div className="flex items-center gap-3 mb-1">
              <Zap className="w-6 h-6 text-[#ff0032] fill-[#ff0032]" />
              <h1 className="text-5xl font-black tracking-tighter italic">
                ROG <span className="text-[#ff0032]">CO-OP</span>
              </h1>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono tracking-[0.3em] text-zinc-500 uppercase">
              <span>System.Status: {status.toUpperCase()}</span>
              <span className="w-1 h-1 bg-zinc-700 rounded-full" />
              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Multiplayer.Active</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={copyLink}
              className="flex items-center gap-2 px-4 py-3 bg-zinc-900/50 border border-zinc-800 hover:border-[#ff0032] transition-all text-xs font-bold uppercase tracking-widest"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <LinkIcon className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Invite Friend'}</span>
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-3 bg-zinc-900/50 border border-zinc-800 hover:border-[#ff0032] transition-colors group"
            >
              <Settings2 className="w-5 h-5 text-zinc-400 group-hover:text-[#ff0032]" />
            </button>
            <button 
              onClick={() => initBoard(CONFIGS[difficulty])}
              className="flex items-center gap-2 px-6 py-3 bg-[#ff0032] text-white font-bold italic skew-x-[-12deg] hover:bg-[#cc0028] transition-all active:scale-95 rog-glow"
            >
              <div className="skew-x-[12deg] flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>REBOOT</span>
              </div>
            </button>
          </div>
        </motion.div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-8 w-full max-w-xl"
            >
              <div className="bg-zinc-900/80 backdrop-blur-md p-8 rog-border shadow-2xl">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff0032] mb-6 flex items-center gap-2">
                  <Crosshair className="w-4 h-4" /> Select Difficulty
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  {(['beginner', 'intermediate', 'expert'] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setDifficulty(d);
                        setShowSettings(false);
                        initBoard(CONFIGS[d]);
                      }}
                      className={`px-4 py-4 font-bold italic skew-x-[-12deg] transition-all border ${
                        difficulty === d 
                          ? 'bg-[#ff0032] border-[#ff0032] text-white' 
                          : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      <div className="skew-x-[12deg] capitalize">{d}</div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Bar */}
        <div className="w-full max-w-fit flex gap-12 mb-10 bg-zinc-900/50 backdrop-blur-sm px-12 py-6 border-x border-zinc-800 relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#ff0032]/50 to-transparent" />
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#ff0032]/50 to-transparent" />
          
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-[0.3em] font-bold text-zinc-500 mb-2">Threats Detected</span>
            <div className="flex items-center gap-3 font-mono text-4xl font-black text-[#ff0032] drop-shadow-[0_0_8px_rgba(255,0,50,0.5)]">
              <ShieldAlert className="w-6 h-6" />
              {String(minesLeft).padStart(3, '0')}
            </div>
          </div>
          
          <div className="w-px bg-zinc-800" />
          
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-[0.3em] font-bold text-zinc-500 mb-2">Mission Time</span>
            <div className="flex items-center gap-3 font-mono text-4xl font-black text-white">
              <Timer className="w-6 h-6 text-zinc-500" />
              {String(seconds).padStart(3, '0')}
            </div>
          </div>
        </div>

        {/* Game Board */}
        <div className="relative group p-4 bg-zinc-900/30 rog-border">
          <div 
            className="bg-black/50 p-2 overflow-auto max-w-full"
            style={{ 
              display: 'grid', 
              gridTemplateColumns: `repeat(${CONFIGS[difficulty].cols}, minmax(36px, 1fr))`,
              gap: '2px'
            }}
          >
            {board.map((row, r) => 
              row.map((cell, c) => (
                <motion.div
                  key={`${r}-${c}`}
                  whileHover={!cell.isRevealed ? { backgroundColor: 'rgba(255, 0, 50, 0.15)', scale: 1.05, zIndex: 10 } : {}}
                  whileTap={!cell.isRevealed ? { scale: 0.9 } : {}}
                  onClick={() => handleCellClick(r, c)}
                  onContextMenu={(e) => handleRightClick(e, r, c)}
                  className={`
                    w-9 h-9 md:w-10 md:h-10 flex items-center justify-center text-base font-black cursor-pointer select-none transition-all duration-200
                    ${cell.isRevealed 
                      ? 'bg-zinc-800/50 text-white border border-zinc-700/30' 
                      : 'bg-zinc-900 border border-zinc-800 hover:border-[#ff0032]/50 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]'
                    }
                    ${cell.isRevealed && cell.isMine ? 'bg-[#ff0032]/20 border-[#ff0032]' : ''}
                  `}
                >
                  <span className={getNumberColor(cell.neighborMines)}>
                    {getCellContent(cell)}
                  </span>
                </motion.div>
              ))
            )}
          </div>

          {/* Status Overlay */}
          <AnimatePresence>
            {(status === 'won' || status === 'lost') && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              >
                <motion.div 
                  initial={{ scale: 0.8, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="bg-zinc-900 p-10 rog-border shadow-[0_0_50px_rgba(255,0,50,0.2)] flex flex-col items-center text-center max-w-sm"
                >
                  {status === 'won' ? (
                    <>
                      <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500 rounded-full flex items-center justify-center mb-6 rog-glow">
                        <Trophy className="w-10 h-10 text-emerald-500" />
                      </div>
                      <h2 className="text-3xl font-black italic mb-2 tracking-tighter">MISSION COMPLETE</h2>
                      <p className="text-zinc-500 font-mono text-xs mb-8 uppercase tracking-widest">Grid secured in {seconds}s. Elite performance.</p>
                    </>
                  ) : (
                    <>
                      <div className="w-20 h-20 bg-[#ff0032]/10 border border-[#ff0032] rounded-full flex items-center justify-center mb-6 rog-glow">
                        <AlertCircle className="w-10 h-10 text-[#ff0032]" />
                      </div>
                      <h2 className="text-3xl font-black italic mb-2 tracking-tighter">SYSTEM FAILURE</h2>
                      <p className="text-zinc-500 font-mono text-xs mb-8 uppercase tracking-widest">Critical explosion detected. Grid compromised.</p>
                    </>
                  )}
                  <button 
                    onClick={() => initBoard(CONFIGS[difficulty])}
                    className="w-full py-4 bg-[#ff0032] text-white font-black italic skew-x-[-12deg] hover:bg-[#cc0028] transition-all active:scale-95 rog-glow"
                  >
                    <div className="skew-x-[12deg]">REDEPLOY</div>
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer / Instructions */}
        <div className="mt-16 w-full max-w-2xl">
          <div className="flex justify-between items-center text-[9px] font-mono uppercase tracking-[0.4em] text-zinc-600 mb-4">
            <span>Tactical Interface v2.0.ROG</span>
            <span>Republic of Gamers</span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-zinc-800 border border-zinc-800">
            <div className="bg-[#0b0b0b] p-4 flex flex-col items-center">
              <span className="text-[#ff0032] font-black italic mb-1 text-xs">PRIMARY ACTION</span>
              <span className="text-zinc-500 text-[10px]">Left Click to Neutralize</span>
            </div>
            <div className="bg-[#0b0b0b] p-4 flex flex-col items-center">
              <span className="text-[#ff0032] font-black italic mb-1 text-xs">TACTICAL MARK</span>
              <span className="text-zinc-500 text-[10px]">Right Click to Flag Threat</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
