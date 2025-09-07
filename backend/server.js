// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-1.5-flash-latest";

if (!GEMINI_API_KEY) {
    console.error("❌ Missing GEMINI_API_KEY in .env file");
    process.exit(1);
}

/* ---------- Game helpers ---------- */

// Winning/completion lines
const LINES = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];

// Return index (0-8) if there's a winning move for `symbol`, otherwise -1
function findWinningMove(board, symbol) {
    for (const [a, b, c] of LINES) {
        const vals = [board[a], board[b], board[c]];
        if (vals.filter((v) => v === symbol).length === 2 && vals.includes("-")) {
            const emptyIndexInLine = vals.indexOf("-");
            const indices = [a, b, c];
            return indices[emptyIndexInLine];
        }
    }
    return -1;
}

// Deterministic fallback strategy (win -> block -> center -> corners -> sides -> first empty)
function chooseFallback(board, aiSymbol) {
    const opp = aiSymbol === "X" ? "O" : "X";

    // 1) Win if possible
    const winning = findWinningMove(board, aiSymbol);
    if (winning !== -1) return winning;

    // 2) Block opponent
    const block = findWinningMove(board, opp);
    if (block !== -1) return block;

    // 3) Center
    if (board[4] === "-") return 4;

    // 4) Corners in order 0,2,6,8
    for (const i of [0, 2, 6, 8]) if (board[i] === "-") return i;

    // 5) Sides in order 1,3,5,7
    for (const i of [1, 3, 5, 7]) if (board[i] === "-") return i;

    // 6) Final: first empty
    return board.findIndex((c) => c === "-");
}

/* ---------- Prompt builder ---------- */

function buildPayload(board, aiSymbol) {
    // Safely build empties list for prompt
    const emptiesArr = board
        .map((c, i) => (c === "-" ? i : null))
        .filter((v) => v !== null);
    const empties = emptiesArr.join(", ");

    // Very strict prompt: list empties, force single-digit-only output, stepwise strategy
    const prompt = `
You are an AI player playing Tic-Tac-Toe as "${aiSymbol}".
Board (indexes):
0 | 1 | 2
3 | 4 | 5
6 | 7 | 8

Current board: ${board.join(",")}
Empty cell indexes: [${empties}]

RULES (follow exactly):
- "X" = human player. "${aiSymbol}" = you (AI).
- "-" means empty.
- You MUST return EXACTLY ONE character: a single digit representing an index from the Empty cell indexes list.
- Output must be only the digit (0-8) and nothing else (no words, no punctuation, no newline, no labels).

STRATEGY (do these checks in order):
1) If you can WIN this move, return the winning index.
2) Else if the opponent (X) can win next move, return the index that blocks that win.
3) Else if neither, pick in this priority order:
   a) center (4) if it is empty,
   b) any corner in this order: 0,2,6,8 (choose the first free),
   c) any side in this order: 1,3,5,7 (choose the first free).
4) NEVER choose an occupied cell.
5) If multiple choices are equally good pick the lowest index among them.

Important:
- ONLY return one digit from the list of empty indexes above.
- If you cannot follow these rules, return the lowest empty index (as a single digit).

Now choose your next move and output the single digit only.
`;

    return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 4 },
    };
}

/* ---------- API Route ---------- */

app.post("/move", async (req, res) => {
    try {
        let { board, aiSymbol } = req.body;

        // Basic validation
        if (!board || !aiSymbol) {
            return res.status(400).json({ error: "Missing board or aiSymbol" });
        }

        // Accept boards that arrive as comma string or as array
        if (typeof board === "string") {
            // allow "X,-,O,..." or JSON string
            try {
                const parsed = JSON.parse(board);
                if (Array.isArray(parsed)) board = parsed;
            } catch {
                // fallback: split on commas
                board = board.split(",").map((s) => s.trim());
            }
        }

        if (!Array.isArray(board) || board.length !== 9) {
            return res.status(400).json({ error: "Board must be an array of length 9" });
        }

        // validate elements
        const allowed = new Set(["X", "O", "-"]);
        for (const cell of board) {
            if (!allowed.has(cell)) {
                return res
                    .status(400)
                    .json({ error: "Board cells must be one of 'X', 'O', or '-'" });
            }
        }

        if (!["X", "O"].includes(aiSymbol)) {
            return res.status(400).json({ error: 'aiSymbol must be "X" or "O"' });
        }

        // If board has no empty cells, return error
        if (!board.includes("-")) {
            return res.status(400).json({ error: "Board is full" });
        }

        // Build payload & call Gemini
        const payload = buildPayload(board, aiSymbol);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

        let moveText = "";
        let aiMove = NaN;
        let fallbackUsed = false;

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY,
                },
                timeout: 30000,
            });

            moveText = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            console.log("Raw AI response:", JSON.stringify(moveText));

            // Try to extract first valid digit (0-8) that corresponds to an empty cell
            const digits = String(moveText).match(/[0-8]/g);
            if (digits && digits.length > 0) {
                for (const d of digits) {
                    const idx = parseInt(d, 10);
                    if (board[idx] === "-") {
                        aiMove = idx;
                        break;
                    }
                }
            }

            // If aiMove still invalid or occupied, we'll fall back
            if (isNaN(aiMove) || aiMove < 0 || aiMove > 8 || board[aiMove] !== "-") {
                fallbackUsed = true;
                aiMove = chooseFallback(board, aiSymbol);
                console.warn("Using fallback move:", { raw: moveText, fallback: aiMove });
            }
        } catch (err) {
            // If AI request fails, use deterministic fallback to avoid blocking the game
            console.error("AI request failed:", err.message || err);
            fallbackUsed = true;
            aiMove = chooseFallback(board, aiSymbol);
        }

        // Final validation: ensure we have a valid move
        if (isNaN(aiMove) || aiMove < 0 || aiMove > 8 || board[aiMove] !== "-") {
            // As a last-resort, pick first empty
            const firstEmpty = board.findIndex((c) => c === "-");
            if (firstEmpty === -1) {
                return res.status(400).json({ error: "No valid moves available" });
            }
            aiMove = firstEmpty;
            fallbackUsed = true;
            console.warn("Final fallback to first empty:", aiMove);
        }

        // Successful response
        return res.json({
            move: aiMove,
            fallbackUsed,
            raw: moveText, // helpful for debugging during development
        });
    } catch (error) {
        console.error("🔥 Server error:", error.response?.data || error.message);
        return res
            .status(500)
            .json({ error: "Internal server error", detail: error.message });
    }
});

/* ---------- Start server ---------- */

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
