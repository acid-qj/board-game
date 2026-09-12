import createGomokuModule from "../wasm/gomoku.js";
import { localRequest } from "./local-game.js";

const BOARD_SIZE = 15;
const BOARD_ORIGIN_X = 19;
const BOARD_ORIGIN_Y = 18;
const CELL_SIZE = 45;
const STONE_SIZE = 40;
const BLACK = 1;
const WHITE = 2;
const EMPTY = 0;
const GAME_ID_KEY = "gomoku-game-id";

// 坐标约定：棋盘左上角交叉点为 (0,0)，向右 x 增大，向下 y 增大。
// 与后端通信统一使用 { x, y, player }；棋盘二维数组使用 board[y][x]。
const gameId = sessionStorage.getItem(GAME_ID_KEY)
  || globalThis.crypto?.randomUUID?.()
  || `gomoku-${Date.now()}`;
sessionStorage.setItem(GAME_ID_KEY, gameId);

const startScreen = document.getElementById("startScreen");
const gameSelectScreen = document.getElementById("gameSelectScreen");
const setupScreen = document.getElementById("setupScreen");
const gameScreen = document.getElementById("gameScreen");
const enterGameButton = document.getElementById("enterGameButton");
const curtainAnimation = document.getElementById("curtainAnimation");
const gomokuGameButton = document.getElementById("gomokuGameButton");
const pvpModeButton = document.getElementById("pvpModeButton");
const pveModeButton = document.getElementById("pveModeButton");
const difficultySection = document.getElementById("difficultySection");
const difficultyButtons = [...document.querySelectorAll(".difficulty-choice")];
const difficultyHint = document.getElementById("difficultyHint");
const startGameButton = document.getElementById("startGameButton");
const setupHint = document.getElementById("setupHint");
const mainMenuButtons = [...document.querySelectorAll(".main-menu-button")];
const canvas = document.getElementById("gameBoard");
const ctx = canvas.getContext("2d");
const gameStatus = document.getElementById("gameStatus");
const playerCard = document.getElementById("playerCard");
const aiCard = document.getElementById("aiCard");
const playerScore = document.getElementById("playerScore");
const aiScore = document.getElementById("aiScore");
const playerBottle = document.getElementById("playerBottle");
const aiBottle = document.getElementById("aiBottle");
const playerLabel = document.getElementById("playerLabel");
const aiLabel = document.getElementById("aiLabel");
const undoButton = document.getElementById("undoButton");
const surrenderButton = document.getElementById("surrenderButton");
const startButton = document.getElementById("startButton");
const resultDialog = document.getElementById("resultDialog");
const dialogEyebrow = document.getElementById("dialogEyebrow");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");

const boardImage = new Image();
const blackImage = new Image();
const whiteImage = new Image();
boardImage.src = "assets/board.png";
blackImage.src = "assets/black.png";
whiteImage.src = "assets/white.png";

let Module;
let cppBoard;
let localBusy = false;
let previewTurnColor = null;
let hasEnteredGame = false;
let navigationVersion = 0;
let selectedMode = null;
let selectedDifficulty = "normal";
let state = {
  board: null,
  mode: "pve",
  gameOver: false,
  aiBusy: false,
  transitioning: false,
  playerColor: BLACK,
  currentPlayer: BLACK,
  moveCount: 0,
  scores: { player: 0, ai: 0 },
};

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (boardImage.complete && boardImage.naturalWidth > 0) {
    ctx.drawImage(boardImage, 0, 0, canvas.width, canvas.height);
  }
}

function drawStone(x, y, player) {
  const image = player === BLACK ? blackImage : whiteImage;
  const canvasX = BOARD_ORIGIN_X + x * CELL_SIZE;
  const canvasY = BOARD_ORIGIN_Y + y * CELL_SIZE;
  ctx.drawImage(
    image,
    canvasX - STONE_SIZE / 2,
    canvasY - STONE_SIZE / 2,
    STONE_SIZE,
    STONE_SIZE,
  );
}

function drawGame() {
  drawBoard();
  if (!cppBoard) {
    return;
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const player = cppBoard.get(x, y);
      if (player !== EMPTY) {
        drawStone(x, y, player);
      }
    }
  }
}

function syncBoard(serverBoard) {
  if (!cppBoard || !serverBoard) {
    return;
  }

  cppBoard.reset();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (serverBoard[y][x] !== EMPTY) {
        cppBoard.placeStone(x, y, serverBoard[y][x]);
      }
    }
  }
  drawGame();
}

function interactionLocked() {
  return !cppBoard || localBusy || state.aiBusy || state.transitioning || state.gameOver;
}

function updateControls() {
  const locked = interactionLocked();
  canvas.classList.toggle("is-locked", locked);
  undoButton.disabled = !cppBoard || localBusy || state.aiBusy || state.transitioning || state.moveCount === 0;
  surrenderButton.disabled = !cppBoard || localBusy || state.aiBusy || state.transitioning || state.gameOver;
  startButton.disabled = !cppBoard || localBusy || state.aiBusy || state.transitioning;
}

function updateTurnFrame() {
  const turnColor = previewTurnColor ?? state.currentPlayer;
  const roundActive = !state.gameOver && (turnColor === BLACK || turnColor === WHITE);
  playerCard.classList.toggle("is-current", roundActive && turnColor === state.playerColor);
  aiCard.classList.toggle("is-current", roundActive && turnColor !== state.playerColor);
}

function updateStatus(message) {
  if (state.mode === "pvp") {
    if (localBusy) {
      gameStatus.textContent = "正在切换回合…";
    } else if (state.gameOver) {
      gameStatus.textContent = state.reason || "本局已结束，请重新开始。";
    } else {
      const currentName = state.currentPlayer === state.playerColor ? "玩家 1" : "玩家 2";
      const currentColor = state.currentPlayer === BLACK ? "黑棋" : "白棋";
      gameStatus.textContent = message || `轮到${currentName}（${currentColor}）落子。`;
    }
  } else if (localBusy || state.aiBusy || state.transitioning) {
    gameStatus.textContent = "AI 正在思考，请稍候…";
  } else if (state.gameOver) {
    gameStatus.textContent = state.reason || "本局已结束，请重新开始。";
  } else {
    const color = state.playerColor === BLACK ? "黑棋" : "白棋";
    gameStatus.textContent = message || `轮到你落子。你执${color}。`;
  }
  updateTurnFrame();
}

function updateState(data, message) {
  const wasOver = state.gameOver;
  state = { ...state, ...data, scores: data.scores || state.scores };
  syncBoard(data.board);
  playerScore.textContent = state.scores.player;
  aiScore.textContent = state.scores.ai;
  const playerIsBlack = state.playerColor === BLACK;
  playerBottle.src = playerIsBlack ? "assets/black_bottle.png" : "assets/white_bottle.png";
  playerBottle.alt = playerIsBlack ? "黑棋棋罐" : "白棋棋罐";
  aiBottle.src = playerIsBlack ? "assets/white_bottle.png" : "assets/black_bottle.png";
  aiBottle.alt = playerIsBlack ? "白棋棋罐" : "黑棋棋罐";
  playerLabel.textContent = state.mode === "pvp"
    ? `玩家 1 · ${playerIsBlack ? "黑棋" : "白棋"}`
    : `你 · ${playerIsBlack ? "黑棋" : "白棋"}`;
  aiLabel.textContent = state.mode === "pvp"
    ? `玩家 2 · ${playerIsBlack ? "白棋" : "黑棋"}`
    : `AI · ${playerIsBlack ? "白棋" : "黑棋"}`;
  updateStatus(message || data.message);
  updateControls();

  if (state.gameOver && !wasOver) {
    const title = state.draw
      ? "本局平局"
      : state.mode === "pvp"
        ? `${state.winner === state.playerColor ? "玩家 1" : "玩家 2"} 获胜`
        : state.winner === state.playerColor ? "你赢了" : "AI 获胜";
    showDialog("本局结果", title, state.reason || "本局结束，比分已更新。");
  }
}

function showDialog(eyebrow, title, message) {
  dialogEyebrow.textContent = eyebrow;
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  if (!resultDialog.open) {
    resultDialog.showModal();
  }
}

async function request(endpoint, body) {
  return localRequest(endpoint, { gameId, ...body });
}

function getBoardPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: Math.round((x - BOARD_ORIGIN_X) / CELL_SIZE),
    y: Math.round((y - BOARD_ORIGIN_Y) / CELL_SIZE),
  };
}

function showError(error) {
  if (error.data?.board) {
    updateState(error.data);
  }
  updateStatus(error.message || "操作没有完成。请重试。");
  showDialog("操作未完成", "请再试一次", error.message || "无法连接游戏服务器。");
}

canvas.addEventListener("click", async (event) => {
  if (interactionLocked()) {
    return;
  }

  const { x, y } = getBoardPosition(event);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
    return;
  }
  const movingPlayer = state.mode === "pvp" ? state.currentPlayer : state.playerColor;
  if (!cppBoard.placeStone(x, y, movingPlayer)) {
    return;
  }

  // Draw immediately, but the backend remains the source of truth. In
  // particular, a winning move must reach it so it can award the score.
  drawGame();
  if (state.mode === "pve") {
    previewTurnColor = state.playerColor === BLACK ? WHITE : BLACK;
  }
  localBusy = true;
  updateStatus();
  updateControls();

  try {
    const data = await request("/move", { x, y, player: movingPlayer });
    previewTurnColor = null;
    updateState(data, data.message);
  } catch (error) {
    previewTurnColor = null;
    showError(error);
  } finally {
    previewTurnColor = null;
    localBusy = false;
    updateStatus();
    updateControls();
  }
});

startButton.addEventListener("click", async () => {
  if (localBusy || state.aiBusy || state.transitioning) {
    return;
  }
  localBusy = true;
  updateStatus();
  updateControls();
  try {
    const data = await request("/reset", {});
    updateState(data, data.message);
  } catch (error) {
    showError(error);
  } finally {
    localBusy = false;
    updateStatus();
    updateControls();
  }
});

undoButton.addEventListener("click", async () => {
  if (undoButton.disabled) {
    return;
  }
  localBusy = true;
  updateStatus();
  updateControls();
  try {
    const data = await request("/undo", {});
    updateState(data, data.message);
  } catch (error) {
    showError(error);
  } finally {
    localBusy = false;
    updateStatus();
    updateControls();
  }
});

surrenderButton.addEventListener("click", async () => {
  const prompt = state.mode === "pvp"
    ? `确定 ${state.currentPlayer === state.playerColor ? "玩家 1" : "玩家 2"} 认输吗？对方将获得 1 分，并开始新的一局。`
    : "确定投降吗？AI 将获得 1 分，并开始新的一局。";
  if (surrenderButton.disabled || !window.confirm(prompt)) {
    return;
  }
  localBusy = true;
  updateStatus();
  updateControls();
  try {
    const data = await request("/surrender", {});
    updateState(data, data.message);
    showDialog("本局结果", state.mode === "pvp" ? "本局认输" : "你已投降", data.message);
  } catch (error) {
    showError(error);
  } finally {
    localBusy = false;
    updateStatus();
    updateControls();
  }
});

document.getElementById("dialogCloseButton").addEventListener("click", () => resultDialog.close());

enterGameButton.addEventListener("click", () => {
  if (hasEnteredGame) {
    return;
  }

  hasEnteredGame = true;
  enterGameButton.disabled = true;
  startScreen.hidden = true;
  gameSelectScreen.hidden = false;

  // Assign the source only when this screen becomes visible, otherwise the
  // animated image may finish playing while its parent is still hidden.
  curtainAnimation.src = "assets/bamboo-curtain-unroll.webp?v=2";
  window.setTimeout(() => {
    gomokuGameButton.disabled = false;
    gomokuGameButton.classList.add("is-ready");
    gomokuGameButton.focus();
  }, 1900);
});

gomokuGameButton.addEventListener("click", () => {
  gomokuGameButton.disabled = true;
  gomokuGameButton.classList.add("is-inactive");
  setupScreen.hidden = false;
  pvpModeButton.focus();
});

function returnToMainMenu() {
  navigationVersion += 1;
  if (resultDialog.open) {
    resultDialog.close();
  }
  startScreen.hidden = true;
  setupScreen.hidden = true;
  gameScreen.hidden = true;
  gameSelectScreen.hidden = false;
  gomokuGameButton.disabled = false;
  gomokuGameButton.classList.remove("is-inactive");
  gomokuGameButton.classList.add("is-ready");
  gomokuGameButton.focus();
}

mainMenuButtons.forEach((button) => {
  button.addEventListener("click", returnToMainMenu);
});

function selectMode(mode) {
  selectedMode = mode;
  const isPve = mode === "pve";
  pvpModeButton.classList.toggle("is-selected", !isPve);
  pveModeButton.classList.toggle("is-selected", isPve);
  pvpModeButton.setAttribute("aria-pressed", String(!isPve));
  pveModeButton.setAttribute("aria-pressed", String(isPve));
  difficultySection.hidden = !isPve;
  startGameButton.disabled = false;
  setupHint.textContent = isPve ? "请选择 AI 难度后开始游戏" : "双人模式：玩家 1 执黑棋先行";
}

function selectDifficulty(difficulty) {
  selectedDifficulty = difficulty;
  for (const button of difficultyButtons) {
    const selected = button.dataset.difficulty === difficulty;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  const label = difficulty === "easy" ? "简单" : difficulty === "normal" ? "普通" : "困难";
  const limit = difficulty === "easy" ? 10 : difficulty === "normal" ? 50 : 100;
  difficultyHint.textContent = `${label}：AI 思考 ${limit} 毫秒`;
}

pvpModeButton.addEventListener("click", () => selectMode("pvp"));
pveModeButton.addEventListener("click", () => selectMode("pve"));
difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => selectDifficulty(button.dataset.difficulty));
});
selectDifficulty(selectedDifficulty);

startGameButton.addEventListener("click", async () => {
  if (!selectedMode || localBusy) {
    return;
  }

  localBusy = true;
  const pendingNavigationVersion = navigationVersion;
  startGameButton.disabled = true;
  setupHint.textContent = "正在准备棋局…";
  try {
    await initialiseBoard();
    const data = await request("/start", {
      mode: selectedMode,
      difficulty: selectedMode === "pve" ? selectedDifficulty : undefined,
    });
    if (pendingNavigationVersion !== navigationVersion) {
      return;
    }
    setupScreen.hidden = true;
    gameSelectScreen.hidden = true;
    gameScreen.hidden = false;
    updateState(data, data.message);
    canvas.focus();
  } catch (error) {
    if (pendingNavigationVersion === navigationVersion) {
      setupHint.textContent = error.message || "无法开始游戏，请重试。";
    }
  } finally {
    localBusy = false;
    startGameButton.disabled = !selectedMode;
    if (!gameScreen.hidden) {
      updateStatus();
      updateControls();
    }
  }
});

async function initialiseBoard() {
  if (cppBoard) {
    return;
  }

  try {
    [Module] = await Promise.all([
      createGomokuModule(),
      new Promise((resolve) => {
        if (boardImage.complete) {
          resolve();
        } else {
          boardImage.addEventListener("load", resolve, { once: true });
        }
      }),
    ]);
    cppBoard = new Module.GomokuBoard();
  } catch (error) {
    throw new Error(error.message || "棋盘加载失败");
  }
}
