import React, { useState } from "react";

const App = () => {
  const emptyBoard = Array(9).fill("-");
  const [board, setBoard] = useState(emptyBoard);
  const [playerSymbol] = useState("X");
  const [aiSymbol] = useState("O");
  const [winner, setWinner] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const checkWinner = (b) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6],             // diagonals
    ];
    for (let [a, bIdx, c] of lines) {
      if (b[a] !== "-" && b[a] === b[bIdx] && b[a] === b[c]) {
        return b[a];
      }
    }
    if (!b.includes("-")) return "draw";
    return null;
  };

  const handleClick = async (index) => {
    if (board[index] !== "-" || winner || isLoading) return;

    const newBoard = [...board];
    newBoard[index] = playerSymbol;
    const result = checkWinner(newBoard);
    if (result) {
      setBoard(newBoard);
      setWinner(result);
      return;
    }
    setBoard(newBoard);
    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: newBoard, aiSymbol }),
      });
      const data = await res.json();
      if (data.move !== undefined && newBoard[data.move] === "-") {
        newBoard[data.move] = aiSymbol;
      }
      const resultAfterAI = checkWinner(newBoard);
      setBoard(newBoard);
      if (resultAfterAI) setWinner(resultAfterAI);
    } catch (err) {
      console.error("❌ Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const resetGame = () => {
    setBoard(emptyBoard);
    setWinner(null);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-bold text-blue-400 mb-6">🎮 Tic-Tac-Toe</h1>

      <div className="grid grid-cols-3 gap-2">
        {board.map((cell, idx) => (
          <button
            key={idx}
            onClick={() => handleClick(idx)}
            className="w-20 h-20 bg-gray-800 text-3xl font-bold rounded-lg flex items-center justify-center hover:bg-gray-700 transition"
            disabled={winner || isLoading}
          >
            {cell !== "-" ? cell : ""}
          </button>
        ))}
      </div>

      {winner && (
        <div className="mt-6 text-xl font-semibold text-green-400">
          {winner === "draw"
            ? "🤝 It's a Draw!"
            : winner === playerSymbol
              ? "🎉 You Win!"
              : "🤖 AI Wins!"}
        </div>
      )}

      <button
        onClick={resetGame}
        className="mt-6 px-6 py-2 bg-blue-500 text-gray-900 font-semibold rounded-lg hover:bg-blue-400 transition"
      >
        Restart Game
      </button>
    </div>
  );
};

export default App;
