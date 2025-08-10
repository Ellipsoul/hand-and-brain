"use client";

import { useParams } from "next/navigation";
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Team } from "@/lib/types";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

type GamePlayers = {
  whiteHand?: string;
  whiteBrain?: string;
  blackHand?: string;
  blackBrain?: string;
  observers: string[];
};

interface GameViewState {
  id: string;
  lobbyId: string;
  fen: string;
  moveNumber: number;
  turn: Team;
  selectedPiece: "K" | "Q" | "R" | "B" | "N" | "P" | null;
  players: GamePlayers;
  playerNames?: Record<string, string>;
  status: "ACTIVE" | "PAUSED" | "WHITE_WON" | "BLACK_WON" | "DRAW";
  moves: string[]; // SAN list
}

function usePlayerIdentity(): { playerId: string; name: string } {
  const playerId = useMemo(() => {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem("hab:playerId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("hab:playerId", id);
    }
    return id;
  }, []);
  const name = useMemo(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("hab:name") || "";
  }, []);
  return { playerId, name };
}

function roleForPlayer(
  players: GamePlayers,
  pid: string,
): { team?: Team; role?: "HAND" | "BRAIN" } {
  if (players.whiteHand === pid) return { team: "WHITE", role: "HAND" };
  if (players.whiteBrain === pid) return { team: "WHITE", role: "BRAIN" };
  if (players.blackHand === pid) return { team: "BLACK", role: "HAND" };
  if (players.blackBrain === pid) return { team: "BLACK", role: "BRAIN" };
  return {};
}

function nextActor(game: GameViewState): string {
  const phase = game.selectedPiece ? "BRAIN" : "HAND";
  return `${game.turn} ${phase}`;
}

export default function GamePage(): ReactElement {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;
  const { playerId, name } = usePlayerIdentity();

  const wsRef = useRef<WebSocket | null>(null);
  const [game, setGame] = useState<GameViewState | null>(null);
  const [error, setError] = useState<string>("");
  const [fromSquare, setFromSquare] = useState<string | null>(null);

  const isMyTurn = useMemo(() => {
    if (!game) return false;
    const phase = game.selectedPiece ? "BRAIN" : "HAND";
    if (phase === "HAND") {
      return (
        (game.turn === "WHITE" && game.players.whiteHand === playerId) ||
        (game.turn === "BLACK" && game.players.blackHand === playerId)
      );
    }
    return (
      (game.turn === "WHITE" && game.players.whiteBrain === playerId) ||
      (game.turn === "BLACK" && game.players.blackBrain === playerId)
    );
  }, [game, playerId]);

  const orientation: "white" | "black" = useMemo(() => {
    if (!game) return "white";
    if (
      game.players.whiteHand === playerId ||
      game.players.whiteBrain === playerId
    ) return "white";
    if (
      game.players.blackHand === playerId ||
      game.players.blackBrain === playerId
    ) return "black";
    return "white"; // spectators default
  }, [game, playerId]);

  useEffect(() => {
    const protocol =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "wss:"
        : "ws:";
    const url = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "joinGame",
          gameId,
          player: { id: playerId, name },
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "game") {
          setGame(msg.game as GameViewState);
          setError("");
        } else if (msg.type === "pieceSelected") {
          setGame((g) => (g ? { ...g, selectedPiece: msg.piece } : g));
        } else if (msg.type === "error") {
          setError(String(msg.error));
        }
      } catch {}
    });
    return () => {
      try {
        ws.close();
      } catch {}
      wsRef.current = null;
    };
  }, [gameId, playerId, name]);

  const chess = useMemo(() => new Chess(game?.fen), [game?.fen]);

  function clickSquare(square: string): void {
    if (
      !game || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN
    ) return;
    // Determine phase
    const phase = game.selectedPiece ? "BRAIN" : "HAND";
    if (!isMyTurn) return;

    if (phase === "HAND") {
      // Clicking one of own pieces selects its type
      const p = chess.get(square as Square);
      if (!p) return;
      const expectedColor = game.turn === "WHITE" ? "w" : "b";
      if (p.color !== expectedColor) return;
      const pieceType = p.type.toUpperCase() as GameViewState["selectedPiece"];
      wsRef.current.send(
        JSON.stringify({
          type: "selectPiece",
          gameId,
          playerId,
          piece: pieceType,
        }),
      );
    } else {
      // Brain: select from and to squares (two-click)
      if (!fromSquare) {
        const p = chess.get(square as Square);
        if (!p) return;
        const expectedColor = game.turn === "WHITE" ? "w" : "b";
        if (p.color !== expectedColor) return;
        if (p.type.toUpperCase() !== game.selectedPiece) return;
        setFromSquare(square);
      } else {
        const payload: {
          type: string;
          gameId: string;
          playerId: string;
          from: string;
          to: string;
          promotion?: string;
        } = {
          type: "makeMove",
          gameId,
          playerId,
          from: fromSquare,
          to: square,
        };
        wsRef.current.send(JSON.stringify(payload));
        setFromSquare(null);
      }
    }
  }
  function onSquareClick(square: string): void {
    clickSquare(square);
  }

  function onPieceDrop(sourceSquare: string, targetSquare: string): boolean {
    // Allow drag-drop only for brain phase; enforce selected piece type via server
    if (!game) return false;
    const phase = game.selectedPiece ? "BRAIN" : "HAND";
    if (phase !== "BRAIN") return false;
    if (!isMyTurn) return false;
    // Optimistic deny; server validates and broadcasts
    wsRef.current?.send(
      JSON.stringify({
        type: "makeMove",
        gameId,
        playerId,
        from: sourceSquare,
        to: targetSquare,
      }),
    );
    return false; // don't update locally; wait for server snapshot
  }

  function customSquareStyles(): Record<string, CSSProperties> {
    const styles: Record<string, CSSProperties> = {};
    if (!game) return styles;
    if (game.selectedPiece) {
      const expectedColor = game.turn === "WHITE" ? "w" : "b";
      const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
      for (const r of ranks) {
        for (const f of files) {
          const sq = `${f}${r}`;
          const p = chess.get(sq as Square);
          if (
            p && p.color === expectedColor &&
            p.type.toUpperCase() === game.selectedPiece
          ) {
            styles[sq] = { boxShadow: "inset 0 0 0 3px rgba(234,179,8,0.8)" };
          }
        }
      }
    }
    if (fromSquare) {
      styles[fromSquare] = {
        ...(styles[fromSquare] || {}),
        backgroundColor: "rgba(250,204,21,0.3)",
      };
    }
    return styles;
  }

  function renderBoard(): ReactElement {
    return (
      <div className="w-full max-w-[560px]">
        <Chessboard
          id="hab-board"
          position={game?.fen || "start"}
          boardOrientation={orientation}
          arePiecesDraggable={Boolean(game && game.selectedPiece && isMyTurn)}
          onSquareClick={onSquareClick}
          onPieceDrop={onPieceDrop}
          customSquareStyles={customSquareStyles()}
        />
      </div>
    ) as unknown as ReactElement;
  }

  function nameFor(id?: string): string {
    if (!id) return "-";
    return (game?.playerNames && game.playerNames[id]) || id;
  }

  function nextActorKey(): string {
    const phase = game?.selectedPiece ? "BRAIN" : "HAND";
    return `${game?.turn}_${phase}`;
  }

  function renderMoves(): ReactElement {
    const rows: ReactElement[] = [];
    const moves = game?.moves || [];
    for (let i = 0; i < moves.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const whiteSan = moves[i] || "";
      const blackSan = moves[i + 1] || "";
      rows.push(
        <tr key={`mv-${num}`} className="border-b border-neutral-800">
          <td className="px-2 py-1 text-neutral-400 w-8">{num}.</td>
          <td className="px-2 py-1">{whiteSan}</td>
          <td className="px-2 py-1">{blackSan}</td>
        </tr>,
      );
    }
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-neutral-400">
            <th className="px-2 py-1 text-left font-normal">#</th>
            <th className="px-2 py-1 text-left font-normal">White</th>
            <th className="px-2 py-1 text-left font-normal">Black</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    ) as unknown as ReactElement;
  }

  function roleTooltip(): string {
    if (!game) return "";
    const r = roleForPlayer(game.players, playerId);
    if (!r.team || !r.role) return "You are a spectator";
    return `You are the ${r.role.toLowerCase()} for the ${r.team.toLowerCase()} pieces`;
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Game</h1>
            <p className="text-sm text-neutral-400">Game ID: {gameId}</p>
          </div>
          <div className="text-sm text-neutral-300" title={roleTooltip()}>
            {game ? `Next: ${nextActor(game)}` : "Connecting..."}
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-2 flex justify-center">
            {renderBoard()}
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h2 className="text-sm font-medium text-neutral-300">Roles</h2>
              <div className="mt-2 text-sm">
                <div className="mb-1 text-neutral-400">White</div>
                <ul className="mb-3 space-y-1">
                  <li className="flex items-center justify-between">
                    <span>Hand</span>
                    <span
                      className={`flex items-center gap-2 font-medium ${
                        nextActorKey() === "WHITE_HAND"
                          ? "text-green-300"
                          : "text-neutral-200"
                      }`}
                    >
                      {nameFor(game?.players.whiteHand)}
                      {game?.players.whiteHand === playerId && (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-xs text-blue-300">
                          You
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span>Brain</span>
                    <span
                      className={`flex items-center gap-2 font-medium ${
                        nextActorKey() === "WHITE_BRAIN"
                          ? "text-green-300"
                          : "text-neutral-200"
                      }`}
                    >
                      {nameFor(game?.players.whiteBrain)}
                      {game?.players.whiteBrain === playerId && (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-xs text-blue-300">
                          You
                        </span>
                      )}
                    </span>
                  </li>
                </ul>
                <div className="mb-1 text-neutral-400">Black</div>
                <ul className="space-y-1">
                  <li className="flex items-center justify-between">
                    <span>Hand</span>
                    <span
                      className={`flex items-center gap-2 font-medium ${
                        nextActorKey() === "BLACK_HAND"
                          ? "text-green-300"
                          : "text-neutral-200"
                      }`}
                    >
                      {nameFor(game?.players.blackHand)}
                      {game?.players.blackHand === playerId && (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-xs text-blue-300">
                          You
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span>Brain</span>
                    <span
                      className={`flex items-center gap-2 font-medium ${
                        nextActorKey() === "BLACK_BRAIN"
                          ? "text-green-300"
                          : "text-neutral-200"
                      }`}
                    >
                      {nameFor(game?.players.blackBrain)}
                      {game?.players.blackBrain === playerId && (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-xs text-blue-300">
                          You
                        </span>
                      )}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h2 className="text-sm font-medium text-neutral-300">Moves</h2>
              <div className="mt-2 max-h-[60vh] overflow-auto">
                {renderMoves()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
