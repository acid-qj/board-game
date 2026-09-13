import assert from "node:assert/strict";
import test from "node:test";
import { checkersRulesForTest as rules } from "../frontend/checkers-game.js";
import { checkersAiLegalMoves, chooseCheckersAiMove } from "../frontend/checkers-ai-worker.js";

function emptyBoard() {
  return Array.from({ length: rules.SIZE }, () => Array(rules.SIZE).fill(rules.EMPTY));
}

test("international draughts starts with 20 pieces per side on a 10x10 board", () => {
  const board = rules.createInitialBoard();
  assert.equal(board.length, 10);
  assert.ok(board.every((row) => row.length === 10));
  assert.equal(board.flat().filter((piece) => piece === rules.BLACK_MAN).length, 20);
  assert.equal(board.flat().filter((piece) => piece === rules.WHITE_MAN).length, 20);
  assert.ok(board.slice(0, 4).flat().every((piece) => piece === rules.EMPTY || piece === rules.WHITE_MAN));
  assert.ok(board.slice(6).flat().every((piece) => piece === rules.EMPTY || piece === rules.BLACK_MAN));
  const blackMoves = rules.legalTurn(board, rules.BLACK).moves;
  const whiteMoves = rules.legalTurn(board, rules.WHITE).moves;
  assert.equal(blackMoves.length, 9);
  assert.equal(whiteMoves.length, 9);
  assert.ok(blackMoves.every((move) => move.y === move.fromY - 1));
  assert.ok(whiteMoves.every((move) => move.y === move.fromY + 1));
});

test("a man can capture backwards", () => {
  const board = emptyBoard();
  board[4][3] = rules.WHITE_MAN;
  board[5][2] = rules.BLACK_MAN;
  const plan = rules.legalTurn(board, rules.WHITE);
  assert.equal(plan.maximum, 1);
  assert.deepEqual(plan.captures[0].steps[0], {
    x: 1,
    y: 6,
    captureX: 2,
    captureY: 5,
  });
});

test("only routes capturing the maximum number of pieces remain legal", () => {
  const board = emptyBoard();
  board[2][1] = rules.BLACK_MAN;
  board[3][2] = rules.WHITE_MAN;
  board[5][4] = rules.WHITE_MAN;
  board[2][7] = rules.BLACK_MAN;
  board[3][8] = rules.WHITE_MAN;
  const plan = rules.legalTurn(board, rules.BLACK);
  assert.equal(plan.maximum, 2);
  assert.ok(plan.captures.length > 0);
  assert.ok(plan.captures.every((sequence) => sequence.fromX === 1 && sequence.fromY === 2));
  assert.ok(plan.captures.every((sequence) => sequence.steps.length === 2));
});

test("a king can capture from distance and choose any empty landing beyond the piece", () => {
  const board = emptyBoard();
  board[2][1] = rules.BLACK_KING;
  board[5][4] = rules.WHITE_MAN;
  const plan = rules.legalTurn(board, rules.BLACK);
  assert.equal(plan.maximum, 1);
  assert.deepEqual(
    plan.captures.map((sequence) => [sequence.steps[0].x, sequence.steps[0].y]),
    [[5, 6], [6, 7], [7, 8], [8, 9]],
  );
});

test("the browser AI returns a legal move for the side to move", () => {
  const board = rules.createInitialBoard();
  const aiMoves = checkersAiLegalMoves(board, rules.BLACK);
  const result = chooseCheckersAiMove(board, rules.BLACK, "easy");
  assert.ok(result.move);
  assert.ok(aiMoves.some((move) => JSON.stringify(move) === JSON.stringify(result.move)));
  assert.ok(result.timeMs < 1000);
});
