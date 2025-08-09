import { getRedis } from "@/lib/redis";
import type { GameState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { gameId: string } };
  const redis = await getRedis();
  const str = await redis.get(`game:${params.gameId}`);
  const game = str ? (JSON.parse(str) as GameState) : null;
  if (!game) {
    return new Response(JSON.stringify({ error: "Game not found" }), {
      headers: { "content-type": "application/json" },
      status: 404,
    });
  }
  return new Response(JSON.stringify({ game }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
