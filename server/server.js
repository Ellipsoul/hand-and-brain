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
const nodeCrypto = require("node:crypto");

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
        // For now, we don't persist the game; we just broadcast start with a gameId
        broadcastStart(sess.lobbyId, gameId);
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
