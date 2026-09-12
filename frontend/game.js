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

let onlineApiPromise;
const getOnlineApi = () => {
  onlineApiPromise ||= import("./supabase-client.js");
  return onlineApiPromise;
};

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
const pvpSection = document.getElementById("pvpSection");
const pvpTypeButtons = [...document.querySelectorAll("[data-pvp-type]")];
const joinRoomFields = document.getElementById("joinRoomFields");
const roomCodeInput = document.getElementById("roomCodeInput");
const onlineHint = document.getElementById("onlineHint");
const mainMenuButtons = [...document.querySelectorAll(".main-menu-button")];
const canvas = document.getElementById("gameBoard");
const ctx = canvas.getContext("2d");
const gameStatus = document.getElementById("gameStatus");
const onlineRoomInfo = document.getElementById("onlineRoomInfo");
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
const scoreNote = document.querySelector(".score-note");
const resultDialog = document.getElementById("resultDialog");
const dialogEyebrow = document.getElementById("dialogEyebrow");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
const accountButton = document.getElementById("accountButton");
const accountButtonText = document.getElementById("accountButtonText");
const authDialog = document.getElementById("authDialog");
const authForm = document.getElementById("authForm");
const authDialogTitle = document.getElementById("authDialogTitle");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const authError = document.getElementById("authError");
const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const logoutButton = document.getElementById("logoutButton");
const authCancelButton = document.getElementById("authCancelButton");
const historyButton = document.getElementById("historyButton");
const historyRecordText = document.getElementById("historyRecordText");
const historyDialog = document.getElementById("historyDialog");
const historySummary = document.getElementById("historySummary");
const historyList = document.getElementById("historyList");
const historyCloseButton = document.getElementById("historyCloseButton");
const replayDialog = document.getElementById("replayDialog");
const replayPlayers = document.getElementById("replayPlayers");
const replayCanvas = document.getElementById("replayBoard");
const replayCtx = replayCanvas.getContext("2d");
const replayStepText = document.getElementById("replayStepText");
const replayStartButton = document.getElementById("replayStartButton");
const replayPreviousButton = document.getElementById("replayPreviousButton");
const replayNextButton = document.getElementById("replayNextButton");
const replayEndButton = document.getElementById("replayEndButton");
const replayCloseButton = document.getElementById("replayCloseButton");

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
let selectedPvpType = "local";
let account = null;
let onlineRoomId = null;
let onlineRoomCode = null;
let unsubscribeOnlineRoom = null;
let refreshingOnlineRoom = false;
let gameHistory = [];
let replayMoves = [];
let replayStep = 0;
const pendingHistorySaves = new Map();
const savedHistoryIds = new Set();
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
  return !cppBoard
    || localBusy
    || state.aiBusy
    || state.transitioning
    || state.gameOver
    || (state.mode === "online" && state.currentPlayer !== state.playerColor);
}

function updateControls() {
  const locked = interactionLocked();
  canvas.classList.toggle("is-locked", locked);
  undoButton.disabled = state.mode === "online"
    || !cppBoard || localBusy || state.aiBusy || state.transitioning || state.moveCount === 0;
  surrenderButton.disabled = !cppBoard || localBusy || state.aiBusy || state.transitioning || state.gameOver;
  startButton.disabled = state.mode === "online"
    || !cppBoard || localBusy || state.aiBusy || state.transitioning;
}

function updateTurnFrame() {
  const turnColor = previewTurnColor ?? state.currentPlayer;
  const roundActive = !state.gameOver && (turnColor === BLACK || turnColor === WHITE);
  playerCard.classList.toggle("is-current", roundActive && turnColor === state.playerColor);
  aiCard.classList.toggle("is-current", roundActive && turnColor !== state.playerColor);
}

function updateStatus(message) {
  if (state.mode === "online") {
    if (localBusy) {
      gameStatus.textContent = "正在同步棋局…";
    } else if (state.onlineStatus === "waiting") {
      gameStatus.textContent = "等待另一位玩家输入房间号加入…";
    } else if (state.gameOver) {
      gameStatus.textContent = state.reason || "本局已经结束。";
    } else if (state.currentPlayer === state.playerColor) {
      gameStatus.textContent = message || "轮到你落子。";
    } else {
      gameStatus.textContent = message || `等待${state.opponentName || "对手"}落子…`;
    }
  } else if (state.mode === "pvp") {
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
  if (state.mode === "online") {
    playerLabel.textContent = `${state.playerName || "你"} · ${playerIsBlack ? "黑棋" : "白棋"}`;
    aiLabel.textContent = `${state.opponentName || "等待对手"} · ${playerIsBlack ? "白棋" : "黑棋"}`;
  } else {
    playerLabel.textContent = state.mode === "pvp"
      ? `玩家 1 · ${playerIsBlack ? "黑棋" : "白棋"}`
      : `你 · ${playerIsBlack ? "黑棋" : "白棋"}`;
    aiLabel.textContent = state.mode === "pvp"
      ? `玩家 2 · ${playerIsBlack ? "白棋" : "黑棋"}`
      : `AI · ${playerIsBlack ? "白棋" : "黑棋"}`;
  }
  onlineRoomInfo.hidden = state.mode !== "online";
  onlineRoomInfo.textContent = state.mode === "online" ? `房间号：${onlineRoomCode}` : "";
  scoreNote.textContent = state.mode === "online"
    ? "在线对战暂不支持悔棋和重新开始；投降后本局结束。"
    : "重新开始会清空棋盘，保留本次对局的比分。";
  updateStatus(message || data.message);
  updateControls();
  updateHistoricalRecord();

  if (data.completedGame) saveCompletedGame(data.completedGame);
  if (data.retractedRecordId) retractCompletedGame(data.retractedRecordId);
  if (state.mode === "online" && state.gameOver && !wasOver) {
    loadHistoryAndUpdate().catch((error) => console.error("Online history refresh failed", error));
  }

  if (state.gameOver && !wasOver) {
    const title = state.draw
      ? "本局平局"
      : state.mode === "pvp"
        ? `${state.winner === state.playerColor ? "玩家 1" : "玩家 2"} 获胜`
        : state.mode === "online"
          ? state.winner === state.playerColor ? "你赢了" : `${state.opponentName || "对手"}获胜`
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

function setAccount(nextAccount) {
  account = nextAccount;
  accountButtonText.textContent = account ? account.username : "登录";
  onlineHint.textContent = account
    ? `当前账号：${account.username}`
    : "开始任何对局前都需要登录";
  if (!account) {
    gameHistory = [];
    historyRecordText.textContent = "登录后记录战绩";
  }
}

function setAuthDialogMode() {
  const credentialControls = [
    usernameInput,
    passwordInput,
    loginButton,
    registerButton,
    ...authForm.querySelectorAll("label"),
  ];
  for (const control of credentialControls) control.hidden = Boolean(account);
  logoutButton.hidden = !account;
  historyButton.hidden = !account;
  authDialogTitle.textContent = account ? `已登录：${account.username}` : "账号登录";
  authError.textContent = "";
}

function openAuthDialog() {
  setAuthDialogMode();
  if (!authDialog.open) authDialog.showModal();
  if (!account) usernameInput.focus();
}

async function runAuthAction(action) {
  authError.textContent = "正在连接…";
  loginButton.disabled = true;
  registerButton.disabled = true;
  try {
    const api = await getOnlineApi();
    const nextAccount = await action(api, usernameInput.value, passwordInput.value);
    setAccount(nextAccount);
    await loadHistoryAndUpdate();
    passwordInput.value = "";
    authDialog.close();
    setupHint.textContent = "登录成功，可以创建或加入在线房间。";
  } catch (error) {
    authError.textContent = error.message || "登录失败，请重试";
  } finally {
    loginButton.disabled = false;
    registerButton.disabled = false;
  }
}

accountButton.addEventListener("click", openAuthDialog);
authCancelButton.addEventListener("click", () => authDialog.close());
authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runAuthAction((api, username, password) => api.signInWithUsername(username, password));
});
registerButton.addEventListener("click", () => {
  runAuthAction((api, username, password) => api.signUpWithUsername(username, password));
});
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const api = await getOnlineApi();
    await api.signOutAccount();
    setAccount(null);
    authDialog.close();
    if (historyDialog.open) historyDialog.close();
    if (replayDialog.open) replayDialog.close();
    if (state.mode === "online") returnToMainMenu();
  } catch (error) {
    authError.textContent = error.message || "退出失败，请重试";
  } finally {
    logoutButton.disabled = false;
  }
});

async function restoreAccount() {
  try {
    const api = await getOnlineApi();
    setAccount(await api.getCurrentAccount());
    if (account) await loadHistoryAndUpdate();
  } catch (error) {
    console.warn("Supabase account restore failed", error);
  }
}

function myColorForRecord(record) {
  if (record.game_type !== "online") return record.owner_color;
  return record.black_user_id === account?.id ? BLACK : WHITE;
}

function opponentForRecord(record) {
  const myColor = myColorForRecord(record);
  return {
    name: myColor === BLACK ? record.white_name : record.black_name,
    id: record.game_type === "online"
      ? (myColor === BLACK ? record.white_user_id : record.black_user_id)
      : record.game_type,
  };
}

function outcomeForRecord(record) {
  if (record.winner_color === null) return "平局";
  return record.winner_color === myColorForRecord(record) ? "胜利" : "失败";
}

function recordsForCurrentOpponent() {
  if (state.mode === "pve") return gameHistory.filter((record) => record.game_type === "ai");
  if (state.mode === "pvp") return gameHistory.filter((record) => record.game_type === "local");
  if (state.mode === "online" && state.opponentId) {
    return gameHistory.filter((record) => record.game_type === "online"
      && (record.black_user_id === state.opponentId || record.white_user_id === state.opponentId));
  }
  return [];
}

function updateHistoricalRecord() {
  const records = recordsForCurrentOpponent();
  if (!account) {
    historyRecordText.textContent = "登录后记录战绩";
    return;
  }
  if (!records.length) {
    historyRecordText.textContent = state.mode === "online" && !state.opponentId ? "等待对手加入" : "尚无交手记录";
    return;
  }
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const record of records) {
    const outcome = outcomeForRecord(record);
    if (outcome === "胜利") wins += 1;
    else if (outcome === "失败") losses += 1;
    else draws += 1;
  }
  const opponentName = opponentForRecord(records[0]).name;
  historyRecordText.textContent = `${account.username} ${wins}胜 : ${opponentName} ${losses}胜${draws ? ` · ${draws}平` : ""}`;
}

async function loadHistoryAndUpdate() {
  if (!account) return [];
  const api = await getOnlineApi();
  gameHistory = await api.loadGameHistory();
  updateHistoricalRecord();
  return gameHistory;
}

async function saveCompletedGame(completedGame) {
  if (!completedGame || !account || savedHistoryIds.has(completedGame.clientGameId)) return;
  if (pendingHistorySaves.has(completedGame.clientGameId)) {
    return pendingHistorySaves.get(completedGame.clientGameId);
  }
  const savePromise = (async () => {
    const api = await getOnlineApi();
    await api.saveLocalGame(completedGame);
    savedHistoryIds.add(completedGame.clientGameId);
    await loadHistoryAndUpdate();
  })();
  pendingHistorySaves.set(completedGame.clientGameId, savePromise);
  try {
    await savePromise;
  } catch (error) {
    console.error("Game history save failed", error);
    showDialog("保存失败", "棋局未能保存", error.message || "请检查网络后重试。");
  } finally {
    pendingHistorySaves.delete(completedGame.clientGameId);
  }
}

async function retractCompletedGame(clientGameId) {
  if (!clientGameId || !account) return;
  try {
    if (pendingHistorySaves.has(clientGameId)) {
      await pendingHistorySaves.get(clientGameId).catch(() => {});
    }
    const api = await getOnlineApi();
    await api.deleteLocalGame(clientGameId);
    savedHistoryIds.delete(clientGameId);
    await loadHistoryAndUpdate();
  } catch (error) {
    console.error("Game history retraction failed", error);
  }
}

function historyDescription(record) {
  if (record.game_type === "online") return "在线双人";
  if (record.game_type === "local") return "同屏双人";
  const difficulty = record.difficulty === "easy" ? "简单" : record.difficulty === "hard" ? "困难" : "普通";
  return `PentaZen AI · ${difficulty}`;
}

function renderHistoryList() {
  historyList.replaceChildren();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const record of gameHistory) {
    const outcome = outcomeForRecord(record);
    if (outcome === "胜利") wins += 1;
    else if (outcome === "失败") losses += 1;
    else draws += 1;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    const main = document.createElement("span");
    main.className = "history-item-main";
    const players = document.createElement("strong");
    players.textContent = `${record.black_name}（黑） vs ${record.white_name}（白）`;
    const type = document.createElement("span");
    type.textContent = `${historyDescription(record)} · 点击复盘`;
    main.append(players, type);
    const result = document.createElement("span");
    result.className = outcome === "胜利" ? "history-result-win" : outcome === "失败" ? "history-result-loss" : "";
    const time = document.createElement("time");
    time.dateTime = record.created_at;
    time.textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(record.created_at));
    result.append(`${outcome} · `, time);
    button.append(main, result);
    button.addEventListener("click", () => openReplay(record));
    historyList.append(button);
  }
  historySummary.textContent = `总计 ${gameHistory.length} 局：${wins} 胜、${losses} 负、${draws} 平`;
  if (!gameHistory.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "还没有已完成的棋局。";
    historyList.append(empty);
  }
}

async function openHistoryDialog() {
  authDialog.close();
  historySummary.textContent = "正在读取…";
  historyList.replaceChildren();
  if (!historyDialog.open) historyDialog.showModal();
  try {
    await loadHistoryAndUpdate();
    renderHistoryList();
  } catch (error) {
    historySummary.textContent = error.message || "历史棋局读取失败";
  }
}

function drawReplay() {
  replayCtx.clearRect(0, 0, replayCanvas.width, replayCanvas.height);
  if (boardImage.complete && boardImage.naturalWidth > 0) {
    replayCtx.drawImage(boardImage, 0, 0, replayCanvas.width, replayCanvas.height);
  }
  for (const move of replayMoves.slice(0, replayStep)) {
    const image = move.player === BLACK ? blackImage : whiteImage;
    const canvasX = BOARD_ORIGIN_X + move.x * CELL_SIZE;
    const canvasY = BOARD_ORIGIN_Y + move.y * CELL_SIZE;
    replayCtx.drawImage(
      image,
      canvasX - STONE_SIZE / 2,
      canvasY - STONE_SIZE / 2,
      STONE_SIZE,
      STONE_SIZE,
    );
  }
  replayStepText.textContent = `${replayStep} / ${replayMoves.length}`;
  replayStartButton.disabled = replayStep === 0;
  replayPreviousButton.disabled = replayStep === 0;
  replayNextButton.disabled = replayStep === replayMoves.length;
  replayEndButton.disabled = replayStep === replayMoves.length;
}

async function openReplay(record) {
  try {
    const api = await getOnlineApi();
    replayMoves = await api.loadReplayMoves(record.id);
    replayStep = 0;
    replayPlayers.textContent = `${record.black_name}（黑棋） vs ${record.white_name}（白棋） · ${outcomeForRecord(record)}`;
    historyDialog.close();
    if (!replayDialog.open) replayDialog.showModal();
    drawReplay();
  } catch (error) {
    historySummary.textContent = error.message || "复盘加载失败";
  }
}

historyButton.addEventListener("click", openHistoryDialog);
historyCloseButton.addEventListener("click", () => historyDialog.close());
replayCloseButton.addEventListener("click", () => replayDialog.close());
replayStartButton.addEventListener("click", () => { replayStep = 0; drawReplay(); });
replayPreviousButton.addEventListener("click", () => { replayStep = Math.max(0, replayStep - 1); drawReplay(); });
replayNextButton.addEventListener("click", () => { replayStep = Math.min(replayMoves.length, replayStep + 1); drawReplay(); });
replayEndButton.addEventListener("click", () => { replayStep = replayMoves.length; drawReplay(); });

function onlineReason(room, profilesById) {
  if (room.status === "waiting") return "房间已创建，正在等待对手。";
  if (room.status !== "finished") return null;
  if (room.finish_reason === "draw") return "棋盘已满，本局平局。";
  const winnerName = profilesById.get(room.winner_id) || "获胜者";
  return room.finish_reason === "surrender"
    ? `对方投降，${winnerName}获胜。`
    : `${winnerName}五子连珠，获得胜利！`;
}

async function refreshOnlineRoom() {
  if (!onlineRoomId || refreshingOnlineRoom) return;
  refreshingOnlineRoom = true;
  try {
    const api = await getOnlineApi();
    const { room, moves, profiles } = await api.loadOnlineRoom(onlineRoomId);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile.username]));
    const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
    for (const move of moves) board[move.y][move.x] = move.player;
    const playerColor = room.black_user_id === account.id ? BLACK : WHITE;
    const opponentId = playerColor === BLACK ? room.white_user_id : room.black_user_id;
    updateState({
      board,
      mode: "online",
      onlineStatus: room.status,
      gameOver: room.status === "finished",
      aiBusy: false,
      transitioning: room.status === "waiting",
      playerColor,
      currentPlayer: room.status === "playing" ? room.current_player : null,
      moveCount: moves.length,
      winner: room.winner_id
        ? (room.winner_id === room.black_user_id ? BLACK : WHITE)
        : null,
      draw: room.finish_reason === "draw",
      reason: onlineReason(room, profilesById),
      playerName: account.username,
      opponentName: opponentId ? profilesById.get(opponentId) : "等待对手",
      opponentId,
      scores: {
        player: room.status === "finished" && room.winner_id === account.id ? 1 : 0,
        ai: room.status === "finished" && room.winner_id === opponentId ? 1 : 0,
      },
    });
  } catch (error) {
    updateStatus(error.message || "房间同步失败，请刷新页面重试。");
  } finally {
    refreshingOnlineRoom = false;
  }
}

async function enterOnlineRoom(room) {
  await initialiseBoard();
  onlineRoomId = room.id;
  onlineRoomCode = room.code;
  if (unsubscribeOnlineRoom) await unsubscribeOnlineRoom();
  const api = await getOnlineApi();
  unsubscribeOnlineRoom = await api.subscribeToOnlineRoom(onlineRoomId, refreshOnlineRoom);
  setupScreen.hidden = true;
  gameSelectScreen.hidden = true;
  gameScreen.hidden = false;
  await refreshOnlineRoom();
  canvas.focus();
}

async function startOnlineRoom() {
  if (!account) {
    openAuthDialog();
    throw new Error("请先登录，再开始在线对战");
  }
  const api = await getOnlineApi();
  if (selectedPvpType === "create") {
    await enterOnlineRoom(await api.createOnlineRoom());
    return;
  }
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) {
    throw new Error("请输入正确的 6 位房间号");
  }
  await enterOnlineRoom(await api.joinOnlineRoom(code));
}

const accountReady = restoreAccount();

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
    if (state.mode === "online") {
      const api = await getOnlineApi();
      await api.playOnlineMove(onlineRoomCode, x, y);
      await refreshOnlineRoom();
    } else {
      const data = await request("/move", { x, y, player: movingPlayer });
      previewTurnColor = null;
      updateState(data, data.message);
    }
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
  if (state.mode === "online" || localBusy || state.aiBusy || state.transitioning) {
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
  if (state.mode === "online" || undoButton.disabled) {
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
  const prompt = state.mode === "online"
    ? "确定投降吗？本局将立即结束。"
    : state.mode === "pvp"
    ? `确定 ${state.currentPlayer === state.playerColor ? "玩家 1" : "玩家 2"} 认输吗？对方将获得 1 分，并开始新的一局。`
    : "确定投降吗？AI 将获得 1 分，并开始新的一局。";
  if (surrenderButton.disabled || !window.confirm(prompt)) {
    return;
  }
  localBusy = true;
  updateStatus();
  updateControls();
  try {
    if (state.mode === "online") {
      const api = await getOnlineApi();
      await api.surrenderOnlineRoom(onlineRoomCode);
      await refreshOnlineRoom();
    } else {
      const data = await request("/surrender", {});
      updateState(data, data.message);
      showDialog("本局结果", state.mode === "pvp" ? "本局认输" : "你已投降", data.message);
    }
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
  if (unsubscribeOnlineRoom) {
    unsubscribeOnlineRoom();
    unsubscribeOnlineRoom = null;
  }
  onlineRoomId = null;
  onlineRoomCode = null;
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
  pvpSection.hidden = isPve;
  startGameButton.disabled = false;
  setupHint.textContent = isPve
    ? "请选择 AI 难度；开始对局前需要登录"
    : selectedPvpType === "local" ? "同屏双人：登录后由玩家 1 执黑棋先行" : "选择创建或加入在线房间";
}

function selectPvpType(type) {
  selectedPvpType = type;
  for (const button of pvpTypeButtons) {
    const selected = button.dataset.pvpType === type;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  joinRoomFields.hidden = type !== "join";
  onlineHint.textContent = type === "local"
    ? account ? `棋局将保存到：${account.username}` : "同屏双人也需要登录，以便保存棋局"
    : account ? `当前账号：${account.username}` : "在线对战需要先登录";
  setupHint.textContent = type === "local"
    ? "同屏双人：登录后由玩家 1 执黑棋先行"
    : type === "create" ? "开始后会生成 6 位房间号" : "输入朋友发来的房间号后开始";
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
pvpTypeButtons.forEach((button) => {
  button.addEventListener("click", () => selectPvpType(button.dataset.pvpType));
});
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^0-9A-F]/g, "");
});
difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => selectDifficulty(button.dataset.difficulty));
});
selectDifficulty(selectedDifficulty);

startGameButton.addEventListener("click", async () => {
  if (!selectedMode || localBusy) {
    return;
  }

  await accountReady;
  if (!account) {
    setupHint.textContent = "请先登录，棋局才能开始并保存。";
    openAuthDialog();
    return;
  }

  localBusy = true;
  const pendingNavigationVersion = navigationVersion;
  startGameButton.disabled = true;
  setupHint.textContent = "正在准备棋局…";
  try {
    if (selectedMode === "pvp" && selectedPvpType !== "local") {
      await startOnlineRoom();
      return;
    }
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
