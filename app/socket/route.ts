export const runtime = "edge";

// Minimal ambient typing for Edge WebSocketPair so we avoid `any`.
interface EdgeWebSocket extends WebSocket {
  accept(): void;
}

declare const WebSocketPair: {
  new (): { 0: EdgeWebSocket; 1: EdgeWebSocket };
};

// Minimal Edge WebSocket echo endpoint.
export function GET(req: Request) {
  const upgradeHeader = req.headers.get("upgrade") || "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.accept();

  server.addEventListener("message", (event: MessageEvent) => {
    server.send(String(event.data));
  });

  server.addEventListener("close", () => {
    // No-op for now
  });

  // Cast ResponseInit to any to allow Edge-specific `webSocket` field
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Response(null, { status: 101, webSocket: client } as any);
}
