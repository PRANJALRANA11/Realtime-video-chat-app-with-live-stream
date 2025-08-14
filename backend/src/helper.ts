import mediasoup from "mediasoup";
import { ConsumerPortMapping } from "./types.js";
import fs, { readdir, rm, stat } from "fs";
import path from "path";
import { rooms, producers, addConsumer, addTransport } from "./socket.js";
import getPort, { portNumbers } from "get-port";
import { spawn, ChildProcess } from "child_process";

const __dirname = path.resolve();

const processedProducers = new Set<string>();
const consumerPortMap: ConsumerPortMapping[] = [];
let activeStreams: string[] = [];
const userSet = new Set<string>();
let ffmpegProcess: ChildProcess | null = null;
let currentSegmentIndex = 0;
let outputFile: string;
const HLS_DIR_1 = path.join(__dirname, "/public/hls/merged");
const HLS_DIR_2 = path.join(__dirname, "/public/sdp");
let globalRoomName: string;

export const createWebRtcTransport = async (
  router: mediasoup.types.Router
): Promise<mediasoup.types.WebRtcTransport> => {
  return new Promise(async (resolve, reject) => {
    try {
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "127.0.0.1",
            announcedIp: undefined,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      const transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};

function generateSDP(
  consumerPortMap: ConsumerPortMapping[],
  id: string
): string {
  let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Combined RTP Stream
c=IN IP4 127.0.0.1
t=0 0
`;

  consumerPortMap.forEach((item) => {
    const ssrc =
      item.consumer.rtpParameters.encodings &&
      item.consumer.rtpParameters.encodings.length > 0
        ? item.consumer.rtpParameters.encodings[0].ssrc
        : "";
    const codec = item.consumer.rtpParameters.codecs[0];
    const payloadType = codec.payloadType;
    const mimeType = codec.mimeType;
    const kind = mimeType.split("/")[0];
    const codecName = mimeType.split("/")[1];
    const clockRate = codec.clockRate;
    const channels = codec.channels || 1;

    sdp += `m=${kind} ${item.port} RTP/AVP ${payloadType}
c=IN IP4 127.0.0.1
a=rtpmap:${payloadType} ${codecName}/${clockRate}${
      kind === "audio" ? `/${channels}` : ""
    }
a=ssrc:${ssrc} cname:${kind}-${item.consumer.id}
a=rtcp:${item.rtcpPort}
`;
  });

  const sdpPath = path.join(__dirname, `public/sdp/stream-${id}.sdp`);
  fs.writeFileSync(sdpPath, sdp);

  return sdpPath;
}

export const sendPlainRTPStreams = async (
  roomName: string,
  id: string
): Promise<void> => {
  globalRoomName = roomName;
  const router = rooms[roomName].router;
  console.log("pro", producers);

  for (const item of producers) {
    const producerId = item.producer.id;
    console.log("process", processedProducers);
    if (processedProducers.has(producerId)) {
      continue;
    }

    processedProducers.add(producerId);

    console.log("loop running");
    if (!item || !item.producer) continue;
    console.log(
      `Producer kind: ${item.producer.kind}, id: ${item.producer.id}`
    );

    const kind = item.producer.kind;

    // Dynamically get available ports for RTP and RTCP
    const port = await getPort({ port: portNumbers(30000, 40000) });
    const rtcpPort = await getPort({ port: portNumbers(30000, 40000) });

    const rtpTransport = await router.createPlainTransport({
      comedia: false,
      rtcpMux: false,
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
    });

    if (item.producer.kind === "audio") {
      await rtpTransport.connect({
        ip: "127.0.0.1",
        port: port,
        rtcpPort: rtcpPort,
      });
    }
    if (item.producer.kind === "video") {
      await rtpTransport.connect({
        ip: "127.0.0.1",
        port: port,
        rtcpPort: rtcpPort,
      });
    }

    console.log(
      `[${kind}] RTP transport connected: ${port}, RTCP: ${rtcpPort}`
    );

    const rtpConsumer = await rtpTransport.consume({
      producerId: item.producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: true,
    });

    addTransport(rtpTransport, roomName, true);
    addConsumer(rtpConsumer, roomName);

    const encodings = rtpConsumer.rtpParameters.encodings;
    const ssrc =
      encodings && encodings.length > 0 ? encodings[0].ssrc : "undefined";
    console.log(
      `RTP consumer created for ${kind}: ID ${rtpConsumer.id}, SSRC ${ssrc}`
    );

    consumerPortMap.push({ id, consumer: rtpConsumer, port, rtcpPort });
    await rtpConsumer.resume();
    console.log(rtpConsumer.paused);
    console.log("consumers", consumerPortMap);
  }

  console.log("prod len", producers.length);
  console.log("user", userSet);

  if (userSet.has(id)) {
    console.log("it is running");
    const sdpPath = generateSDP(consumerPortMap, id);
    startFFmpeg(sdpPath, id);

    for (let i = consumerPortMap.length - 1; i >= 0; i--) {
      if (consumerPortMap[i].id === id) {
        consumerPortMap.splice(i, 1);
      }
    }
  }
  userSet.add(id);
};

const startFFmpeg = async (sdpPath: string, id: string): Promise<void> => {
  const outputDir = path.join(__dirname, `public/hls/${id}`);
  outputFile = path.join(outputDir, "stream.m3u8");

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ffmpegArgs = [
    "-protocol_whitelist",
    "file,udp,rtp",
    "-analyzeduration",
    "5000000",
    "-probesize",
    "5000000",
    "-f",
    "sdp",
    "-i",
    sdpPath,
    "-vsync",
    "2",

    // Set video codec
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",

    // Set profile and level to avoid MB rate error
    "-profile:v",
    "baseline",
    "-level",
    "4.0",

    // Resize video to 1280x720 (optional if source is too high)
    "-vf",
    "scale=1280:720",

    // Keyframe interval
    "-g",
    "25",
    "-sc_threshold",
    "0",

    // Audio handling (optional)
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",

    // Output HLS
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "3",
    "-hls_flags",
    "delete_segments",
    outputFile,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  ffmpeg.stderr.on("data", (data) => {
    console.error(`[ffmpeg] ${data}`);
  });

  ffmpeg.on("close", (code) => {
    console.log(`[ffmpeg] exited with code ${code}`);
  });

  console.log(`Started FFmpeg with PID: ${ffmpeg.pid}`);
};

function startFFmpegMerging(streams: string[], roomName: string): void {
  if (ffmpegProcess) {
    ffmpegProcess.kill("SIGINT");
    console.log("---------------KILLING FFMPEG PROCESS----------------------");
  }

  console.log("LATEST", currentSegmentIndex);

  const outputDir = path.join(__dirname, `public/hls/merged/${roomName}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, "stream.m3u8");

  const inputs = streams.flatMap((url) => ["-i", url]);
  const indexes = streams.map((_, i) => `[${i}:v]`).join("");
  const audioIndexes = streams.map((_, i) => `[${i}:a]`).join("");
  const layout = generateLayout(streams.length);

  const ffmpegArgs = [
    ...inputs,
    "-filter_complex",
    `
      ${indexes} 
      xstack=inputs=${streams.length}:layout=${layout}[v];
      ${audioIndexes}
      amix=inputs=${streams.length}:duration=shortest[a]
    `
      .replace(/\s+/g, " ")
      .trim(),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-g",
    "25",
    "-sc_threshold",
    "0",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "30",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist",

    outputFile,
  ];

  ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

  ffmpegProcess.stderr?.on("data", (data) => {
    console.log(`FFmpeg: ${data.toString()}`);
  });

  ffmpegProcess.on("exit", (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    ffmpegProcess = null;
  });
}

function generateLayout(n: number): string {
  // Layout for xstack (2x2 for 4, etc.)
  const positions: string[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    positions.push(`${x === 0 ? 0 : `w${x - 1}`}_${y === 0 ? 0 : `h${y - 1}`}`);
  }
  return positions.join("|");
}

export function updateStreams(
  newStreamList: string[],
  doRemove: boolean = false,
  deleteDirPath: string = ""
): void {
  if (doRemove) {
    const index = activeStreams.indexOf(deleteDirPath);
    if (index !== -1) {
      activeStreams.splice(index, 1);
    }

    startFFmpegMerging(activeStreams, globalRoomName);
  } else {
    activeStreams = newStreamList;
    startFFmpegMerging(activeStreams, globalRoomName);
  }
}

setInterval(() => {
  if (activeStreams.length >= 1 && fs.existsSync(outputFile)) {
    if (!activeStreams.includes(outputFile)) {
      updateStreams([...activeStreams, outputFile]);
    }
  } else {
    if (activeStreams.length < 1 && outputFile) {
      activeStreams.push(outputFile);
    }
  }
}, 1000);

export const deleteFile = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
    console.log(`Deleted file: ${filePath}`);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.warn(`File not found: ${filePath}`);
    } else {
      console.error(`Failed to delete file: ${filePath}`, error);
      throw error;
    }
  }
};

export const deleteDirectory = async (dirPath: string): Promise<void> => {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    console.log(`Deleted directory: ${dirPath}`);
  } catch (error) {
    console.error(`Failed to delete directory: ${dirPath}`, error);
    throw error;
  }
};

const deleteAllFilesInDirectories = async (dirs: string[]): Promise<void> => {
  for (const dirPath of dirs) {
    try {
      const files = await fs.promises.readdir(dirPath);
      const deletePromises = files.map((file) =>
        fs.promises.unlink(path.join(dirPath, file))
      );
      await Promise.all(deletePromises);
      console.log(`✅ All files deleted in: ${dirPath}`);
    } catch (error) {
      console.error(`❌ Error deleting files in: ${dirPath}`, error);
    }
  }
};

export const handleShutdown = async () => {
  console.log("\n🚦 Server shutting down...");
  try {
    await deleteAllFilesInDirectories([HLS_DIR_1, HLS_DIR_2]);
    await deleteAllSubdirsExcept(
      "/Users/pranjalrana/Documents/video-call-live-hls-transcoding-app/backend/public/hls",
      "merged"
    );
  } catch (err) {
    console.error("🔥 Cleanup error:", err);
  } finally {
    process.exit(0);
  }
};

async function deleteAllSubdirsExcept(
  parentDir: string,
  ignoreDir: string
): Promise<void> {
  try {
    const items = await fs.promises.readdir(parentDir);

    for (const item of items) {
      const fullPath = path.join(parentDir, item);
      const itemStat = await fs.promises.stat(fullPath);

      if (itemStat.isDirectory() && item !== ignoreDir) {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        console.log(`🗑️ Deleted: ${fullPath}`);
      }
    }

    console.log(
      `✅ Finished deleting subdirectories in: ${parentDir} (except "${ignoreDir}")`
    );
  } catch (err) {
    console.error(`❌ Failed to delete subdirectories in: ${parentDir}`, err);
  }
}
