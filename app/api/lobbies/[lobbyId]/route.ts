import { kv } from "@/lib/kv";
import type { Lobby } from "@/lib/types";

export const runtime = "edge";

export async function GET(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { lobbyId: string } };
  const lobby = await kv.get<Lobby>(`lobby:${params.lobbyId}`);
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
