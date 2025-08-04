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

    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // For Safari
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
