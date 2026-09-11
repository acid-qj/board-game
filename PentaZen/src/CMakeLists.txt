set(TARGET PentaZen)

add_executable(${TARGET}
    board.cpp
    board.h
    main.cpp
    misc.cpp
    misc.h
    movegen.cpp
    movegen.h
    movelist.h
    protocol.cpp
    protocol.h
    ../public.h
    search.cpp
    search.h
    thread.cpp
    thread.h
    tt.cpp
    tt.h
    type.h
)

include_directories(${CMAKE_BINARY_DIR})
target_link_libraries(${TARGET})

if (${CMAKE_SYSTEM_NAME} MATCHES "Windows")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_DEBUG "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_RELWITHDEBINFO "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_RELEASE "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_MINSIZEREL "/SUBSYSTEM:CONSOLE")
endif()
