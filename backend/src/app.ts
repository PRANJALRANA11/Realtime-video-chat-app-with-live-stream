import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { setupMediasoupNamespace } from "./socket.js";
import { handleShutdown } from "./helper.js";

const app = express();
const __dirname = path.resolve();

app.use("/hls", express.static(path.join(__dirname, "public/hls")));

const httpsServer = http.createServer(app);
httpsServer.listen(3000, () => {
  console.log("listening on port: " + 3000);
});

const io = new Server(httpsServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setupMediasoupNamespace(io);

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
