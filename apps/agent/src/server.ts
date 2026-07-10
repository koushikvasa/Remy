import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";

/**
 * Agent server — HTTP + WebSocket entrypoint (REMY_SPEC.md §4).
 *
 * P0 scope: /health only. The ConversationRelay WS handler (echo) lands in P1;
 * the /ws route is registered here as a placeholder so the socket path exists.
 */

const server = Fastify({ logger: true });

await server.register(websocket);

server.get("/health", async () => ({ ok: true }));

// Placeholder ConversationRelay socket. P1 implements the echo call path here.
server.get("/ws", { websocket: true }, (socket) => {
  socket.on("message", () => {
    // ConversationRelay message handling arrives in P1.
  });
});

const port = Number(process.env.PORT ?? 8080);

try {
  await server.listen({ port, host: "0.0.0.0" });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
