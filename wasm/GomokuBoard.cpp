#include "GomokuBoard.hpp"

GomokuBoard::GomokuBoard() {
    reset();
}

void GomokuBoard::reset() {
    for (int x = 0; x < SIZE; ++x) {
        for (int y = 0; y < SIZE; ++y) {
            board[x][y] = 0;
        }
    }
}

bool GomokuBoard::inBoard(int x, int y) const {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

bool GomokuBoard::placeStone(int x, int y, int player) {
    if (!inBoard(x, y)) {
        return false;
    }

    if (board[x][y] != 0) {
        return false;
    }

    board[x][y] = player;
    return true;
}

bool GomokuBoard::removeStone(int x, int y) {
    if (!inBoard(x, y)) {
        return false;
    }
    if (board[x][y] == 0) {
        return false;
    }

    board[x][y] = 0;
    return true;
}

int GomokuBoard::get(int x, int y) const {
    if (!inBoard(x, y)) {
        return 0;
    }

    return board[x][y];
}

int GomokuBoard::countDirection(int x, int y, int dx, int dy) const {
    const int player = board[x][y];

    if (player == 0) {
        return 0;
    }

    int count = 0;

    int currentX = x + dx;
    int currentY = y + dy;

    while (inBoard(currentX, currentY) && board[currentX][currentY] == player) {
        ++count;

        currentX += dx;
        currentY += dy;
    }

    return count;
}

bool GomokuBoard::isWin(int x, int y) const {
    if (!inBoard(x, y)) {
        return false;
    }

    if (board[x][y] == 0) {
        return false;
    }

    if (countDirection(x, y, 0, 1) + countDirection(x, y, 0, -1) + 1 >= 5) {
        return true;
    }

    if (countDirection(x, y, 1, 0) + countDirection(x, y, -1, 0) + 1 >= 5) {
        return true;
    }

    if (countDirection(x, y, 1, 1) + countDirection(x, y, -1, -1) + 1 >= 5) {
        return true;
    }

    if (countDirection(x, y, 1, -1) + countDirection(x, y, -1, 1) + 1 >= 5) {
        return true;
    }

    return false;
}