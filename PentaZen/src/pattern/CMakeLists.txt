cmake_minimum_required(VERSION 3.20)
set(TARGET PatternGen)

add_executable(${TARGET}
    line.cpp
    line.h
    main.cpp
    type.h
)

target_link_libraries(${TARGET})

if (${CMAKE_SYSTEM_NAME} MATCHES "Windows")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_DEBUG "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_RELWITHDEBINFO "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_RELEASE "/SUBSYSTEM:CONSOLE")
    set_target_properties(${TARGET} PROPERTIES LINK_FLAGS_MINSIZEREL "/SUBSYSTEM:CONSOLE")
endif()

add_custom_command(
    OUTPUT ${CMAKE_BINARY_DIR}/pattern_15s.h
    COMMAND $<TARGET_FILE:PatternGen>
    DEPENDS PatternGen
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
    VERBATIM
)

add_custom_target(gen
    DEPENDS ${CMAKE_BINARY_DIR}/pattern_15s.h
)
