import React, { useEffect, useRef } from "react";
import Hls from "hls.js";

interface HLSPlayerProps {
  src: string;
  width?: string;
  height?: string;
}

const Watch: React.FC<HLSPlayerProps> = ({
  src,
  width = "640px",
  height = "360px",
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    const initHls = (source: string) => {
      if (hls) {
        hls.destroy();
      }
      hls = new Hls({
        liveSyncDuration: 3,
        liveMaxLatencyDuration: 10,
        manifestLoadingTimeOut: 5000,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: Infinity,
      });
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      // Error handling
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn("HLS fatal error:", data.type);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Retry loading the same src with cache-busting
              initHls(`${src}?_t=${Date.now()}`);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              initHls(`${src}?_t=${Date.now()}`);
              break;
          }
        }
      });
    };

    if (Hls.isSupported()) {
      initHls(src);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        video.play();
      });
    }

    return () => {
      hls?.destroy();
    };
  }, [src]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="bg-gray-800 rounded-xl shadow-lg p-4">
        <video
          ref={videoRef}
          controls
          autoPlay
          className="rounded-lg"
          style={{ width, height }}
        />
        <div className="text-center text-gray-300 mt-2">
          Now Playing: <code>{src}</code>
        </div>
      </div>
    </div>
  );
};

export default Watch;
