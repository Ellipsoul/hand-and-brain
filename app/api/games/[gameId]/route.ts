import { kv } from "@/lib/kv";
import type { GameState } from "@/lib/types";

export const runtime = "edge";

export async function GET(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { gameId: string } };
  const game = await kv.get<GameState>(`game:${params.gameId}`);
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
