// Interfaces
export interface PeerDetails {
  name: string;
  isAdmin: boolean;
}

export interface Peer {
  socket: Socket;
  roomName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: PeerDetails;
}

export interface Room {
  router: mediasoup.types.Router;
  peers: string[];
}

export interface TransportData {
  socketId: string;
  transport: mediasoup.types.Transport;
  roomName: string;
  consumer: boolean;
}

export interface ProducerData {
  socketId: string;
  producer: mediasoup.types.Producer;
  roomName: string;
}

export interface ConsumerData {
  socketId: string;
  consumer: mediasoup.types.Consumer;
  roomName: string;
}

export interface ConsumerPortMapping {
  id: string;
  consumer: mediasoup.types.Consumer;
  port: number;
  rtcpPort: number;
}

export interface JoinRoomData {
  roomName: string;
}

export interface CreateWebRtcTransportData {
  consumer: boolean;
}

export interface TransportConnectData {
  dtlsParameters: mediasoup.types.DtlsParameters;
}

export interface TransportProduceData {
  kind: string;
  rtpParameters: mediasoup.types.RtpParameters;
  appData: any;
}

export interface TransportRecvConnectData {
  dtlsParameters: mediasoup.types.DtlsParameters;
  serverConsumerTransportId: string;
}

export interface ConsumeData {
  rtpCapabilities: mediasoup.types.RtpCapabilities;
  remoteProducerId: string;
  serverConsumerTransportId: string;
}

export interface ConsumerResumeData {
  serverConsumerId: string;
}
