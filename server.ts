import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Game state storage (simplified)
  const rooms = new Map<string, any>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      
      if (rooms.has(roomId)) {
        socket.emit("sync-state", rooms.get(roomId));
      }
    });

    socket.on("update-state", ({ roomId, state }) => {
      rooms.set(roomId, state);
      socket.to(roomId).emit("sync-state", state);
    });

    socket.on("cell-click", ({ roomId, r, c, userId }) => {
      socket.to(roomId).emit("remote-click", { r, c, userId });
    });

    socket.on("cell-flag", ({ roomId, r, c, userId }) => {
      socket.to(roomId).emit("remote-flag", { r, c, userId });
    });

    socket.on("reset-game", (roomId) => {
      rooms.delete(roomId);
      socket.to(roomId).emit("remote-reset");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
