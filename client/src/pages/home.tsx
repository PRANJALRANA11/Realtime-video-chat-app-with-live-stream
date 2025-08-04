import React from "react";

interface HomeProps {
  roomName: string;
  setRoomName: (value: string) => void;
  handleStartStream: () => void;
}

const Home: React.FC<HomeProps> = ({
  roomName,
  setRoomName,
  handleStartStream,
}) => {
  return (
    <div>
      <h1>Enter Room Name</h1>
      <input
        type="text"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
        placeholder="Room name"
      />
      <div style={{ marginTop: "1rem" }}>
        <button onClick={handleStartStream}>Start Stream</button>
      </div>
    </div>
  );
};

export default Home;
