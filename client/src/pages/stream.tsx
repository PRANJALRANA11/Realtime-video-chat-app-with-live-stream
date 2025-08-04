import React, { useEffect, useRef } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const Stream: React.FC<{ roomName: string }> = ({ roomName }) => {
  const socketRef = io("http://localhost:3000/mediasoup");
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const deviceRef = useRef<mediasoupClient.types.Device | null>(null);
  const rtpCapabilitiesRef =
    useRef<mediasoupClient.types.RtpCapabilities | null>(null);
  const producerTransportRef = useRef<mediasoupClient.types.Transport | null>(
    null
  );
  const consumerTransportsRef = useRef<
    {
      consumerTransport: mediasoupClient.types.Transport;
      serverConsumerTransportId: string;
      producerId: string;
      consumer: mediasoupClient.types.Consumer;
    }[]
  >([]);

  const consumingTransports = useRef<string[]>([]);

  const audioParams: Partial<mediasoupClient.types.ProducerOptions> = {};
  const videoParams: Partial<mediasoupClient.types.ProducerOptions> = {
    encodings: [
      { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
      { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
      { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  socketRef.on("connection-success", ({ socketId }: { socketId: string }) => {
    console.log(socketId);
    getLocalStream();
  });

  socketRef.on("new-producer", ({ producerId }: { producerId: string }) => {
    signalNewConsumerTransport(producerId);
  });

  socketRef.on(
    "producer-closed",
    ({ remoteProducerId }: { remoteProducerId: string }) => {
      const index = consumerTransportsRef.current.findIndex(
        (data) => data.producerId === remoteProducerId
      );
      if (index !== -1) {
        const { consumerTransport, consumer } =
          consumerTransportsRef.current[index];
        consumerTransport.close();
        consumer.close();
        consumerTransportsRef.current.splice(index, 1);
        const elem = document.getElementById(`td-${remoteProducerId}`);
        if (elem && videoContainerRef.current)
          videoContainerRef.current.removeChild(elem);
      }
    }
  );

  const getLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { min: 640, max: 1920 },
          height: { min: 400, max: 1080 },
        },
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      audioParams.track = stream.getAudioTracks()[0];
      videoParams.track = stream.getVideoTracks()[0];
      joinRoom();
    } catch (err) {
      console.error("getUserMedia error:", err);
    }
  };

  const joinRoom = () => {
    socketRef.emit(
      "joinRoom",
      { roomName },
      (data: { rtpCapabilities: mediasoupClient.types.RtpCapabilities }) => {
        rtpCapabilitiesRef.current = data.rtpCapabilities;
        createDevice();
      }
    );
  };

  const createDevice = async () => {
    try {
      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: rtpCapabilitiesRef.current! });
      deviceRef.current = device;
      createSendTransport();
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: string }).name === "UnsupportedError"
      )
        console.warn("browser not supported");
    }
  };

  const createSendTransport = () => {
    socketRef.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({
        params,
      }: {
        params: {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
          sctpParameters?: mediasoupClient.types.SctpParameters;
          error?: string;
        };
      }) => {
        if (params.error) return console.error(params.error);

        const transport = deviceRef.current!.createSendTransport(params);
        producerTransportRef.current = transport;

        transport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            socketRef.emit("transport-connect", { dtlsParameters });
            callback();
          }
        );

        transport.on("produce", async (parameters, callback, errback) => {
          socketRef.emit(
            "transport-produce",
            {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            },
            ({
              id,
              producersExist,
            }: {
              id: string;
              producersExist: boolean;
            }) => {
              callback({ id });
              if (producersExist) getProducers();
            }
          );
        });

        connectSendTransport();
      }
    );
  };

  const connectSendTransport = async () => {
    const audioProducer = await producerTransportRef.current!.produce(
      audioParams
    );
    const videoProducer = await producerTransportRef.current!.produce(
      videoParams
    );
    [audioProducer, videoProducer].forEach((producer) => {
      producer.on("trackended", () =>
        console.log(`${producer.kind} track ended`)
      );
      producer.on("transportclose", () =>
        console.log(`${producer.kind} transport closed`)
      );
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId: string) => {
    if (consumingTransports.current.includes(remoteProducerId)) return;
    consumingTransports.current.push(remoteProducerId);

    socketRef.emit(
      "createWebRtcTransport",
      { consumer: true },

      ({
        params,
      }: {
        params: {
          id: string;
          iceParameters: mediasoupClient.types.IceParameters;
          iceCandidates: mediasoupClient.types.IceCandidate[];
          dtlsParameters: mediasoupClient.types.DtlsParameters;
          sctpParameters?: mediasoupClient.types.SctpParameters;
          error?: string;
        };
      }) => {
        if (params.error) return;

        const consumerTransport =
          deviceRef.current!.createRecvTransport(params);
        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            socketRef.emit("transport-recv-connect", {
              dtlsParameters,
              serverConsumerTransportId: params.id,
            });
            callback();
          }
        );

        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      }
    );
  };

  const connectRecvTransport = async (
    consumerTransport: mediasoupClient.types.Transport,
    remoteProducerId: string,
    serverConsumerTransportId: string
  ) => {
    socketRef.emit(
      "consume",
      {
        rtpCapabilities: deviceRef.current!.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({
        params,
      }: {
        params: {
          error?: boolean;
          id: string;
          producerId: string;
          kind: "audio" | "video";
          rtpParameters: mediasoupClient.types.RtpParameters;
          serverConsumerId: string;
        };
      }) => {
        if (params.error) return;

        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        consumerTransportsRef.current.push({
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        });

        const mediaElem = document.createElement(
          params.kind === "video" ? "video" : "audio"
        );
        mediaElem.setAttribute("id", remoteProducerId);
        mediaElem.autoplay = true;
        if (params.kind === "video") mediaElem.className = "remoteVideo";

        const wrap = document.createElement("div");
        wrap.setAttribute("id", `td-${remoteProducerId}`);
        wrap.className = "videoWrap";
        wrap.appendChild(mediaElem);
        videoContainerRef.current?.appendChild(wrap);
        (mediaElem as HTMLMediaElement).srcObject = new MediaStream([
          consumer.track,
        ]);

        socketRef.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  };

  const getProducers = () => {
    socketRef.emit("getProducers", (producerIds: string[]) => {
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  return (
    <div className="p-4">
      <div className="flex gap-4 flex-wrap">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          className="w-60 rounded-xl shadow-lg border border-gray-300"
        />
        <div
          ref={videoContainerRef}
          className="flex flex-wrap gap-4 justify-start items-start"
        ></div>
      </div>
    </div>
  );
};

export default Stream;
