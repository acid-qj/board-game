/*
 * Browser AI adapted for this project from the MIT-licensed built-in JS engine in:
 * https://github.com/keyao1002/international-draughts-100-ai
 * Copyright (c) 2026 keyao1002 — MIT License; see third_party/NOTICE.md.
 */

const SIZE = 10;
const EMPTY = 0;
const BLACK_MAN = 1;
const WHITE_MAN = 2;
const BLACK_KING = 3;
const WHITE_KING = 4;
const BLACK = 1;
const WHITE = 2;
const DIAGONALS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const WIN_SCORE = 100000;
const TIMEOUT = Symbol("timeout");
const SETTINGS = {
  easy: { timeMs: 100, maxDepth: 3, variety: 3 },
  normal: { timeMs: 450, maxDepth: 6, variety: 1 },
  hard: { timeMs: 1400, maxDepth: 9, variety: 1 },
};

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

function captureOptions(board, x, y, piece, captured) {
  if (!isKing(piece)) {
    const options = [];
    for (const [dx, dy] of DIAGONALS) {
      const captureX = x + dx;
      const captureY = y + dy;
      const targetX = x + dx * 2;
      const targetY = y + dy * 2;
      if (!inside(targetX, targetY)) continue;
      const target = board[captureY][captureX];
      if (
        target !== EMPTY
        && colorOf(target) !== colorOf(piece)
        && !captured.has(keyOf(captureX, captureY))
        && board[targetY][targetX] === EMPTY
      ) options.push({ x: targetX, y: targetY, captureX, captureY });
    }
    return options;
  }

  const options = [];
  for (const [dx, dy] of DIAGONALS) {
    let scanX = x + dx;
    let scanY = y + dy;
    while (inside(scanX, scanY) && board[scanY][scanX] === EMPTY) {
      scanX += dx;
      scanY += dy;
    }
    if (!inside(scanX, scanY)) continue;
    const target = board[scanY][scanX];
    if (colorOf(target) === colorOf(piece) || captured.has(keyOf(scanX, scanY))) continue;
    const captureX = scanX;
    const captureY = scanY;
    scanX += dx;
    scanY += dy;
    while (inside(scanX, scanY) && board[scanY][scanX] === EMPTY) {
      options.push({ x: scanX, y: scanY, captureX, captureY });
      scanX += dx;
      scanY += dy;
    }
  }
  return options;
}

function captureSequences(board, x, y, piece, captured = new Set()) {
  const options = captureOptions(board, x, y, piece, captured);
  if (!options.length) return [[]];
  const sequences = [];
  for (const option of options) {
    const next = cloneBoard(board);
    next[y][x] = EMPTY;
    next[option.y][option.x] = piece;
    const nextCaptured = new Set(captured);
    nextCaptured.add(keyOf(option.captureX, option.captureY));
    for (const continuation of captureSequences(next, option.x, option.y, piece, nextCaptured)) {
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
            moves.push({ fromX: x, fromY: y, steps: [{ x: targetX, y: targetY }] });
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
            moves.push({ fromX: x, fromY: y, steps: [{ x: targetX, y: targetY }] });
          }
        }
      }
    }
  }
  return moves;
}

function legalMoves(board, color) {
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
  return captures.length ? captures : ordinaryMoves(board, color);
}

function applyMove(board, move) {
  const next = cloneBoard(board);
  let x = move.fromX;
  let y = move.fromY;
  const piece = next[y][x];
  next[y][x] = EMPTY;
  for (const step of move.steps) {
    x = step.x;
    y = step.y;
  }
  next[y][x] = piece;
  for (const step of move.steps) {
    if (Number.isInteger(step.captureX)) next[step.captureY][step.captureX] = EMPTY;
  }
  if (piece === BLACK_MAN && y === 0) next[y][x] = BLACK_KING;
  if (piece === WHITE_MAN && y === SIZE - 1) next[y][x] = WHITE_KING;
  return next;
}

function evaluate(board, color) {
  let black = 0;
  let white = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const piece = board[y][x];
      if (piece === EMPTY) continue;
      const king = isKing(piece);
      let value = king ? 330 : 100;
      if (!king) value += colorOf(piece) === BLACK ? (SIZE - 1 - y) * 6 : y * 6;
      else value += 12 - Math.abs(4.5 - x) * 2 - Math.abs(4.5 - y) * 2;
      if (x === 0 || x === SIZE - 1) value -= 3;
      if (colorOf(piece) === BLACK) black += value;
      else white += value;
    }
  }
  const score = black - white;
  return color === BLACK ? score : -score;
}

function moveOrderScore(board, move, color) {
  const captures = move.steps.filter((step) => Number.isInteger(step.captureX)).length;
  const end = move.steps.at(-1);
  const piece = board[move.fromY][move.fromX];
  const promotion = !isKing(piece) && ((color === BLACK && end.y === 0) || (color === WHITE && end.y === 9));
  const center = 10 - Math.abs(4.5 - end.x) - Math.abs(4.5 - end.y);
  return captures * 1000 + (promotion ? 400 : 0) + center;
}

function boardKey(board, color, depth) {
  return `${color}:${depth}:${board.flat().join("")}`;
}

function negamax(board, color, depth, alpha, beta, deadline, table, stats) {
  if (Date.now() >= deadline) throw TIMEOUT;
  stats.nodes += 1;
  const key = boardKey(board, color, depth);
  const cached = table.get(key);
  if (cached !== undefined) return cached;
  const moves = legalMoves(board, color);
  if (!moves.length) return -WIN_SCORE - depth;
  if (depth === 0) return evaluate(board, color);
  moves.sort((a, b) => moveOrderScore(board, b, color) - moveOrderScore(board, a, color));
  let best = -Infinity;
  let cutoff = false;
  for (const move of moves) {
    const score = -negamax(applyMove(board, move), otherColor(color), depth - 1, -beta, -alpha, deadline, table, stats);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      cutoff = true;
      break;
    }
  }
  if (!cutoff && table.size < 120000) table.set(key, best);
  return best;
}

function searchRoot(board, color, depth, deadline, table, stats) {
  const moves = legalMoves(board, color);
  moves.sort((a, b) => moveOrderScore(board, b, color) - moveOrderScore(board, a, color));
  const ranked = [];
  let alpha = -Infinity;
  for (const move of moves) {
    const score = -negamax(applyMove(board, move), otherColor(color), depth - 1, -Infinity, -alpha, deadline, table, stats);
    ranked.push({ move, score });
    if (score > alpha) alpha = score;
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function chooseMove(board, color, difficulty) {
  const setting = SETTINGS[difficulty] || SETTINGS.normal;
  const startedAt = Date.now();
  const deadline = startedAt + setting.timeMs;
  const table = new Map();
  const stats = { nodes: 0 };
  let ranked = legalMoves(board, color).map((move) => ({ move, score: 0 }));
  let completedDepth = 0;
  if (!ranked.length) return { move: null, depth: 0, nodes: 0, timeMs: 0 };
  for (let depth = 1; depth <= setting.maxDepth; depth += 1) {
    try {
      const next = searchRoot(board, color, depth, deadline, table, stats);
      if (next.length) ranked = next;
      completedDepth = depth;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  const poolSize = Math.min(setting.variety, ranked.length);
  const pick = difficulty === "easy" ? Math.floor(Math.random() * poolSize) : 0;
  return {
    move: ranked[pick].move,
    depth: completedDepth,
    score: ranked[pick].score,
    nodes: stats.nodes,
    timeMs: Date.now() - startedAt,
  };
}

if (typeof self !== "undefined") {
  self.addEventListener("message", (event) => {
    const { id, board, color, difficulty } = event.data || {};
    try {
      if (!Array.isArray(board) || board.length !== SIZE || !board.every((row) => Array.isArray(row) && row.length === SIZE)) {
        throw new Error("Invalid 10x10 board");
      }
      const result = chooseMove(board, color, difficulty);
      self.postMessage({ id, ...result });
    } catch (error) {
      self.postMessage({ id, error: error?.message || String(error) });
    }
  });
}

export {
  applyMove as applyCheckersAiMove,
  chooseMove as chooseCheckersAiMove,
  legalMoves as checkersAiLegalMoves,
};
