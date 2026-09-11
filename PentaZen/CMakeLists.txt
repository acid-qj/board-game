cmake_minimum_required(VERSION 3.20)
project(PentaZen)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(src/pattern)
add_subdirectory(src)

add_dependencies(PentaZen gen)
