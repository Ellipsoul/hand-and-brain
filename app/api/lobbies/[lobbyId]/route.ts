import { getRedis } from "@/lib/redis";
import type { Lobby } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ lobbyId: string }> } | unknown,
) {
  const { lobbyId } = await (context as { params: Promise<{ lobbyId: string }> })
    .params;
  const redis = await getRedis();
  const str = await redis.get(`lobby:${lobbyId}`);
  const lobby = str ? (JSON.parse(str) as Lobby) : null;
  if (!lobby) {
    return new Response(JSON.stringify({ error: "Lobby expired or not found" }), {
      headers: { "content-type": "application/json" },
      status: 404,
    });
  }
  // Expiry check
  if (Date.now() > lobby.expiresAt) {
    return new Response(JSON.stringify({ error: "Lobby expired" }), {
      headers: { "content-type": "application/json" },
      status: 410,
    });
  }
  // Cleanup stale role occupants based on lastSeen
  const lastSeen = lobby.lastSeen || {};
  const STALE_MS = 15_000; // 15 seconds without heartbeat -> vacate role
  const roles = lobby.roles || {};
  let changed = false;
  (Object.keys(roles) as (keyof typeof roles)[]).forEach((k) => {
    const pid = roles[k];
    if (!pid) return;
    const seen = lastSeen[pid] || 0;
    if (Date.now() - seen > STALE_MS) {
      roles[k] = undefined;
      changed = true;
    }
  });
  if (changed) {
    lobby.roles = roles;
    await redis.set(`lobby:${lobbyId}`, JSON.stringify(lobby));
  }
  return new Response(JSON.stringify({ lobby }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
