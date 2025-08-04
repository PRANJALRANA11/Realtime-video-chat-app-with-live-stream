import mediasoup from "mediasoup";
import {
  Peer,
  Room,
  TransportConnectData,
  TransportData,
  TransportProduceData,
  TransportRecvConnectData,
  ProducerData,
  ConsumeData,
  ConsumerResumeData,
  JoinRoomData,
  CreateWebRtcTransportData,
  ConsumerData,
  ConsumerPortMapping,
} from "./types.js";
import { Server, Socket } from "socket.io";
import {
  createWebRtcTransport,
  sendPlainRTPStreams,
  updateStreams,
  deleteDirectory,
  deleteFile,
} from "./helper.js";
import path from "path";

const __dirname = path.resolve();

let worker: mediasoup.types.Worker;
export const rooms: Record<string, Room> = {};
const peers: Record<string, Peer> = {};
let transports: TransportData[] = [];
export let producers: ProducerData[] = [];
let consumers: ConsumerData[] = [];
export let addTransport: (
  transport: mediasoup.types.Transport,
  roomName: string,
  consumer: boolean
) => void;
export let addConsumer: (
  consumer: mediasoup.types.Consumer,
  roomName: string
) => void;

export const setupMediasoupNamespace = async (io: Server) => {
  // Socket.io namespace
  const connections = io.of("/mediasoup");

  const createWorker = async (): Promise<mediasoup.types.Worker> => {
    worker = await mediasoup.createWorker({
      rtcMinPort: 2000,
      rtcMaxPort: 3000,
    });
    console.log(`worker pid ${worker.pid}`);

    worker.on("died", (error) => {
      // This implies something serious happened, so kill the application
      console.error("mediasoup worker has died");
      setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

    return worker;
  };

  // We create a Worker as soon as our application starts
  (async () => {
    worker = await createWorker();
  })();

  // This is an Array of RtpCapabilities
  const mediaCodecs = [
    {
      kind: "audio" as const,
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video" as const,
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {
        "x-google-start-bitrate": 1000,
      },
    },
  ];

  connections.on("connection", async (socket: Socket) => {
    console.log(socket.id);
    socket.emit("connection-success", {
      socketId: socket.id,
    });

    const removeItems = <T extends { socketId: string }>(
      items: T[],
      socketId: string,
      type: keyof T
    ): T[] => {
      items.forEach((item) => {
        if (item.socketId === socket.id) {
          (item[type] as any).close();
        }
      });
      return items.filter((item) => item.socketId !== socket.id);
    };

    socket.on("disconnect", async () => {
      // do some cleanup
      console.log("peer disconnected");
      consumers = removeItems(consumers, socket.id, "consumer");
      producers = removeItems(producers, socket.id, "producer");
      transports = removeItems(transports, socket.id, "transport");

      const deleteDir = path.join(__dirname, `public/hls/${socket.id}`);
      const deleteFilePath = path.join(
        __dirname,
        `public/sdp/stream-${socket.id}.sdp`
      );

      const peer = peers[socket.id];
      if (peer) {
        const { roomName } = peer;
        delete peers[socket.id];

        // remove socket from room
        if (rooms[roomName]) {
          rooms[roomName] = {
            router: rooms[roomName].router,
            peers: rooms[roomName].peers.filter(
              (socketId) => socketId !== socket.id
            ),
          };
        }
      }
      updateStreams([], true, deleteDir);
      await deleteDirectory(deleteDir);
      await deleteFile(deleteFilePath);
    });

    socket.on(
      "joinRoom",
      async (
        { roomName }: JoinRoomData,
        callback: (arg0: {
          rtpCapabilities: mediasoup.types.RtpCapabilities;
        }) => void
      ) => {
        const router1 = await createRoom(roomName, socket.id);

        peers[socket.id] = {
          socket,
          roomName,
          transports: [],
          producers: [],
          consumers: [],
          peerDetails: {
            name: "",
            isAdmin: false,
          },
        };

        // get Router RTP Capabilities
        const rtpCapabilities = router1.rtpCapabilities;

        // call callback from the client and send back the rtpCapabilities
        callback({ rtpCapabilities });
      }
    );

    const createRoom = async (
      roomName: string,
      socketId: string
    ): Promise<mediasoup.types.Router> => {
      let router1: mediasoup.types.Router;
      let roomPeers: string[] = [];

      if (rooms[roomName]) {
        router1 = rooms[roomName].router;
        roomPeers = rooms[roomName].peers || [];
      } else {
        router1 = await worker.createRouter({ mediaCodecs });
      }

      console.log(`Router ID: ${router1.id}`, roomPeers.length);

      rooms[roomName] = {
        router: router1,
        peers: [...roomPeers, socketId],
      };

      return router1;
    };

    // Client emits a request to create server side Transport
    socket.on(
      "createWebRtcTransport",
      async (
        { consumer }: CreateWebRtcTransportData,
        callback: (arg0: {
          params: {
            id: string;
            iceParameters: mediasoup.types.IceParameters;
            iceCandidates: mediasoup.types.IceCandidate[];
            dtlsParameters: mediasoup.types.DtlsParameters;
          };
        }) => void
      ) => {
        // get Room Name from Peer's properties
        const roomName = peers[socket.id].roomName;

        // get Router (Room) object this peer is in based on RoomName
        const router = rooms[roomName].router;

        try {
          const transport = await createWebRtcTransport(router);
          callback({
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          });

          // add transport to Peer's properties
          addTransport(transport, roomName, consumer);
        } catch (error) {
          console.log(error);
        }
      }
    );

    addTransport = (
      transport: mediasoup.types.Transport,
      roomName: string,
      consumer: boolean
    ) => {
      transports = [
        ...transports,
        { socketId: socket.id, transport, roomName, consumer },
      ];

      peers[socket.id] = {
        ...peers[socket.id],
        transports: [...peers[socket.id].transports, transport.id],
      };
    };

    const addProducer = async (
      producer: mediasoup.types.Producer,
      roomName: string
    ) => {
      producers = [...producers, { socketId: socket.id, producer, roomName }];

      peers[socket.id] = {
        ...peers[socket.id],
        producers: [...peers[socket.id].producers, producer.id],
      };
      await sendPlainRTPStreams(roomName, socket.id);
    };

    addConsumer = (consumer: mediasoup.types.Consumer, roomName: string) => {
      // add the consumer to the consumers list
      consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

      // add the consumer id to the peers list
      peers[socket.id] = {
        ...peers[socket.id],
        consumers: [...peers[socket.id].consumers, consumer.id],
      };
    };

    socket.on("getProducers", (callback) => {
      //return all producer transports
      const { roomName } = peers[socket.id];

      let producerList: string[] = [];
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socket.id &&
          producerData.roomName === roomName
        ) {
          producerList = [...producerList, producerData.producer.id];
        }
      });

      // return the producer list back to the client
      callback(producerList);
    });

    const informConsumers = (
      roomName: string,
      socketId: string,
      id: string
    ) => {
      console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
      // A new producer just joined
      // let all consumers to consume this producer
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socketId &&
          producerData.roomName === roomName
        ) {
          const producerSocket = peers[producerData.socketId].socket;
          // use socket to send producer id to producer
          producerSocket.emit("new-producer", { producerId: id });
        }
      });
    };

    const getTransport = (
      socketId: string
    ): mediasoup.types.WebRtcTransport => {
      const producerTransport = transports.find(
        (transport) => transport.socketId === socketId && !transport.consumer
      );
      return producerTransport!.transport as mediasoup.types.WebRtcTransport;
    };

    // see client's socket.emit('transport-connect', ...)
    socket.on(
      "transport-connect",
      ({ dtlsParameters }: TransportConnectData) => {
        console.log("DTLS PARAMS... ", { dtlsParameters });
        getTransport(socket.id).connect({ dtlsParameters });
      }
    );

    // see client's socket.emit('transport-produce', ...)
    socket.on(
      "transport-produce",
      async (
        { kind, rtpParameters, appData }: TransportProduceData,
        callback
      ) => {
        // call produce based on the parameters from the client
        const producer = await getTransport(socket.id).produce({
          kind: kind as mediasoup.types.MediaKind,
          rtpParameters,
        });

        // add producer to the producers array
        const { roomName } = peers[socket.id];

        await addProducer(producer, roomName);

        informConsumers(roomName, socket.id, producer.id);

        console.log("Producer ID: ", producer.id, producer.kind);

        producer.on("transportclose", () => {
          console.log("transport for this producer closed ");
          producer.close();
        });

        // Send back to the client the Producer's id
        callback({
          id: producer.id,
          producersExist: producers.length > 1,
        });
      }
    );

    // see client's socket.emit('transport-recv-connect', ...)
    socket.on(
      "transport-recv-connect",
      async ({
        dtlsParameters,
        serverConsumerTransportId,
      }: TransportRecvConnectData) => {
        console.log(`DTLS PARAMS: ${dtlsParameters}`);
        const consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id === serverConsumerTransportId
        )!.transport as mediasoup.types.WebRtcTransport;
        await consumerTransport.connect({ dtlsParameters });
      }
    );

    socket.on(
      "consume",
      async (
        {
          rtpCapabilities,
          remoteProducerId,
          serverConsumerTransportId,
        }: ConsumeData,
        callback
      ) => {
        try {
          const { roomName } = peers[socket.id];
          const router = rooms[roomName].router;
          const consumerTransport = transports.find(
            (transportData) =>
              transportData.consumer &&
              transportData.transport.id === serverConsumerTransportId
          )!.transport as mediasoup.types.WebRtcTransport;

          // check if the router can consume the specified producer
          if (
            router.canConsume({
              producerId: remoteProducerId,
              rtpCapabilities,
            })
          ) {
            // transport can now consume and return a consumer
            const consumer = await consumerTransport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            });

            consumer.on("transportclose", () => {
              console.log("transport close from consumer");
            });

            consumer.on("producerclose", () => {
              console.log("producer of consumer closed");
              socket.emit("producer-closed", { remoteProducerId });

              consumerTransport.close();
              transports = transports.filter(
                (transportData) =>
                  transportData.transport.id !== consumerTransport.id
              );
              consumer.close();
              consumers = consumers.filter(
                (consumerData) => consumerData.consumer.id !== consumer.id
              );
            });

            addConsumer(consumer, roomName);

            // from the consumer extract the following params
            // to send back to the Client
            const params = {
              id: consumer.id,
              producerId: remoteProducerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              serverConsumerId: consumer.id,
            };

            // send the parameters to the client
            callback({ params });
          }
        } catch (error: any) {
          console.log(error.message);
          callback({
            params: {
              error: error,
            },
          });
        }
      }
    );

    socket.on(
      "consumer-resume",
      async ({ serverConsumerId }: ConsumerResumeData) => {
        console.log("consumer resume");
        const consumerData = consumers.find(
          (consumerData) => consumerData.consumer.id === serverConsumerId
        );
        if (consumerData) {
          await consumerData.consumer.resume();
        }
      }
    );
  });
};
