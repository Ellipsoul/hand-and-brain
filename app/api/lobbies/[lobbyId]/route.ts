import { getRedis } from "@/lib/redis";
import type { Lobby } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { lobbyId: string } };
  const redis = await getRedis();
  const str = await redis.get(`lobby:${params.lobbyId}`);
  const lobby = str ? (JSON.parse(str) as Lobby) : null;
  if (!lobby) {
    return new Response(JSON.stringify({ error: "Lobby not found" }), {
      headers: { "content-type": "application/json" },
      status: 404,
    });
  }
  return new Response(JSON.stringify({ lobby }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
