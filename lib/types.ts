/**
 * Shared types for Hand & Brain chess application.
 * All interfaces are explicitly typed and documented per project rules.
 */

export type Team = "WHITE" | "BLACK";
export type Role = "HAND" | "BRAIN";

/**
 * Player identity tracked in KV and sockets.
 */
export interface Player {
  /** Unique player identifier (session/user or generated UUID). */
  id: string;
  /** Display name for UI. */
  name: string;
  /** Team assignment within a game, if any. */
  team?: Team;
  /** Role assignment within a game, if any. */
  role?: Role;
  /** Whether the player is observing (not currently assigned as hand/brain). */
  isObserver?: boolean;
}

/**
 * Lobby holds waiting players and desired game settings.
 */
export interface LobbyRoles {
  /** Player occupying White Hand role (player id), if any. */
  whiteHand?: Player["id"];
  /** Player occupying White Brain role (player id), if any. */
  whiteBrain?: Player["id"];
  /** Player occupying Black Hand role (player id), if any. */
  blackHand?: Player["id"];
  /** Player occupying Black Brain role (player id), if any. */
  blackBrain?: Player["id"];
}

export interface Lobby {
  /** Lobby unique id. */
  id: string;
  /** Creation time in milliseconds since epoch. */
  createdAt: number;
  /** Players currently in lobby. */
  players: Player[];
  /** Player ids who toggled ready. When 4 are ready -> create a game. */
  readyPlayerIds: string[];
  /** Role assignments within the lobby. */
  roles: LobbyRoles;
  /** Last role change timestamp per player (ms since epoch) for debounce. */
  lastRoleChangeAt: Record<string, number>;
  /** Base time (per side) in seconds. */
  baseTimeSeconds: number;
  /** Increment added after a move (per side) in seconds. */
  incrementSeconds: number;
}

/**
 * Server-authoritative clock state (milliseconds).
 */
export interface ClockState {
  /** Remaining time for White in ms. */
  whiteMs: number;
  /** Remaining time for Black in ms. */
  blackMs: number;
  /** Timestamp when server last applied a tick (ms since epoch). */
  lastTickAt: number;
  /** Which side's clock is currently running. */
  runningFor: Team | null;
}

/**
 * Game state persisted in KV.
 */
export interface GameState {
  /** Game unique id. */
  id: string;
  /** Origin lobby id. */
  lobbyId: string;
  /** Position in FEN notation. */
  fen: string;
  /** Move counter. */
  moveNumber: number;
  /** Which side to move. */
  turn: Team;
  /** Selected piece type by the brain (uppercase). */
  selectedPiece: "K" | "Q" | "R" | "B" | "N" | "P" | null;
  /** Player role assignments and observers. */
  players: {
    whiteHand?: Player["id"];
    whiteBrain?: Player["id"];
    blackHand?: Player["id"];
    blackBrain?: Player["id"];
    observers: Player["id"][];
  };
  /** Server clocks. */
  clocks: ClockState;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Current game status. */
  status: "ACTIVE" | "PAUSED" | "WHITE_WON" | "BLACK_WON" | "DRAW";
}

/**
 * Socket session context for server-side bookkeeping (non-persisted).
 */
export interface SessionContext {
  /** Socket id from the realtime layer. */
  socketId: string;
  /** Application-level player id. */
  playerId: string;
  /** Currently joined lobby id, if any. */
  lobbyId?: string;
  /** Currently joined game id, if any. */
  gameId?: string;
  /** Player team for current game, if known. */
  team?: Team;
  /** Player role for current game, if known. */
  role?: Role;
}

/** Client -> Server: join a lobby */
export interface JoinLobbyPayload {
  lobbyId: string;
  player: { id: string; name: string };
}

/** Server -> Client: lobby updated */
export interface LobbyUpdatedPayload {
  lobby: Lobby;
}

/** Client -> Server: ready toggle in lobby */
export interface ReadyUpPayload {
  lobbyId: string;
  playerId: string;
  ready: boolean;
}

/** Server -> Client: start game notification */
export interface StartGamePayload {
  gameId: string;
  roles: GameState["players"];
  initialFen: string;
  clocks: ClockState;
}

/** Client -> Server: brain selects a piece type */
export interface SelectPiecePayload {
  gameId: string;
  playerId: string;
  piece: "K" | "Q" | "R" | "B" | "N" | "P";
}

/** Server -> Client: piece selected with allowed targets */
export interface PieceSelectedPayload {
  gameId: string;
  piece: SelectPiecePayload["piece"];
  allowedTargets: string[];
}

/** Client -> Server: hand attempts a move */
export interface MakeMovePayload {
  gameId: string;
  playerId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

/** Server -> Client: move result */
export interface MoveValidatedPayload {
  gameId: string;
  fen: string;
  moveSAN: string;
  turn: Team;
  clocks: ClockState;
  status: GameState["status"];
}

/** Server -> Client: periodic clock updates */
export interface ClockUpdatePayload {
  gameId: string;
  clocks: ClockState;
}

/** Server -> Client: presence updates */
export interface PlayerPresencePayload {
  gameId: string;
  playerId: string;
  state: "DISCONNECTED" | "RECONNECTED";
}
