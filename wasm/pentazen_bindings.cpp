#include <emscripten/bind.h>

#include "search.h"
#include "thread.h"
#include "tt.h"
#include "type.h"

#include <sstream>
#include <stdexcept>
#include <string>

namespace {

bool initialized = false;

void initialize() {
    if (initialized)
        return;

    search_init();
    Threads.set(1);
    // The native engine defaults to 256 MB. A smaller table is friendlier to
    // mobile browsers and is sufficient for the website's short time limits.
    TT.resize(16);
    initialized = true;
}

int best_move(const std::string &history, int timeLimit) {
    initialize();
    Threads.reset();
    TT.clear();

    std::stringstream input(history);
    std::string token;
    while (std::getline(input, token, ';')) {
        if (token.empty())
            continue;

        std::stringstream moveInput(token);
        int y, x;
        char comma;
        if (!(moveInput >> y >> comma >> x) || comma != ',')
            throw std::runtime_error("invalid move history");

        const Move move = make_move(y, x);
        if (!is_ok(move) || !Threads.is_empty(move))
            throw std::runtime_error("invalid or duplicate move");
        Threads.do_move(move);
    }

    Threads.timeoutTurn = std::max(timeLimit, 1);
    Threads.timeLeft = 2147483647;
    Threads.think_and_move();

    const Move move = Threads.board()->last_move(1);
    return rank_of(move) * BOARD_SIDE + file_of(move);
}

} // namespace

EMSCRIPTEN_BINDINGS(pentazen_web) {
    emscripten::function("bestMove", &best_move);
}
