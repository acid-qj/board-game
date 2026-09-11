#include <emscripten/bind.h>

#include "GomokuBoard.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(gomoku) {
    class_<GomokuBoard>("GomokuBoard")
        .constructor<>()
        .function("reset", &GomokuBoard::reset)
        .function("placeStone", &GomokuBoard::placeStone)
        .function("removeStone", &GomokuBoard::removeStone)
        .function("get", &GomokuBoard::get)
        .function("isWin", &GomokuBoard::isWin);
}