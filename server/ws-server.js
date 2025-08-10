/*
 * Simple development WebSocket server for lobby presence and role changes.
 * Run with: npm run ws
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebSocketServer } = require("ws");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("redis");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
const nodeCrypto = require("node:crypto");

// Load env for this standalone server: prefer .env.local, then .env
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require("dotenv");
  const root = process.cwd();
  dotenv.config({ path: path.join(root, ".env.local") });
  dotenv.config({ path: path.join(root, ".env") });
} catch {}

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

const PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 4001;

const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("Redis error", err));

function now() {
  return Date.now();
}

async function getLobby(redisClient, lobbyId) {
  const key = `lobby:${lobbyId}`;
  const str = await redisClient.get(key);
  return str ? JSON.parse(str) : null;
}

async function setLobby(redisClient, lobby) {
  const key = `lobby:${lobby.id}`;
  // Keep same TTL logic by calculating remaining ttl if needed (best-effort)
  // For dev simplicity, we just overwrite without TTL change.
  await redisClient.set(key, JSON.stringify(lobby));
}

function roleKeyFromSelection(sel) {
  const { team, role } = sel;
  if (team === "WHITE" && role === "HAND") return "whiteHand";
  if (team === "WHITE" && role === "BRAIN") return "whiteBrain";
  if (team === "BLACK" && role === "HAND") return "blackHand";
  return "blackBrain";
}

(async () => {
  await redis.connect();

  const wss = new WebSocketServer({ port: PORT });
  console.log(`[ws] Listening on ws://localhost:${PORT}`);

  // Map socket -> session { lobbyId, playerId }
  const sessions = new Map();
  // Room map lobbyId -> Set of sockets
  const rooms = new Map();

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
    for (const sock of set) {
      if (sock.readyState === 1) sock.send(msg);
    }
  }
  function broadcastStart(lobbyId, gameId) {
    const set = rooms.get(lobbyId);
    if (!set) return;
    const msg = JSON.stringify({ type: "start", gameId });
    for (const sock of set) {
      if (sock.readyState === 1) sock.send(msg);
    }
  }

  wss.on("connection", (ws) => {
    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      if (msg.type === "join") {
        const { lobbyId, player } = msg;
        const lob = await getLobby(redis, lobbyId);
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
        // add/update player presence in lobby
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
        await setLobby(redis, lob);

        // track session and join room
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
        const lobbyId = sess.lobbyId;
        const playerId = sess.playerId;
        const lob = await getLobby(redis, lobbyId);
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
        const last = lob.lastRoleChangeAt[playerId] ?? 0;
        if (now() - last < 3000) {
          ws.send(JSON.stringify({ type: "error", error: "Cooldown" }));
          return;
        }
        // remove from existing role
        for (const k of Object.keys(lob.roles)) {
          if (lob.roles[k] === playerId) lob.roles[k] = undefined;
        }
        if (selection) {
          const rk = roleKeyFromSelection(selection);
          const occ = lob.roles[rk];
          if (occ && occ !== playerId) {
            ws.send(
              JSON.stringify({ type: "error", error: "Role already occupied" }),
            );
            return;
          }
          lob.roles[rk] = playerId;
        }
        lob.lastRoleChangeAt[playerId] = now();
        lob.lastSeen = lob.lastSeen || {};
        lob.lastSeen[playerId] = now();
        await setLobby(redis, lob);
        broadcastLobby(lobbyId, lob);
        return;
      }

      if (msg.type === "start") {
        const sess = sessions.get(ws);
        if (!sess) return;
        const lob = await getLobby(redis, sess.lobbyId);
        if (!lob) return;
        const hostId = lob.hostId || (lob.players[0] && lob.players[0].id);
        if (!hostId || hostId !== sess.playerId) {
          ws.send(JSON.stringify({ type: "error", error: "Only host can start" }));
          return;
        }
        const roles = lob.roles || {};
        const filled = roles.whiteHand && roles.whiteBrain && roles.blackHand && roles.blackBrain;
        if (!filled) {
          ws.send(JSON.stringify({ type: "error", error: "All roles must be filled" }));
          return;
        }
        const gameId = nodeCrypto.randomUUID ? nodeCrypto.randomUUID() : String(Date.now());
        broadcastStart(sess.lobbyId, gameId);
        return;
      }

      if (msg.type === "heartbeat") {
        const sess = sessions.get(ws);
        if (!sess) return;
        const lob = await getLobby(redis, sess.lobbyId);
        if (!lob) return;
        lob.lastSeen = lob.lastSeen || {};
        lob.lastSeen[sess.playerId] = now();
        await setLobby(redis, lob);
        return;
      }
    });

    ws.on("close", async () => {
      const sess = sessions.get(ws);
      if (!sess) return;
      sessions.delete(ws);
      leaveRoom(sess.lobbyId, ws);
      // remove player from lobby entirely and vacate roles
      const lob = await getLobby(redis, sess.lobbyId);
      if (!lob) return;
      lob.players = lob.players.filter((p) => p.id !== sess.playerId);
      if (lob.roles) {
        for (const k of Object.keys(lob.roles)) {
          if (lob.roles[k] === sess.playerId) lob.roles[k] = undefined;
        }
      }
      if (lob.lastSeen) delete lob.lastSeen[sess.playerId];
      await setLobby(redis, lob);
      broadcastLobby(sess.lobbyId, lob);
    });
  });
})();
