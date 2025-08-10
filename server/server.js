/* eslint-disable @typescript-eslint/no-require-imports */
/*
 * Custom Next.js + WebSocket server (development)
 * Starts Next.js HTTP server and upgrades /api/ws to a WS server.
 */
const { parse } = require("node:url");
const { createServer } = require("node:http");
const next = require("next");
const { WebSocket, WebSocketServer } = require("ws");
const { createClient } = require("redis");
const path = require("path");
const { Chess } = require("chess.js");

// Load env (.env.local then .env)
try {
  const dotenv = require("dotenv");
  const root = process.cwd();
  dotenv.config({ path: path.join(root, ".env.local") });
  dotenv.config({ path: path.join(root, ".env") });
} catch {}

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("Redis error", err));

function now() {
  return Date.now();
}
async function getLobby(lobbyId) {
  const key = `lobby:${lobbyId}`;
  const str = await redis.get(key);
  return str ? JSON.parse(str) : null;
}
async function setLobby(lobby) {
  const key = `lobby:${lobby.id}`;
  await redis.set(key, JSON.stringify(lobby));
}
function roleKeyFromSelection(sel) {
  const { team, role } = sel;
  if (team === "WHITE" && role === "HAND") return "whiteHand";
  if (team === "WHITE" && role === "BRAIN") return "whiteBrain";
  if (team === "BLACK" && role === "HAND") return "blackHand";
  return "blackBrain";
}

nextApp.prepare().then(async () => {
  await redis.connect();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || "", true));
  });

  // ws server with noServer mode
  const wss = new WebSocketServer({ noServer: true });

  // Session and rooms
  const sessions = new Map(); // ws -> { lobbyId, playerId }
  const rooms = new Map(); // lobbyId -> Set<ws>

  function joinRoom(lobbyId, ws) {
    if (!rooms.has(lobbyId)) rooms.set(lobbyId, new Set());
    rooms.get(lobbyId).add(ws);
  }
  function leaveRoom(lobbyId, ws) {
    const set = rooms.get(lobbyId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(lobbyId);
    }
  }
  function broadcastLobby(lobbyId, lobby) {
    const set = rooms.get(lobbyId);
    if (!set) return;
    const msg = JSON.stringify({ type: "lobby", lobby });
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
  function broadcastStart(lobbyId, gameId) {
    const set = rooms.get(lobbyId);
    if (!set) return;
    const msg = JSON.stringify({ type: "start", gameId });
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
  function broadcastGame(lobbyId, game) {
    const set = rooms.get(lobbyId);
    if (!set) return;
    const msg = JSON.stringify({ type: "game", game });
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
  function getNextActor(game) {
    // If no selectedPiece -> expecting HAND of game.turn,
    // else expecting BRAIN of game.turn
    const phase = game.selectedPiece ? "BRAIN" : "HAND";
    return `${game.turn}_${phase}`; // e.g., WHITE_HAND
  }

  wss.on("connection", (ws) => {
    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      if (msg.event === "ping") return; // ignore sample pings

      if (msg.type === "join") {
        const { lobbyId, player } = msg;
        const lob = await getLobby(lobbyId);
        if (!lob) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Lobby not found or expired",
            }),
          );
          return;
        }
        if (now() > lob.expiresAt) {
          ws.send(JSON.stringify({ type: "error", error: "Lobby expired" }));
          return;
        }
        const exists = lob.players.some((p) => p.id === player.id);
        if (!exists) {
          lob.players.push({
            id: player.id,
            name: player.name,
            isObserver: true,
          });
        }
        lob.lastSeen = lob.lastSeen || {};
        lob.lastSeen[player.id] = now();
        await setLobby(lob);

        sessions.set(ws, { lobbyId, playerId: player.id });
        joinRoom(lobbyId, ws);
        ws.send(JSON.stringify({ type: "joined", lobby: lob }));
        broadcastLobby(lobbyId, lob);
        return;
      }

      if (msg.type === "role") {
        const { selection } = msg; // {team, role} | null
        const sess = sessions.get(ws);
        if (!sess) return;
        const lob = await getLobby(sess.lobbyId);
        if (!lob) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Lobby not found or expired",
            }),
          );
          return;
        }
        if (now() > lob.expiresAt) {
          ws.send(JSON.stringify({ type: "error", error: "Lobby expired" }));
          return;
        }
        lob.roles = lob.roles || {};
        lob.lastRoleChangeAt = lob.lastRoleChangeAt || {};
        const last = lob.lastRoleChangeAt[sess.playerId] ?? 0;
        if (now() - last < 3000) {
          ws.send(JSON.stringify({ type: "error", error: "Cooldown" }));
          return;
        }
        // remove previous role
        for (const k of Object.keys(lob.roles)) {
          if (lob.roles[k] === sess.playerId) lob.roles[k] = undefined;
        }
        if (selection) {
          const rk = roleKeyFromSelection(selection);
          const occ = lob.roles[rk];
          if (occ && occ !== sess.playerId) {
            ws.send(
              JSON.stringify({ type: "error", error: "Role already occupied" }),
            );
            return;
          }
          lob.roles[rk] = sess.playerId;
        }
        lob.lastRoleChangeAt[sess.playerId] = now();
        lob.lastSeen = lob.lastSeen || {};
        lob.lastSeen[sess.playerId] = now();
        await setLobby(lob);
        broadcastLobby(sess.lobbyId, lob);
        return;
      }

      if (msg.type === "start") {
        const sess = sessions.get(ws);
        if (!sess) return;
        const lob = await getLobby(sess.lobbyId);
        if (!lob) return;
        const hostId = lob.hostId || (lob.players[0] && lob.players[0].id);
        if (!hostId || hostId !== sess.playerId) {
          ws.send(
            JSON.stringify({ type: "error", error: "Only host can start" }),
          );
          return;
        }
        const roles = lob.roles || {};
        const filled = roles.whiteHand && roles.whiteBrain && roles.blackHand &&
          roles.blackBrain;
        if (!filled) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "All roles must be filled",
            }),
          );
          return;
        }
        // Persist game using lobbyId as gameId
        const gameId = sess.lobbyId;
        const chess = new Chess();
        const game = {
          id: gameId,
          lobbyId: sess.lobbyId,
          fen: chess.fen(),
          moveNumber: 0,
          turn: "WHITE",
          selectedPiece: null,
          players: {
            whiteHand: roles.whiteHand,
            whiteBrain: roles.whiteBrain,
            blackHand: roles.blackHand,
            blackBrain: roles.blackBrain,
            observers: lob.players
              .map((p) => p.id)
              .filter((pid) =>
                ![
                  roles.whiteHand,
                  roles.whiteBrain,
                  roles.blackHand,
                  roles.blackBrain,
                ].includes(pid)
              ),
          },
          playerNames: Object.fromEntries(
            lob.players.map((p) => [p.id, p.name]),
          ),
          clocks: {
            whiteMs: 0,
            blackMs: 0,
            lastTickAt: Date.now(),
            runningFor: null,
          },
          createdAt: Date.now(),
          status: "ACTIVE",
          moves: [],
        };
        await redis.set(`game:${gameId}`, JSON.stringify(game));
        broadcastStart(sess.lobbyId, gameId);
        broadcastGame(sess.lobbyId, game);
        return;
      }

      if (msg.type === "joinGame") {
        const { gameId, player } = msg;
        const gameStr = await redis.get(`game:${gameId}`);
        if (!gameStr) {
          ws.send(JSON.stringify({ type: "error", error: "Game not found" }));
          return;
        }
        const game = JSON.parse(gameStr);
        // Associate this socket with the lobby room for realtime broadcasts
        joinRoom(game.lobbyId, ws);
        // Update session with lobby and player for permissions/orientation
        const prev = sessions.get(ws) || {};
        const playerId = player?.id || prev.playerId || "";
        sessions.set(ws, { ...prev, lobbyId: game.lobbyId, playerId, gameId });
        ws.send(JSON.stringify({ type: "game", game }));
        return;
      }

      if (msg.type === "selectPiece") {
        const { gameId, playerId, piece } = msg;
        const gameStr = await redis.get(`game:${gameId}`);
        if (!gameStr) return;
        const game = JSON.parse(gameStr);
        if (game.status && game.status !== "ACTIVE") {
          ws.send(JSON.stringify({ type: "error", error: "Game is over" }));
          return;
        }
        // Validate actor: must be HAND of current turn
        const expectedId = game.turn === "WHITE"
          ? game.players.whiteHand
          : game.players.blackHand;
        if (playerId !== expectedId) {
          ws.send(
            JSON.stringify({ type: "error", error: "Not your turn (hand)" }),
          );
          return;
        }
        if (game.selectedPiece) {
          ws.send(
            JSON.stringify({ type: "error", error: "Piece already selected" }),
          );
          return;
        }
        // piece must be one of KQRBNP
        const validPieces = ["K", "Q", "R", "B", "N", "P"];
        if (!validPieces.includes(piece)) {
          ws.send(JSON.stringify({ type: "error", error: "Invalid piece" }));
          return;
        }
        // Ensure there is at least one legal move for this piece type
        try {
          const chess = new Chess(game.fen);
          const legal = chess.moves({
            piece: piece.toLowerCase(),
            verbose: true,
          });
          if (!Array.isArray(legal) || legal.length === 0) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "No legal moves for selected piece",
              }),
            );
            return;
          }
        } catch {}
        game.selectedPiece = piece;
        await redis.set(`game:${gameId}`, JSON.stringify(game));
        // broadcast selection
        const lobId = game.lobbyId;
        const payload = {
          type: "pieceSelected",
          gameId,
          piece,
          nextActor: getNextActor(game),
        };
        const set = rooms.get(lobId);
        if (set) {
          for (const client of set) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(payload));
            }
          }
        }
        return;
      }

      if (msg.type === "makeMove") {
        const { gameId, playerId, from, to, promotion } = msg;
        const gameStr = await redis.get(`game:${gameId}`);
        if (!gameStr) return;
        const game = JSON.parse(gameStr);
        const brainId = game.turn === "WHITE"
          ? game.players.whiteBrain
          : game.players.blackBrain;
        if (playerId !== brainId) {
          ws.send(
            JSON.stringify({ type: "error", error: "Not your turn (brain)" }),
          );
          return;
        }
        if (!game.selectedPiece) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Hand must select a piece first",
            }),
          );
          return;
        }
        // Validate move with chess.js and ensure moving piece matches selected type
        const chess = new Chess(game.fen);
        const pieceAtFrom = chess.get(from);
        if (!pieceAtFrom) {
          ws.send(
            JSON.stringify({ type: "error", error: "No piece at source" }),
          );
          return;
        }
        const expectedColor = game.turn === "WHITE" ? "w" : "b";
        if (pieceAtFrom.color !== expectedColor) {
          ws.send(JSON.stringify({ type: "error", error: "Wrong side piece" }));
          return;
        }
        // pieceAtFrom.type is lowercase; map to uppercase
        const typeUpper = pieceAtFrom.type.toUpperCase();
        if (typeUpper !== game.selectedPiece) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Must move selected piece type",
            }),
          );
          return;
        }
        const move = chess.move({ from, to, promotion });
        if (!move) {
          ws.send(JSON.stringify({ type: "error", error: "Illegal move" }));
          return;
        }
        // Update game
        game.fen = chess.fen();
        game.moveNumber = game.moveNumber + 1;
        game.selectedPiece = null;
        // Determine game end status and result
        let status = "ACTIVE";
        let result = undefined;
        let resultReason = undefined;
        if (chess.isCheckmate()) {
          const sideToMove = chess.turn() === "w" ? "WHITE" : "BLACK"; // checkmated side
          const winner = sideToMove === "WHITE" ? "BLACK" : "WHITE";
          status = winner === "WHITE" ? "WHITE_WON" : "BLACK_WON";
          result = winner === "WHITE" ? "1-0" : "0-1";
          resultReason = "Checkmate";
        } else if (chess.isStalemate()) {
          status = "DRAW";
          result = "1/2-1/2";
          resultReason = "Stalemate";
        } else if (chess.isDraw()) {
          status = "DRAW";
          result = "1/2-1/2";
          if (chess.isThreefoldRepetition()) resultReason = "Threefold repetition";
          else if (chess.isInsufficientMaterial()) resultReason = "Insufficient material";
          else if (chess.isDrawByFiftyMoves()) resultReason = "Fifty-move rule";
          else resultReason = "Draw";
        } else {
          // game continues: toggle turn
          game.turn = game.turn === "WHITE" ? "BLACK" : "WHITE";
        }
        game.status = status;
        game.result = result;
        game.resultReason = resultReason;
        game.moves = Array.isArray(game.moves) ? game.moves : [];
        game.moves.push(move.san);
        await redis.set(`game:${gameId}`, JSON.stringify(game));
        broadcastGame(game.lobbyId, game);
        return;
      }

      if (msg.type === "heartbeat") {
        const sess = sessions.get(ws);
        if (!sess) return;
        const lob = await getLobby(sess.lobbyId);
        if (!lob) return;
        lob.lastSeen = lob.lastSeen || {};
        lob.lastSeen[sess.playerId] = now();
        await setLobby(lob);
        return;
      }
    });

    ws.on("close", async () => {
      const sess = sessions.get(ws);
      if (!sess) return;
      sessions.delete(ws);
      leaveRoom(sess.lobbyId, ws);
      const lob = await getLobby(sess.lobbyId);
      if (!lob) return;
      // remove player entirely and vacate roles
      lob.players = lob.players.filter((p) => p.id !== sess.playerId);
      if (lob.roles) {
        for (const k of Object.keys(lob.roles)) {
          if (lob.roles[k] === sess.playerId) lob.roles[k] = undefined;
        }
      }
      if (lob.lastSeen) delete lob.lastSeen[sess.playerId];
      await setLobby(lob);
      broadcastLobby(sess.lobbyId, lob);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/", true);

    if (pathname === "/_next/webpack-hmr") {
      nextApp.getUpgradeHandler()(req, socket, head);
      return;
    }

    if (pathname === "/api/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }

    socket.destroy();
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
});
