const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const BOARD_SIZE = 15;
const BLACK = 1;
const WHITE = 2;
const GAME_MODE_PVP = "pvp";
const GAME_MODE_PVE = "pve";
const DIFFICULTY_TIME_LIMITS = {
  easy: 10,
  normal: 50,
  hard: 100,
};
const ROOT_PATH = path.join(__dirname, "..");
const FRONTEND_PATH = path.join(ROOT_PATH, "frontend");
const PENTA_PATH = process.env.PENTA_PATH || path.join(ROOT_PATH, "PentaZen", "PentaZen");
const games = new Map();

// 坐标约定：左上角为 (0,0)，向右 x 增大，向下 y 增大。
// 所有业务对象使用 { x, y, player }，二维数组固定使用 board[y][x]。
// PentaZen 协议的输入和输出坐标都使用 y,x 顺序。

function formatMove({ x, y, player }) {
  return `x=${x}, y=${y}, player=${player}`;
}

function logMove(label, move) {
  console.log(`[${label}] ${formatMove(move)}`);
}

function sendToAI(process, message) {
  console.log(message);
  process.stdin.write(`${message}\n`);
}

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function createGame() {
  return {
    board: createBoard(),
    mode: GAME_MODE_PVE,
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
  };
}

function getGame(gameId) {
  if (!gameId || typeof gameId !== "string") {
    throw new Error("缺少 gameId");
  }
  if (!games.has(gameId)) {
    games.set(gameId, createGame());
  }
  return games.get(gameId);
}

function getState(game) {
  return {
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
  };
}

function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, error, game) {
  sendJson(res, statusCode, {
    success: false,
    message: error.message || "请求失败",
    ...(game ? getState(game) : {}),
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("请求数据过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("请求数据不是有效 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function inBoard(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function isBoardFull(board) {
  return board.every((line) => line.every((cell) => cell !== 0));
}

function isWin(board, x, y) {
  const player = board[y][x];
  if (player === 0) {
    return false;
  }

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
    if (count >= 5) {
      return true;
    }
  }
  return false;
}

function finishRound(game, winner, reason) {
  if (game.gameOver) {
    return;
  }

  game.gameOver = true;
  game.aiBusy = false;
  game.currentPlayer = null;
  game.winner = winner;
  game.reason = reason;
  const winnerActor = game.mode === GAME_MODE_PVP
    ? (winner === game.playerColor ? "player1" : "player2")
    : (winner === game.playerColor ? "player" : "ai");
  game.roundResult = { winner, winnerActor, scoreAwarded: winner !== null };
  game.pendingColorSwap = winner !== null;

  if (winner !== null) {
    if (winnerActor === "player" || winnerActor === "player1") {
      game.scores.player += 1;
    } else if (winnerActor === "ai" || winnerActor === "player2") {
      game.scores.ai += 1;
    }
  }
}

function resetRound(game) {
  game.board = createBoard();
  game.currentPlayer = game.mode === GAME_MODE_PVP ? BLACK : game.playerColor;
  game.gameOver = false;
  game.aiBusy = false;
  game.moveHistory = [];
  game.winner = null;
  game.reason = null;
  game.roundResult = null;
}

// PentaZen is one local process. Each tab's board and score are still kept
// independently, and the engine is rebuilt from the active tab's board.
let ai = null;
let aiReady = false;
let aiOutputBuffer = "";
let aiStartResolve = null;
let aiStartReject = null;
let aiStartTimeout = null;
let aiMoveResolve = null;
let aiMoveReject = null;
let aiMoveTimeout = null;

function clearMoveRequest(message) {
  if (aiMoveTimeout !== null) {
    clearTimeout(aiMoveTimeout);
    aiMoveTimeout = null;
  }
  if (aiMoveReject) {
    const reject = aiMoveReject;
    aiMoveResolve = null;
    aiMoveReject = null;
    reject(new Error(message));
  } else {
    aiMoveResolve = null;
    aiMoveReject = null;
  }
}

function stopAI() {
  if (aiStartTimeout !== null) {
    clearTimeout(aiStartTimeout);
    aiStartTimeout = null;
  }
  if (aiStartReject) {
    const reject = aiStartReject;
    aiStartResolve = null;
    aiStartReject = null;
    reject(new Error("PentaZen 已被重置"));
  }
  clearMoveRequest("PentaZen 已被重置");

  const currentAI = ai;
  ai = null;
  aiReady = false;
  aiOutputBuffer = "";
  if (currentAI) {
    currentAI.kill();
  }
}

function processAIOutput(text) {
  console.log(`[AI → 后端原始输出] ${JSON.stringify(text)}`);
  aiOutputBuffer += text;
  const lines = aiOutputBuffer.split(/\r?\n/);
  aiOutputBuffer = lines.pop();

  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      continue;
    }
    if (value === "OK") {
      aiReady = true;
      if (aiStartTimeout !== null) {
        clearTimeout(aiStartTimeout);
        aiStartTimeout = null;
      }
      if (aiStartResolve) {
        const resolve = aiStartResolve;
        aiStartResolve = null;
        aiStartReject = null;
        resolve();
      }
      continue;
    }

    const match = value.match(/^(\d+),(\d+)$/);
    if (!match || !aiMoveResolve) {
      continue;
    }
    // PentaZen outputs rank,file, which maps to y,x on the web board.
    const y = Number(match[1]);
    const x = Number(match[2]);
    if (!inBoard(x, y)) {
      continue;
    }

    logMove("AI → 后端落子", { x, y, player: "AI" });
    const resolve = aiMoveResolve;
    aiMoveResolve = null;
    aiMoveReject = null;
    if (aiMoveTimeout !== null) {
      clearTimeout(aiMoveTimeout);
      aiMoveTimeout = null;
    }
    resolve({ x, y });
  }
}

function startAI(timeLimit = DIFFICULTY_TIME_LIMITS.normal) {
  return new Promise((resolve, reject) => {
    aiReady = false;
    aiOutputBuffer = "";
    const process = spawn(PENTA_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
    ai = process;

    process.on("error", (error) => {
      const isActiveProcess = ai === process;
      if (isActiveProcess) {
        ai = null;
        aiReady = false;
      }
      if (isActiveProcess && aiStartReject) {
        const rejectStart = aiStartReject;
        aiStartResolve = null;
        aiStartReject = null;
        if (aiStartTimeout !== null) {
          clearTimeout(aiStartTimeout);
          aiStartTimeout = null;
        }
        rejectStart(error);
      }
    });
    process.stdout.on("data", (data) => processAIOutput(data.toString()));
    process.stderr.on("data", (data) => console.error("PentaZen:", data.toString()));
    process.on("close", () => {
      if (ai === process) {
        ai = null;
        aiReady = false;
        clearMoveRequest("PentaZen 已退出");
      }
    });

    aiStartResolve = resolve;
    aiStartReject = reject;
    aiStartTimeout = setTimeout(() => {
      if (aiStartReject) {
        const rejectStart = aiStartReject;
        aiStartResolve = null;
        aiStartReject = null;
        rejectStart(new Error("PentaZen 启动超时"));
      }
    }, 2_000);

    sendToAI(process, `INFO TIMEOUT_TURN ${timeLimit}`);
    sendToAI(process, `START ${BOARD_SIZE}`);
  });
}

function sendBoardToAI(moveHistory) {
  if (!ai || !aiReady) {
    throw new Error("PentaZen 还没有准备完成");
  }

  sendToAI(ai, "YXBOARD");
  // PentaZen ignores the player field and assigns colours by alternating turns,
  // so replay moves chronologically instead of scanning the board by position.
  for (const { x, y, player } of moveHistory) {
    sendToAI(ai, `${y},${x},${player}`);
  }
  sendToAI(ai, "DONE");
}

function requestAIMove(command) {
  return new Promise((resolve, reject) => {
    if (!ai || !aiReady) {
      reject(new Error("PentaZen 还没有准备完成"));
      return;
    }
    if (aiMoveResolve) {
      reject(new Error("AI 当前已经在思考"));
      return;
    }

    aiMoveResolve = resolve;
    aiMoveReject = reject;
    aiMoveTimeout = setTimeout(() => clearMoveRequest("AI 思考超时"), 5_000);
    sendToAI(ai, command);
  });
}

function askAI(x, y) {
  return requestAIMove(`TURN ${y},${x}`);
}

async function rebuildAI(game) {
  if (game.mode !== GAME_MODE_PVE) {
    return;
  }
  game.transitioning = true;
  try {
    stopAI();
    await startAI(game.aiTimeLimit);
    sendBoardToAI(game.moveHistory);
  } finally {
    game.transitioning = false;
  }
}

async function startRound(game, switchSides = false) {
  if (switchSides) {
    game.playerColor = otherColor(game.playerColor);
  }

  if (game.mode === GAME_MODE_PVP) {
    resetRound(game);
    game.pendingColorSwap = false;
    return;
  }

  resetRound(game);
  game.pendingColorSwap = false;
  await rebuildAI(game);

  // When the player takes white, PentaZen opens with black just as it does in
  // the C++ version after colours are swapped.
  if (game.playerColor === WHITE) {
    game.aiBusy = true;
    try {
      const openingMove = await requestAIMove("BEGIN");
      game.board[openingMove.y][openingMove.x] = BLACK;
      game.moveHistory.push({ ...openingMove, player: BLACK, actor: "ai" });
    } finally {
      game.aiBusy = false;
    }
  }

  game.currentPlayer = game.playerColor;
}

async function startMatch(game, mode, difficulty) {
  if (![GAME_MODE_PVP, GAME_MODE_PVE].includes(mode)) {
    throw new Error("请选择单人或双人模式");
  }
  if (mode === GAME_MODE_PVE && !Object.hasOwn(DIFFICULTY_TIME_LIMITS, difficulty)) {
    throw new Error("请选择 AI 难度");
  }

  game.mode = mode;
  game.difficulty = mode === GAME_MODE_PVE ? difficulty : null;
  game.aiTimeLimit = mode === GAME_MODE_PVE ? DIFFICULTY_TIME_LIMITS[difficulty] : 0;
  game.playerColor = BLACK;
  game.scores = { player: 0, ai: 0 };
  game.pendingColorSwap = false;
  console.log(
    `[开始对局] mode=${game.mode}, difficulty=${game.difficulty || "无"}, aiTimeLimit=${game.aiTimeLimit}ms`,
  );
  await startRound(game);
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function serveStatic(req, res) {
  if (req.method !== "GET") {
    return false;
  }
  const requestPath = new URL(req.url, "http://localhost").pathname;
  const filePath = requestPath === "/"
    ? path.join(FRONTEND_PATH, "index.html")
    : requestPath.startsWith("/wasm/")
      ? path.join(ROOT_PATH, requestPath)
      : path.join(FRONTEND_PATH, requestPath);

  if (!filePath.startsWith(FRONTEND_PATH) && !filePath.startsWith(path.join(ROOT_PATH, "wasm"))) {
    return false;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".wasm": "application/wasm",
  };
  res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function handleMove(data) {
  const game = getGame(data.gameId);
  const x = Number(data.x);
  const y = Number(data.y);

  const expectedPlayer = game.mode === GAME_MODE_PVP ? game.currentPlayer : game.playerColor;
  if (Number(data.player) !== expectedPlayer || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("落子参数不正确");
  }
  if (game.gameOver) {
    throw new Error("本局已结束，请点击重新开始");
  }
  if (game.mode === GAME_MODE_PVE && (game.aiBusy || game.transitioning)) {
    throw new Error("AI 正在准备，请稍候");
  }
  if (!inBoard(x, y) || game.board[y][x] !== 0) {
    throw new Error("这个位置不能落子");
  }

  logMove("前端 → 后端落子", { x, y, player: expectedPlayer });

  game.board[y][x] = expectedPlayer;
  const actor = game.mode === GAME_MODE_PVP
    ? (expectedPlayer === game.playerColor ? "player1" : "player2")
    : "player";
  game.moveHistory.push({ x, y, player: expectedPlayer, actor });
  const playerMove = { x, y, player: expectedPlayer };

  if (isWin(game.board, x, y)) {
    const message = game.mode === GAME_MODE_PVP
      ? `${expectedPlayer === game.playerColor ? "玩家 1" : "玩家 2"}五子连珠，获胜！`
      : "五子连珠，你赢了！";
    finishRound(game, expectedPlayer, message);
    return { game, playerMove, aiMove: null };
  }
  if (isBoardFull(game.board)) {
    finishRound(game, null, "棋盘已满，本局平局。");
    return { game, playerMove, aiMove: null };
  }

  if (game.mode === GAME_MODE_PVP) {
    game.currentPlayer = otherColor(expectedPlayer);
    return { game, playerMove, aiMove: null };
  }

  game.aiBusy = true;
  try {
    const aiMove = await askAI(x, y);
    if (game.board[aiMove.y][aiMove.x] !== 0) {
      throw new Error("AI 返回的位置已经有棋子");
    }

    const aiColor = otherColor(game.playerColor);
    game.board[aiMove.y][aiMove.x] = aiColor;
    game.moveHistory.push({ ...aiMove, player: aiColor, actor: "ai" });
    logMove("后端 → 前端 AI 落子", { ...aiMove, player: aiColor });
    if (isWin(game.board, aiMove.x, aiMove.y)) {
      finishRound(game, aiColor, "AI 五子连珠，本局结束。");
    } else if (isBoardFull(game.board)) {
      finishRound(game, null, "棋盘已满，本局平局。");
    }
    game.aiBusy = false;
    return { game, playerMove, aiMove: { ...aiMove, player: aiColor } };
  } catch (error) {
    game.board[y][x] = 0;
    game.moveHistory.pop();
    game.aiBusy = false;
    try {
      await rebuildAI(game);
    } catch (restoreError) {
      console.error("恢复 AI 失败：", restoreError.message);
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  if (serveStatic(req, res)) {
    return;
  }

  setCORS(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, aiReady ? 200 : 503, {
        success: aiReady,
        status: aiReady ? "ok" : "starting",
        aiReady,
      });
      return;
    }
    if (req.method === "GET" && (url.pathname === "/state" || url.pathname === "/board")) {
      const game = getGame(url.searchParams.get("gameId"));
      sendJson(res, 200, { success: true, ...getState(game) });
      return;
    }
    if (req.method !== "POST") {
      sendError(res, 404, new Error("接口不存在"));
      return;
    }

    const data = await readJsonBody(req);
    if (url.pathname === "/start") {
      const game = getGame(data.gameId);
      if (game.aiBusy || game.transitioning) {
        throw new Error("AI 正在准备，请稍候");
      }
      await startMatch(game, data.mode, data.difficulty);
      const message = game.mode === GAME_MODE_PVP
        ? "双人模式开始，玩家 1 执黑棋先行。"
        : `单人模式开始：${game.difficulty === "easy" ? "简单" : game.difficulty === "normal" ? "普通" : "困难"}难度。`;
      sendJson(res, 200, { success: true, message, ...getState(game) });
      return;
    }

    if (url.pathname === "/move") {
      let game;
      try {
        const result = await handleMove(data);
        game = result.game;
        sendJson(res, 200, {
          success: true,
          playerMove: result.playerMove,
          aiMove: result.aiMove,
          message: game.reason || "轮到你落子。",
          ...getState(game),
        });
      } catch (error) {
        try {
          game = getGame(data.gameId);
        } catch {
          // No valid state can be returned for a malformed game id.
        }
        sendError(res, 400, error, game);
      }
      return;
    }

    const game = getGame(data.gameId);
    if (game.aiBusy || game.transitioning) {
      throw new Error("AI 正在准备，请稍候");
    }

    if (url.pathname === "/reset") {
      await startRound(game, true);
      const message = game.mode === GAME_MODE_PVP
        ? `已开始新的一局，${game.playerColor === BLACK ? "玩家 1" : "玩家 2"} 执黑棋先行。`
        : game.playerColor === BLACK
        ? "已开始新的一局。你执黑棋先行。"
        : "已开始新的一局。AI 已执黑棋先行，你执白棋。";
      sendJson(res, 200, { success: true, message, ...getState(game) });
      return;
    }

    if (url.pathname === "/undo") {
      const lastPlayerMove = game.mode === GAME_MODE_PVP
        ? game.moveHistory.length - 1
        : game.moveHistory.map((move) => move.actor).lastIndexOf("player");
      if (lastPlayerMove === -1) {
        throw new Error("还没有可以悔的棋");
      }
      if (game.roundResult?.scoreAwarded) {
        if (game.roundResult.winnerActor === "player" || game.roundResult.winnerActor === "player1") {
          game.scores.player = Math.max(0, game.scores.player - 1);
        } else if (game.roundResult.winnerActor === "ai" || game.roundResult.winnerActor === "player2") {
          game.scores.ai = Math.max(0, game.scores.ai - 1);
        }
      }

      const undoneMoves = game.moveHistory.splice(lastPlayerMove);
      for (const move of undoneMoves) {
        game.board[move.y][move.x] = 0;
      }
      game.currentPlayer = game.mode === GAME_MODE_PVP
        ? (undoneMoves[0]?.player || BLACK)
        : game.playerColor;
      game.gameOver = false;
      game.winner = null;
      game.reason = null;
      game.roundResult = null;
      game.pendingColorSwap = false;
      await rebuildAI(game);
      sendJson(res, 200, {
        success: true,
        message: game.mode === GAME_MODE_PVP
          ? "已悔掉最后一步。"
          : undoneMoves.length === 2 ? "已悔掉你和 AI 的上一回合。" : "已悔掉最后一步。",
        ...getState(game),
      });
      return;
    }

    if (url.pathname === "/surrender") {
      if (game.gameOver) {
        throw new Error("本局已经结束，请点击重新开始");
      }
      if (game.mode === GAME_MODE_PVP) {
        const winner = otherColor(game.currentPlayer);
        const winnerActor = winner === game.playerColor ? "玩家 1" : "玩家 2";
        if (winner === game.playerColor) {
          game.scores.player += 1;
        } else {
          game.scores.ai += 1;
        }
        await startRound(game);
        sendJson(res, 200, {
          success: true,
          surrendered: true,
          message: `${winnerActor}获胜并得 1 分；已开始新的一局。`,
          ...getState(game),
        });
        return;
      }

      game.scores.ai += 1;
      await startRound(game, true);
      const message = game.playerColor === BLACK
        ? "你已投降，AI 得 1 分；已开始新的一局，你执黑棋先行。"
        : "你已投降，AI 得 1 分；AI 已执黑棋先行，你执白棋。";
      sendJson(res, 200, {
        success: true,
        surrendered: true,
        message,
        ...getState(game),
      });
      return;
    }

    throw new Error("接口不存在");
  } catch (error) {
    sendError(res, 400, error);
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`五子棋网站已启动：http://${HOST}:${PORT}`);
  try {
    await startAI();
    console.log("PentaZen 已连接");
  } catch (error) {
    console.error("PentaZen 启动失败：", error.message);
  }
});

function shutdown() {
  stopAI();
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
