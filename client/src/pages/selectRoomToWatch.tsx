import React from "react";

interface HomeProps {
  roomNameWatch: string;
  setRoomNameWatch: (value: string) => void;
  handleWatchStream: () => void;
}

const SelectWatch: React.FC<HomeProps> = ({
  roomNameWatch,
  setRoomNameWatch,
  handleWatchStream,
}) => {
  return (
    <div>
      <h1>Enter Room Name</h1>
      <input
        type="text"
        value={roomNameWatch}
        onChange={(e) => setRoomNameWatch(e.target.value)}
        placeholder="Room name"
      />
      <div style={{ marginTop: "1rem" }}>
        <button onClick={handleWatchStream}>Watch Stream</button>
      </div>
    </div>
  );
};

export default SelectWatch;
