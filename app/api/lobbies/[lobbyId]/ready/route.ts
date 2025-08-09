import { kv } from "@/lib/kv";
import { z } from "zod";
import type { Lobby } from "@/lib/types";

export const runtime = "edge";

const ReadySchema = z.object({ playerId: z.string(), ready: z.boolean() });

export async function POST(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { lobbyId: string } };
  try {
    const json = await req.json();
    const parsed = ReadySchema.parse(json);

    const key = `lobby:${params.lobbyId}`;
    const lobby = await kv.get<Lobby>(key);
    if (!lobby) {
      return new Response(JSON.stringify({ error: "Lobby not found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }

    const set = new Set(lobby.readyPlayerIds);
    if (parsed.ready) set.add(parsed.playerId);
    else set.delete(parsed.playerId);
    lobby.readyPlayerIds = Array.from(set);

    await kv.set(key, lobby);

    // Game creation and socket signal will be added later when socket is wired.

    return new Response(JSON.stringify({ lobby }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: String(err) }),
      { headers: { "content-type": "application/json" }, status: 400 }
    );
  }
}
