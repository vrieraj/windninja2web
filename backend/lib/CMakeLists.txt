cmake_minimum_required(VERSION 3.16)
project(windninja_core LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED on)

# ------- Dependencies -------
find_package(Python3 REQUIRED COMPONENTS Interpreter Development.Module)
find_package(pybind11 REQUIRED)
find_package(GDAL REQUIRED)
find_package(Boost REQUIRED COMPONENTS date_time program_options)
find_package(CURL QUIET)

find_package(OpenMP QUIET)
if(OpenMP_FOUND)
    add_compile_definitions(NINJA_OPENMP)
endif()

# shapelib: config-mode then pkg-config fallback (Linux)
find_package(shapelib CONFIG QUIET)
if(NOT shapelib_FOUND)
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(SHAPELIB IMPORTED_TARGET shp)
        if(SHAPELIB_FOUND)
            add_library(shapelib_interface ALIAS PkgConfig::SHAPELIB)
            set(SHAPELIB_LIBRARY PkgConfig::SHAPELIB)
            set(SHAPELIB_INCLUDE_DIRS ${SHAPELIB_INCLUDE_DIRS})
        endif()
    endif()
endif()

find_package(netCDF QUIET)

# ------- Source tree -------
set(NINJA_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../src/ninja")
set(NINJA_INCLUDE
    ${NINJA_SRC_DIR}
    ${Boost_INCLUDE_DIRS}
    ${GDAL_INCLUDE_DIRS}
    ${CURL_INCLUDE_DIRS}
    ${NETCDF_INCLUDES}
    ${SHAPELIB_INCLUDE_DIRS}
)

# Core sources
set(NINJA_SOURCES
    air.cpp                   ascii_grid.cpp
    Array2D.cpp               Aspect.cpp
    cellDiurnal.cpp           domainAverageInitialization.cpp
    dust.cpp                  EasyBMP.cpp
    EasyBMP_Font.cpp          EasyBMP_Geometry.cpp
    element.cpp               Elevation.cpp
    farsiteAtm.cpp            fetch_factory.cpp
    flowSeparation.cpp        fluid.cpp
    frictionVelocity.cpp      gdal_fetch.cpp
    gdal_output.cpp           gdal_util.cpp
    genericSurfInitialization.cpp
    griddedInitialization.cpp initialize.cpp
    initializationFactory.cpp KmlVector.cpp
    LineStyle.cpp             mesh.cpp
    landfireclient.cpp        ncepGfsSurfInitialization.cpp
    ncepNamAlaskaSurfInitialization.cpp
    ncepNamSurfInitialization.cpp
    ncepNamGrib2SurfInitialization.cpp
    ncepHrrrSurfInitialization.cpp
    ncepNdfdInitialization.cpp
    ncepRapSurfInitialization.cpp
    wrfSurfInitialization.cpp wrf3dInitialization.cpp
    ninja_conv.cpp            ninjaArmy.cpp
    ninjaCom.cpp              ninja.cpp
    ninjaException.cpp        ninja_init.cpp
    ninjaMathUtility.cpp      ninjaUnits.cpp
    ninja_threaded_exception.cpp
    omp_guard.cpp             OutputWriter.cpp
    pointInitialization.cpp   preconditioner.cpp
    readInputFile.cpp         relief_fetch.cpp
    Shade.cpp                 ShapeVector.cpp
    Slope.cpp                 solar.cpp
    solpos.cpp                srtmclient.cpp
    stability.cpp             startRuns.cpp
    stl_create.cpp            Style.cpp
    surface_fetch.cpp         surfaceVectorField.cpp
    SurfProperties.cpp        volVTK.cpp
    WindNinjaInputs.cpp       windProfile.cpp
    wn_3dArray.cpp            wn_3dScalarField.cpp
    wn_3dVectorField.cpp      wn_Arrow.cpp
    wxModelInitialization.cpp wxModelInitializationFactory.cpp
    wxStation.cpp             windninja.cpp
    gcp_wx_init.cpp           ninjaTools.cpp
)
list(TRANSFORM NINJA_SOURCES PREPEND "${NINJA_SRC_DIR}/")

# Link libraries
set(LINK_LIBS ${GDAL_LIBRARY} ${Boost_LIBRARIES} ${CURL_LIBRARIES})
if(SHAPELIB_LIBRARY)
    list(APPEND LINK_LIBS ${SHAPELIB_LIBRARY})
endif()
if(netCDF_FOUND)
    list(APPEND LINK_LIBS ${NETCDF_LIBRARIES_C})
endif()

# Compile definitions matching the main WindNinja build
add_compile_definitions(
    $<$<BOOL:${OpenMP_FOUND}>:NINJA_OPENMP>
    NINJAFOAM=0
    WITH_NOMADS_SUPPORT=0
    PHONE_HOME_QUERIES_ENABLED=0
    HAVE_GMTED=0
    WITH_LCP_CLIENT=0
    FRICTION_VELOCITY=0
    EMISSIONS=0
)

# ------- pybind11 module -------
pybind11_add_module(windninja_core MODULE
    ${NINJA_SOURCES}
    bindings.cpp
)

target_include_directories(windninja_core PRIVATE ${NINJA_INCLUDE})
target_link_libraries(windninja_core PRIVATE ${LINK_LIBS})

if(OpenMP_FOUND)
    target_link_libraries(windninja_core PRIVATE OpenMP::OpenMP_CXX)
endif()

install(TARGETS windninja_core DESTINATION ${Python3_SITELIB})
