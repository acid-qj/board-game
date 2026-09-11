#pragma once

class GomokuBoard {
public:
    static constexpr int SIZE = 15;

    GomokuBoard();
    void reset();
    bool placeStone(int x, int y, int player);
    bool removeStone(int x, int y);
    int get(int x, int y) const;
    bool isWin(int x, int y) const;

private:
    int board[SIZE][SIZE];

    bool inBoard(int x, int y) const;

    int countDirection(int x, int y, int dx, int dy) const;
};
