const BOARD_SIZE = 15;
const BLACK = 1;
const WHITE = 2;
const DIFFICULTY_TIME_LIMITS = { easy: 10, normal: 50, hard: 100 };

function newRoundId() {
  return globalThis.crypto?.randomUUID?.() || `round-${Date.now()}-${Math.random()}`;
}

const worker = new Worker(new URL("../wasm/pentazen-worker.js", import.meta.url), { type: "module" });
let requestId = 0;
const pendingAIRequests = new Map();

worker.addEventListener("message", (event) => {
  const pending = pendingAIRequests.get(event.data.id);
  if (!pending) return;
  pendingAIRequests.delete(event.data.id);
  if (event.data.error) pending.reject(new Error(event.data.error));
  else pending.resolve({ x: event.data.x, y: event.data.y });
});

worker.addEventListener("error", (event) => {
  for (const pending of pendingAIRequests.values()) {
    pending.reject(new Error(event.message || "PentaZen 加载失败"));
  }
  pendingAIRequests.clear();
});

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

const game = {
  board: createBoard(),
  mode: "pve",
  difficulty: "normal",
  aiTimeLimit: DIFFICULTY_TIME_LIMITS.normal,
  playerColor: BLACK,
  currentPlayer: BLACK,
  gameOver: false,
  aiBusy: false,
  transitioning: false,
  moveHistory: [],
  scores: { player: 0, ai: 0 },
  winner: null,
  reason: null,
  roundResult: null,
  roundId: newRoundId(),
  completedGame: null,
};

function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function inBoard(x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell !== 0));
}

function isWin(board, x, y) {
  const player = board[y][x];
  if (!player) return false;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const direction of [1, -1]) {
      let nextX = x + dx * direction;
      let nextY = y + dy * direction;
      while (inBoard(nextX, nextY) && board[nextY][nextX] === player) {
        count += 1;
        nextX += dx * direction;
        nextY += dy * direction;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function getState(message, extra = {}) {
  return {
    success: true,
    message,
    board: game.board,
    mode: game.mode,
    difficulty: game.difficulty,
    aiTimeLimit: game.aiTimeLimit,
    playerColor: game.playerColor,
    aiColor: otherColor(game.playerColor),
    currentPlayer: game.currentPlayer,
    gameOver: game.gameOver,
    aiBusy: game.aiBusy,
    transitioning: game.transitioning,
    winner: game.winner,
    draw: game.gameOver && game.winner === null,
    reason: game.reason,
    moveCount: game.moveHistory.length,
    scores: { ...game.scores },
    completedGame: game.completedGame,
    ...extra,
  };
}

function resetRound() {
  game.board = createBoard();
  game.currentPlayer = game.mode === "pvp" ? BLACK : game.playerColor;
  game.gameOver = false;
  game.aiBusy = false;
  game.transitioning = false;
  game.moveHistory = [];
  game.winner = null;
  game.reason = null;
  game.roundResult = null;
  game.roundId = newRoundId();
  game.completedGame = null;
}

function createCompletedGame(winner, finishReason) {
  if (game.mode !== "pve") return null;
  return {
    clientGameId: game.roundId,
    gameType: "ai",
    difficulty: game.difficulty,
    playerColor: game.playerColor,
    winnerColor: winner,
    finishReason,
    moves: game.moveHistory.map(({ x, y, player }) => ({ x, y, player })),
  };
}

function finishRound(winner, reason, finishReason = "five") {
  if (game.gameOver) return;
  game.gameOver = true;
  game.currentPlayer = null;
  game.winner = winner;
  game.reason = reason;
  game.completedGame = createCompletedGame(winner, finishReason);
  const winnerActor = game.mode === "pvp"
    ? (winner === game.playerColor ? "player1" : "player2")
    : (winner === game.playerColor ? "player" : "ai");
  game.roundResult = { winnerActor, scoreAwarded: winner !== null };
  if (winnerActor === "player" || winnerActor === "player1") game.scores.player += 1;
  else if (winnerActor === "ai" || winnerActor === "player2") game.scores.ai += 1;
}

function askAI() {
  console.log("YXBOARD");
  for (const move of game.moveHistory) console.log(`${move.y},${move.x},${move.player}`);
  console.log("DONE");
  const history = game.moveHistory.map(({ x, y }) => `${y},${x}`).join(";");
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pendingAIRequests.set(id, { resolve, reject });
    worker.postMessage({ id, history, timeLimit: game.aiTimeLimit });
  });
}

async function makeAIOpening() {
  game.aiBusy = true;
  try {
    const move = await askAI();
    if (!inBoard(move.x, move.y) || game.board[move.y][move.x] !== 0) {
      throw new Error("AI 返回的位置无效或已经有棋子");
    }
    game.board[move.y][move.x] = BLACK;
    game.moveHistory.push({ ...move, player: BLACK, actor: "ai" });
    console.log(`${move.x},${move.y},${BLACK}`);
  } finally {
    game.aiBusy = false;
  }
}

async function startRound(switchSides = false) {
  if (switchSides) game.playerColor = otherColor(game.playerColor);
  resetRound();
  if (game.mode === "pve" && game.playerColor === WHITE) await makeAIOpening();
  game.currentPlayer = game.mode === "pvp" ? BLACK : game.playerColor;
}

async function startMatch(body) {
  if (!["pvp", "pve"].includes(body.mode)) throw new Error("请选择单人或双人模式");
  if (body.mode === "pve" && !Object.hasOwn(DIFFICULTY_TIME_LIMITS, body.difficulty)) {
    throw new Error("请选择 AI 难度");
  }
  game.mode = body.mode;
  game.difficulty = body.mode === "pve" ? body.difficulty : null;
  game.aiTimeLimit = body.mode === "pve" ? DIFFICULTY_TIME_LIMITS[body.difficulty] : 0;
  game.playerColor = BLACK;
  game.scores = { player: 0, ai: 0 };
  await startRound();
  const message = game.mode === "pvp"
    ? "双人模式开始，玩家 1 执黑棋先行。"
    : `单人模式开始：${game.difficulty === "easy" ? "简单" : game.difficulty === "normal" ? "普通" : "困难"}难度。`;
  return getState(message);
}

async function move(body) {
  const x = Number(body.x);
  const y = Number(body.y);
  const expectedPlayer = game.mode === "pvp" ? game.currentPlayer : game.playerColor;
  if (Number(body.player) !== expectedPlayer || !inBoard(x, y)) throw new Error("落子参数不正确");
  if (game.gameOver) throw new Error("本局已结束，请点击重新开始");
  if (game.board[y][x] !== 0) throw new Error("这个位置不能落子");

  console.log(`${x},${y},${expectedPlayer}`);
  game.board[y][x] = expectedPlayer;
  const actor = game.mode === "pvp"
    ? (expectedPlayer === game.playerColor ? "player1" : "player2")
    : "player";
  const playerMove = { x, y, player: expectedPlayer };
  game.moveHistory.push({ ...playerMove, actor });

  if (isWin(game.board, x, y)) {
    finishRound(expectedPlayer, game.mode === "pvp"
      ? `${expectedPlayer === game.playerColor ? "玩家 1" : "玩家 2"}五子连珠，获胜！`
      : "五子连珠，你赢了！");
    return getState(game.reason, { playerMove, aiMove: null });
  }
  if (isBoardFull(game.board)) {
    finishRound(null, "棋盘已满，本局平局。", "draw");
    return getState(game.reason, { playerMove, aiMove: null });
  }
  if (game.mode === "pvp") {
    game.currentPlayer = otherColor(expectedPlayer);
    return getState("轮到下一位玩家落子。", { playerMove, aiMove: null });
  }

  game.aiBusy = true;
  try {
    const aiPosition = await askAI();
    if (!inBoard(aiPosition.x, aiPosition.y) || game.board[aiPosition.y][aiPosition.x] !== 0) {
      throw new Error("AI 返回的位置无效或已经有棋子");
    }
    const aiColor = otherColor(game.playerColor);
    const aiMove = { ...aiPosition, player: aiColor };
    game.board[aiMove.y][aiMove.x] = aiColor;
    game.moveHistory.push({ ...aiMove, actor: "ai" });
    console.log(`${aiMove.x},${aiMove.y},${aiMove.player}`);
    if (isWin(game.board, aiMove.x, aiMove.y)) finishRound(aiColor, "AI 五子连珠，本局结束。");
    else if (isBoardFull(game.board)) finishRound(null, "棋盘已满，本局平局。", "draw");
    game.aiBusy = false;
    return getState(game.reason || "轮到你落子。", { playerMove, aiMove });
  } catch (error) {
    game.board[y][x] = 0;
    game.moveHistory.pop();
    game.aiBusy = false;
    throw error;
  }
}

async function undo() {
  const lastPlayerMove = game.mode === "pvp"
    ? game.moveHistory.length - 1
    : game.moveHistory.map((item) => item.actor).lastIndexOf("player");
  if (lastPlayerMove === -1) throw new Error("还没有可以悔的棋");
  const retractedRecordId = game.completedGame?.clientGameId || null;
  if (game.roundResult?.scoreAwarded) {
    if (["player", "player1"].includes(game.roundResult.winnerActor)) {
      game.scores.player = Math.max(0, game.scores.player - 1);
    } else {
      game.scores.ai = Math.max(0, game.scores.ai - 1);
    }
  }
  const undoneMoves = game.moveHistory.splice(lastPlayerMove);
  for (const item of undoneMoves) game.board[item.y][item.x] = 0;
  game.currentPlayer = game.mode === "pvp" ? undoneMoves[0].player : game.playerColor;
  game.gameOver = false;
  game.winner = null;
  game.reason = null;
  game.roundResult = null;
  game.completedGame = null;
  return getState(game.mode === "pve" && undoneMoves.length === 2
    ? "已悔掉你和 AI 的上一回合。"
    : "已悔掉最后一步。", { retractedRecordId });
}

async function surrender() {
  if (game.gameOver) throw new Error("本局已经结束，请点击重新开始");
  if (game.mode === "pvp") {
    const winner = otherColor(game.currentPlayer);
    const winnerActor = winner === game.playerColor ? "玩家 1" : "玩家 2";
    const completedGame = createCompletedGame(winner, "surrender");
    if (winner === game.playerColor) game.scores.player += 1;
    else game.scores.ai += 1;
    await startRound();
    return getState(`${winnerActor}获胜并得 1 分；已开始新的一局。`, {
      surrendered: true,
      completedGame,
    });
  }
  const completedGame = createCompletedGame(otherColor(game.playerColor), "surrender");
  game.scores.ai += 1;
  await startRound(true);
  const message = game.playerColor === BLACK
    ? "你已投降，AI 得 1 分；已开始新的一局，你执黑棋先行。"
    : "你已投降，AI 得 1 分；AI 已执黑棋先行，你执白棋。";
  return getState(message, { surrendered: true, completedGame });
}

export async function localRequest(endpoint, body = {}) {
  if (endpoint === "/start") return startMatch(body);
  if (endpoint === "/move") return move(body);
  if (endpoint === "/undo") return undo();
  if (endpoint === "/surrender") return surrender();
  if (endpoint === "/reset") {
    await startRound(true);
    const message = game.mode === "pvp"
      ? `已开始新的一局，${game.playerColor === BLACK ? "玩家 1" : "玩家 2"} 执黑棋先行。`
      : game.playerColor === BLACK
        ? "已开始新的一局。你执黑棋先行。"
        : "已开始新的一局。AI 已执黑棋先行，你执白棋。";
    return getState(message);
  }
  throw new Error("接口不存在");
}
