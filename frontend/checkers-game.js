const SIZE = 10;
const EMPTY = 0;
const BLACK_MAN = 1;
const WHITE_MAN = 2;
const BLACK_KING = 3;
const WHITE_KING = 4;
const BLACK = 1;
const WHITE = 2;
const DIAGONALS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function colorOf(piece) {
  if (piece === BLACK_MAN || piece === BLACK_KING) return BLACK;
  if (piece === WHITE_MAN || piece === WHITE_KING) return WHITE;
  return null;
}

function isKing(piece) {
  return piece === BLACK_KING || piece === WHITE_KING;
}

function otherColor(color) {
  return color === BLACK ? WHITE : BLACK;
}

function inside(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function createInitialBoard() {
  return Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
    if ((x + y) % 2 === 0) return EMPTY;
    if (y < 4) return WHITE_MAN;
    if (y > 5) return BLACK_MAN;
    return EMPTY;
  }));
}

function manCaptureOptions(board, x, y, piece, captured) {
  const result = [];
  for (const [dx, dy] of DIAGONALS) {
    const captureX = x + dx;
    const captureY = y + dy;
    const landingX = x + dx * 2;
    const landingY = y + dy * 2;
    if (!inside(landingX, landingY)) continue;
    const target = board[captureY][captureX];
    if (
      target !== EMPTY
      && colorOf(target) !== colorOf(piece)
      && !captured.has(keyOf(captureX, captureY))
      && board[landingY][landingX] === EMPTY
    ) {
      result.push({ x: landingX, y: landingY, captureX, captureY });
    }
  }
  return result;
}

function kingCaptureOptions(board, x, y, piece, captured) {
  const result = [];
  for (const [dx, dy] of DIAGONALS) {
    let scanX = x + dx;
    let scanY = y + dy;
    while (inside(scanX, scanY) && board[scanY][scanX] === EMPTY) {
      scanX += dx;
      scanY += dy;
    }
    if (!inside(scanX, scanY)) continue;
    const target = board[scanY][scanX];
    if (
      colorOf(target) === colorOf(piece)
      || captured.has(keyOf(scanX, scanY))
    ) continue;

    const captureX = scanX;
    const captureY = scanY;
    scanX += dx;
    scanY += dy;
    while (inside(scanX, scanY) && board[scanY][scanX] === EMPTY) {
      result.push({ x: scanX, y: scanY, captureX, captureY });
      scanX += dx;
      scanY += dy;
    }
  }
  return result;
}

function captureSequences(board, x, y, piece, captured = new Set()) {
  const options = isKing(piece)
    ? kingCaptureOptions(board, x, y, piece, captured)
    : manCaptureOptions(board, x, y, piece, captured);
  if (!options.length) return [[]];

  const sequences = [];
  for (const option of options) {
    const nextBoard = cloneBoard(board);
    nextBoard[y][x] = EMPTY;
    nextBoard[option.y][option.x] = piece;
    const nextCaptured = new Set(captured);
    nextCaptured.add(keyOf(option.captureX, option.captureY));
    const continuations = captureSequences(
      nextBoard,
      option.x,
      option.y,
      piece,
      nextCaptured,
    );
    for (const continuation of continuations) {
      sequences.push([option, ...continuation]);
    }
  }
  return sequences;
}

function ordinaryMoves(board, color) {
  const moves = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const piece = board[y][x];
      if (colorOf(piece) !== color) continue;
      if (isKing(piece)) {
        for (const [dx, dy] of DIAGONALS) {
          let targetX = x + dx;
          let targetY = y + dy;
          while (inside(targetX, targetY) && board[targetY][targetX] === EMPTY) {
            moves.push({ fromX: x, fromY: y, x: targetX, y: targetY });
            targetX += dx;
            targetY += dy;
          }
        }
      } else {
        const dy = color === BLACK ? -1 : 1;
        for (const dx of [-1, 1]) {
          const targetX = x + dx;
          const targetY = y + dy;
          if (inside(targetX, targetY) && board[targetY][targetX] === EMPTY) {
            moves.push({ fromX: x, fromY: y, x: targetX, y: targetY });
          }
        }
      }
    }
  }
  return moves;
}

function legalTurn(board, color) {
  const captures = [];
  let maximum = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const piece = board[y][x];
      if (colorOf(piece) !== color) continue;
      for (const steps of captureSequences(board, x, y, piece)) {
        if (!steps.length) continue;
        if (steps.length > maximum) {
          maximum = steps.length;
          captures.length = 0;
        }
        if (steps.length === maximum) captures.push({ fromX: x, fromY: y, steps });
      }
    }
  }
  if (captures.length) return { captures, moves: [], maximum };
  return { captures: [], moves: ordinaryMoves(board, color), maximum: 0 };
}

export const checkersRulesForTest = {
  SIZE,
  EMPTY,
  BLACK_MAN,
  WHITE_MAN,
  BLACK_KING,
  WHITE_KING,
  BLACK,
  WHITE,
  createInitialBoard,
  legalTurn,
};

export function createCheckersController(elements) {
  const {
    canvas,
    status,
    playerOneCard,
    playerTwoCard,
    playerOneLabel,
    playerTwoLabel,
    playerOnePiece,
    playerTwoPiece,
    playerOneScore,
    playerTwoScore,
    undoButton,
    surrenderButton,
    restartButton,
    onResult,
  } = elements;
  const ctx = canvas.getContext("2d");
  const CELL = canvas.width / SIZE;
  const aiWorker = new Worker(new URL("./checkers-ai-worker.js?v=1", import.meta.url), { type: "module" });
  let board = createInitialBoard();
  let currentColor = BLACK;
  let playerOneColor = BLACK;
  let mode = "pvp";
  let difficulty = "normal";
  let aiThinking = false;
  let aiRequestId = 0;
  let scores = { playerOne: 0, playerTwo: 0 };
  let selected = null;
  let activeSequences = [];
  let captureStep = 0;
  let pendingCaptured = [];
  let turnSnapshot = null;
  let history = [];
  let gameOver = false;
  let started = false;
  let quietPly = 0;

  function playerName(color) {
    if (mode === "pve") return color === playerOneColor ? "玩家" : "AI";
    return color === playerOneColor ? "玩家 1" : "玩家 2";
  }

  function colorName(color) {
    return color === BLACK ? "黑棋" : "白棋";
  }

  function snapshot() {
    return {
      board: cloneBoard(board),
      currentColor,
      playerOneColor,
      scores: { ...scores },
      gameOver,
      quietPly,
    };
  }

  function restore(saved) {
    board = cloneBoard(saved.board);
    currentColor = saved.currentColor;
    playerOneColor = saved.playerOneColor;
    scores = { ...saved.scores };
    gameOver = saved.gameOver;
    quietPly = saved.quietPly;
    clearSelection();
    render();
  }

  function clearSelection() {
    selected = null;
    activeSequences = [];
    captureStep = 0;
    pendingCaptured = [];
    turnSnapshot = null;
  }

  function cancelAiRequest() {
    aiRequestId += 1;
    aiThinking = false;
  }

  function selectableOrigins(plan) {
    const source = plan.captures.length ? plan.captures : plan.moves;
    return new Set(source.map((move) => keyOf(move.fromX, move.fromY)));
  }

  function currentTargets(plan) {
    if (!selected) return [];
    if (activeSequences.length) {
      return activeSequences.map((sequence) => sequence.steps[captureStep]);
    }
    return plan.moves.filter((move) => (
      move.fromX === selected.x && move.fromY === selected.y
    ));
  }

  function updateStatus(plan = legalTurn(board, currentColor)) {
    if (gameOver) return;
    const name = playerName(currentColor);
    if (mode === "pve" && currentColor !== playerOneColor && aiThinking) {
      status.textContent = `AI · ${colorName(currentColor)}正在思考…`;
      return;
    }
    if (pendingCaptured.length) {
      status.textContent = `${name}必须继续吃子（本回合共吃 ${plan.maximum || activeSequences[0]?.steps.length} 枚）。`;
    } else if (plan.captures.length) {
      status.textContent = `${name} · ${colorName(currentColor)}必须吃子，且要选择能吃 ${plan.maximum} 枚的路线。`;
    } else {
      status.textContent = `${name} · ${colorName(currentColor)}落子。`;
    }
  }

  function updateCards() {
    playerOneLabel.textContent = `${mode === "pve" ? "玩家" : "玩家 1"} · ${colorName(playerOneColor)}`;
    playerTwoLabel.textContent = `${mode === "pve" ? "AI" : "玩家 2"} · ${colorName(otherColor(playerOneColor))}`;
    playerOnePiece.className = `checkers-token ${playerOneColor === BLACK ? "is-black" : "is-white"}`;
    playerTwoPiece.className = `checkers-token ${playerOneColor === WHITE ? "is-black" : "is-white"}`;
    playerOneScore.textContent = String(scores.playerOne);
    playerTwoScore.textContent = String(scores.playerTwo);
    playerOneCard.classList.toggle("is-current", !gameOver && currentColor === playerOneColor);
    playerTwoCard.classList.toggle("is-current", !gameOver && currentColor !== playerOneColor);
    const onlyAiOpening = mode === "pve"
      && currentColor === playerOneColor
      && playerOneColor === WHITE
      && history.length < 2
      && !turnSnapshot;
    undoButton.disabled = (!history.length && !turnSnapshot) || onlyAiOpening;
    surrenderButton.disabled = gameOver || aiThinking || (mode === "pve" && currentColor !== playerOneColor);
    restartButton.disabled = aiThinking;
  }

  function drawPiece(x, y, piece, isPendingCapture) {
    const centerX = (x + 0.5) * CELL;
    const centerY = (y + 0.5) * CELL;
    const radius = CELL * 0.34;
    ctx.save();
    if (isPendingCapture) ctx.globalAlpha = 0.38;
    ctx.shadowColor = "rgb(28 17 9 / 45%)";
    ctx.shadowBlur = CELL * 0.1;
    ctx.shadowOffsetY = CELL * 0.07;
    const gradient = ctx.createRadialGradient(
      centerX - radius * 0.35,
      centerY - radius * 0.4,
      radius * 0.1,
      centerX,
      centerY,
      radius,
    );
    if (colorOf(piece) === BLACK) {
      gradient.addColorStop(0, "#5c5a55");
      gradient.addColorStop(0.38, "#242522");
      gradient.addColorStop(1, "#080907");
    } else {
      gradient.addColorStop(0, "#fffdf2");
      gradient.addColorStop(0.55, "#eadcb8");
      gradient.addColorStop(1, "#baa274");
    }
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(2, CELL * 0.035);
    ctx.strokeStyle = colorOf(piece) === BLACK ? "#777064" : "#fff8df";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = colorOf(piece) === BLACK ? "#10110f" : "#c9b181";
    ctx.stroke();
    if (isKing(piece)) {
      ctx.fillStyle = colorOf(piece) === BLACK ? "#d9a83e" : "#7d4721";
      ctx.font = `700 ${CELL * 0.38}px "Songti SC", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("王", centerX, centerY + CELL * 0.015);
    }
    ctx.restore();
  }

  function render() {
    const plan = legalTurn(board, currentColor);
    const origins = selectableOrigins(plan);
    const targets = currentTargets(plan);
    const capturedKeys = new Set(pendingCaptured.map((capture) => keyOf(capture.x, capture.y)));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6b3f23";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#d8ae70" : "#754626";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        if (!selected && origins.has(keyOf(x, y))) {
          ctx.fillStyle = "rgb(242 199 92 / 24%)";
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
    if (selected) {
      ctx.lineWidth = Math.max(4, CELL * 0.07);
      ctx.strokeStyle = "#f1c85a";
      ctx.strokeRect(selected.x * CELL + 4, selected.y * CELL + 4, CELL - 8, CELL - 8);
    }
    for (const target of targets) {
      ctx.beginPath();
      ctx.arc((target.x + 0.5) * CELL, (target.y + 0.5) * CELL, CELL * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(255 225 116 / 88%)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#673b1d";
      ctx.stroke();
    }
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (board[y][x] !== EMPTY) drawPiece(x, y, board[y][x], capturedKeys.has(keyOf(x, y)));
      }
    }
    updateCards();
    canvas.setAttribute("aria-label", `国际跳棋棋盘，当前${playerName(currentColor)}执${colorName(currentColor)}`);
  }

  function finish(winnerColor, message) {
    cancelAiRequest();
    gameOver = true;
    if (winnerColor === playerOneColor) scores.playerOne += 1;
    else scores.playerTwo += 1;
    status.textContent = message;
    clearSelection();
    render();
    onResult?.("国际跳棋本局结束", message);
  }

  function finishDraw() {
    cancelAiRequest();
    gameOver = true;
    status.textContent = "连续 50 回合没有吃子或升王，本局和棋。";
    clearSelection();
    render();
    onResult?.("国际跳棋本局结束", status.textContent);
  }

  function completeTurn(wasCapture, wasPromotion) {
    if (turnSnapshot) history.push(turnSnapshot);
    for (const capture of pendingCaptured) board[capture.y][capture.x] = EMPTY;
    const piece = board[selected.y][selected.x];
    if (!isKing(piece)) {
      if (piece === BLACK_MAN && selected.y === 0) board[selected.y][selected.x] = BLACK_KING;
      if (piece === WHITE_MAN && selected.y === SIZE - 1) board[selected.y][selected.x] = WHITE_KING;
    }
    const promoted = wasPromotion || piece !== board[selected.y][selected.x];
    quietPly = wasCapture || promoted ? 0 : quietPly + 1;
    const mover = currentColor;
    currentColor = otherColor(currentColor);
    clearSelection();
    const nextPlan = legalTurn(board, currentColor);
    const remaining = board.flat().filter((value) => colorOf(value) === currentColor).length;
    if (!remaining || (!nextPlan.captures.length && !nextPlan.moves.length)) {
      finish(mover, `${playerName(mover)}获胜并得 1 分。`);
      return;
    }
    if (quietPly >= 100) {
      finishDraw();
      return;
    }
    updateStatus(nextPlan);
    render();
    requestAiMove();
  }

  function sameCaptureRoute(candidate, move) {
    if (candidate.fromX !== move.fromX || candidate.fromY !== move.fromY) return false;
    if (candidate.steps.length !== move.steps.length) return false;
    return candidate.steps.every((step, index) => {
      const proposed = move.steps[index];
      return step.x === proposed.x
        && step.y === proposed.y
        && step.captureX === proposed.captureX
        && step.captureY === proposed.captureY;
    });
  }

  function applyAiMove(proposedMove) {
    if (gameOver || mode !== "pve" || currentColor === playerOneColor) return;
    const plan = legalTurn(board, currentColor);
    let move;
    if (plan.captures.length) {
      move = plan.captures.find((candidate) => sameCaptureRoute(candidate, proposedMove));
      if (!move) move = plan.captures[0];
    } else {
      const target = proposedMove?.steps?.[0];
      move = plan.moves.find((candidate) => (
        candidate.fromX === proposedMove?.fromX
        && candidate.fromY === proposedMove?.fromY
        && candidate.x === target?.x
        && candidate.y === target?.y
      )) || plan.moves[0];
    }
    if (!move) {
      finish(playerOneColor, "AI 无合法走法，玩家获胜并得 1 分。");
      return;
    }

    turnSnapshot = snapshot();
    selected = { x: move.fromX, y: move.fromY };
    const piece = board[selected.y][selected.x];
    board[selected.y][selected.x] = EMPTY;
    const steps = move.steps || [{ x: move.x, y: move.y }];
    for (const step of steps) {
      if (Number.isInteger(step.captureX)) pendingCaptured.push({ x: step.captureX, y: step.captureY });
      selected = { x: step.x, y: step.y };
    }
    board[selected.y][selected.x] = piece;
    completeTurn(pendingCaptured.length > 0, false);
  }

  function requestAiMove() {
    if (mode !== "pve" || gameOver || currentColor === playerOneColor || aiThinking) return;
    const id = ++aiRequestId;
    aiThinking = true;
    updateStatus();
    render();
    aiWorker.postMessage({
      id,
      board: cloneBoard(board),
      color: currentColor,
      difficulty,
    });
  }

  aiWorker.addEventListener("message", (event) => {
    if (event.data?.id !== aiRequestId || !aiThinking) return;
    aiThinking = false;
    if (event.data.error) console.error("International draughts AI failed", event.data.error);
    else console.log(`AI depth=${event.data.depth} nodes=${event.data.nodes} time=${event.data.timeMs}ms`);
    applyAiMove(event.data.move);
  });

  aiWorker.addEventListener("error", (event) => {
    if (!aiThinking) return;
    console.error("International draughts AI worker failed", event.message || event);
    aiThinking = false;
    applyAiMove(null);
  });

  function selectPiece(x, y, plan) {
    if (colorOf(board[y][x]) !== currentColor) return;
    if (plan.captures.length) {
      const sequences = plan.captures.filter((sequence) => sequence.fromX === x && sequence.fromY === y);
      if (!sequences.length) return;
      selected = { x, y };
      activeSequences = sequences;
      captureStep = 0;
    } else if (plan.moves.some((move) => move.fromX === x && move.fromY === y)) {
      selected = { x, y };
    } else {
      return;
    }
    render();
  }

  function playCapture(x, y) {
    const matching = activeSequences.filter((sequence) => {
      const step = sequence.steps[captureStep];
      return step.x === x && step.y === y;
    });
    if (!matching.length) return false;
    if (!turnSnapshot) turnSnapshot = snapshot();
    const step = matching[0].steps[captureStep];
    const piece = board[selected.y][selected.x];
    board[selected.y][selected.x] = EMPTY;
    board[y][x] = piece;
    pendingCaptured.push({ x: step.captureX, y: step.captureY });
    selected = { x, y };
    activeSequences = matching;
    captureStep += 1;
    if (captureStep === activeSequences[0].steps.length) completeTurn(true, false);
    else {
      updateStatus();
      render();
    }
    return true;
  }

  function playOrdinaryMove(x, y, plan) {
    const move = plan.moves.find((candidate) => (
      candidate.fromX === selected.x
      && candidate.fromY === selected.y
      && candidate.x === x
      && candidate.y === y
    ));
    if (!move) return false;
    turnSnapshot = snapshot();
    const piece = board[selected.y][selected.x];
    board[selected.y][selected.x] = EMPTY;
    board[y][x] = piece;
    selected = { x, y };
    completeTurn(false, false);
    return true;
  }

  function handleBoardClick(event) {
    if (gameOver || aiThinking || (mode === "pve" && currentColor !== playerOneColor)) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width / CELL);
    const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height / CELL);
    if (!inside(x, y)) return;
    const plan = legalTurn(board, currentColor);
    if (!selected) {
      selectPiece(x, y, plan);
      return;
    }
    if (activeSequences.length || plan.captures.length) {
      if (playCapture(x, y)) return;
      if (!pendingCaptured.length) selectPiece(x, y, plan);
      return;
    }
    if (playOrdinaryMove(x, y, plan)) return;
    selectPiece(x, y, plan);
  }

  function startRound({ swapColors = false, mode: nextMode = mode, difficulty: nextDifficulty = difficulty } = {}) {
    cancelAiRequest();
    mode = nextMode;
    difficulty = nextDifficulty;
    if (started && swapColors) playerOneColor = otherColor(playerOneColor);
    started = true;
    board = createInitialBoard();
    currentColor = BLACK;
    selected = null;
    activeSequences = [];
    captureStep = 0;
    pendingCaptured = [];
    turnSnapshot = null;
    history = [];
    gameOver = false;
    quietPly = 0;
    updateStatus();
    render();
    requestAiMove();
  }

  canvas.addEventListener("click", handleBoardClick);
  restartButton.addEventListener("click", () => startRound({ swapColors: true }));
  undoButton.addEventListener("click", () => {
    cancelAiRequest();
    if (turnSnapshot) {
      restore(turnSnapshot);
      return;
    }
    let previous = history.pop();
    if (mode === "pve" && currentColor === playerOneColor && history.length) previous = history.pop();
    if (previous) restore(previous);
  });
  surrenderButton.addEventListener("click", () => {
    if (gameOver || !window.confirm(`确定${playerName(currentColor)}投降吗？`)) return;
    history.push(snapshot());
    const winner = otherColor(currentColor);
    finish(winner, `${playerName(currentColor)}投降，${playerName(winner)}获胜并得 1 分。`);
  });

  return { startRound, render };
}
