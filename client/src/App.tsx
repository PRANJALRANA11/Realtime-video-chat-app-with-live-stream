import { useState } from "react";
import Stream from "./pages/stream";
import Watch from "./pages/watch";
import "./App.css";
import { Routes, Route, useNavigate } from "react-router-dom";
import Home from "./pages/home";
import SelectWatch from "./pages/selectRoomToWatch";

function App() {
  const [roomName, setRoomName] = useState("testRoom");
  const [roomNameWatch, setRoomNameWatch] = useState(roomName);
  const navigate = useNavigate();

  const handleStartStream = () => {
    if (roomName) navigate(`/stream`);
  };
  const handleWatchStream = () => {
    if (roomName) navigate(`/watch`);
  };

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <Home
              roomName={roomName}
              setRoomName={setRoomName}
              handleStartStream={handleStartStream}
            />
          }
        />
        <Route
          path="/select"
          element={
            <SelectWatch
              roomNameWatch={roomNameWatch}
              setRoomNameWatch={setRoomNameWatch}
              handleWatchStream={handleWatchStream}
            />
          }
        />
        <Route path="/stream" element={<Stream roomName={roomName} />} />
        <Route
          path="/watch"
          element={
            <Watch
              src={`http://localhost:3000/hls/merged/${roomNameWatch}/stream.m3u8`}
            />
          }
        />
      </Routes>
    </>
  );
}

export default App;
