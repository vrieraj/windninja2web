#include <pybind11/pybind11.h>
#include <pybind11/numpy.h>
#include <pybind11/stl.h>

#include "ninja.h"
#include "ninjaArmy.h"
#include "WindNinjaInputs.h"
#include "ninja_init.h"

#include "mesh.h"

namespace py = pybind11;

// ──────────────────────────────────────────────
//  Helper: wrap double* as numpy array (no copy)
//  Keeps a reference to `parent` to prevent the
//  C++ object from being destroyed while the array
//  is alive.
// ──────────────────────────────────────────────
py::array_t<double> as_numpy(const double* data, int rows, int cols,
                             py::object parent = py::none())
{
    return py::array_t<double>(
        { (size_t)rows, (size_t)cols },
        { sizeof(double) * (size_t)cols, sizeof(double) },
        data,
        parent
    );
}

// ──────────────────────────────────────────────
//  Helper: numpy → set_DEM lambda
// ──────────────────────────────────────────────
void set_dem_from_numpy(ninja& self,
    py::array_t<double, py::array::c_style | py::array::forcecast> dem,
    int nXSize, int nYSize,
    py::array_t<double, py::array::c_style | py::array::forcecast> geoRef,
    std::string prj)
{
    py::buffer_info bDEM = dem.request();
    py::buffer_info bGEO = geoRef.request();
    self.set_DEM(
        static_cast<const double*>(bDEM.ptr),
        nXSize, nYSize,
        static_cast<const double*>(bGEO.ptr),
        prj);
}

// ──────────────────────────────────────────────
//  Python module: windninja_core
// ──────────────────────────────────────────────
PYBIND11_MODULE(windninja_core, m)
{
    GDALAllRegister();
    OGRRegisterAll();

    m.doc() = "WindNinja simulation engine – C++ core with pybind11 bindings";

    // ── ninja class ───────────────────────────
    // Module-level initialization
    m.def("initialize", [](std::string gdal_data, std::string wn_data) {
        return NinjaInitialize(gdal_data.c_str(), wn_data.c_str());
    }, "Initialize WindNinja (GDAL data path, WindNinja data path)");

    // Load timezone database directly without GDAL_DATA check
    m.def("load_timezone_db", [](std::string csv_path) {
        extern boost::local_time::tz_database globalTimeZoneDB;
        globalTimeZoneDB.load_from_file(csv_path);
    }, "Load Boost date_time timezone database from CSV path");

    py::class_<ninja>(m, "Ninja")
        .def(py::init<>())

        // DEM
        .def("set_DEM", py::overload_cast<std::string>(&ninja::set_DEM))
        .def("set_DEM", &set_dem_from_numpy)

        // Initialization
        .def("set_initializationMethod", &ninja::set_initializationMethod,
             py::arg("method"), py::arg("matchPoints") = false)
        .def("get_initializationMethod", &ninja::get_initializationMethod)

        // Inputs
        .def("set_inputSpeed", &ninja::set_inputSpeed)
        .def("set_inputDirection", &ninja::set_inputDirection)
        .def("set_inputWindHeight",
             py::overload_cast<double, lengthUnits::eLengthUnits>(
                 &ninja::set_inputWindHeight))
        .def("set_uniVegetation",
             py::overload_cast<WindNinjaInputs::eVegetation>(
                 &ninja::set_uniVegetation))
        .def("set_diurnalWinds", &ninja::set_diurnalWinds)
        .def("set_stabilityFlag", &ninja::set_stabilityFlag)
        .def("set_alphaStability", &ninja::set_alphaStability)
        .def("set_date_time",
             py::overload_cast<int const &, int const &, int const &,
                               int const &, int const &, int const &,
                               std::string const &>(
                 &ninja::set_date_time))
        .def("set_uniAirTemp", &ninja::set_uniAirTemp)
        .def("set_uniCloudCover", &ninja::set_uniCloudCover)

        // Mesh
        .def("set_meshResolution",
             py::overload_cast<double, lengthUnits::eLengthUnits>(
                 &ninja::set_meshResolution))
        .def("set_meshResChoice",
             py::overload_cast<std::string>(&ninja::set_meshResChoice))
        .def("set_numVertLayers", &ninja::set_numVertLayers)
        .def("set_numberCPUs", &ninja::set_numberCPUs)

        // Position
        .def("set_position",
             py::overload_cast<>(&ninja::set_position))

        // Output units
        .def("set_outputSpeedUnits", &ninja::set_outputSpeedUnits)
        .def("set_outputWindHeight",
             py::overload_cast<double, lengthUnits::eLengthUnits>(
                 &ninja::set_outputWindHeight))
        .def("set_outputSpeedGridResolution",
             &ninja::set_outputSpeedGridResolution)
        .def("set_outputDirectionGridResolution",
             &ninja::set_outputDirectionGridResolution)

        // Output flags
        .def("set_geoTiffOutFlag", &ninja::set_geoTiffOutFlag)
        .def("set_geoTiffResolution", &ninja::set_geoTiffResolution)
        .def("set_googOutFlag", &ninja::set_googOutFlag)
        .def("set_asciiOutFlag", &ninja::set_asciiOutFlag)
        .def("set_asciiAaigridOutFlag", &ninja::set_asciiAaigridOutFlag)
        .def("set_asciiJsonOutFlag", &ninja::set_asciiJsonOutFlag)
        .def("set_asciiProjOutFlag", &ninja::set_asciiProjOutFlag)
        .def("set_asciiGeogOutFlag", &ninja::set_asciiGeogOutFlag)
        .def("set_asciiUvOutFlag", &ninja::set_asciiUvOutFlag)
        .def("set_pdfOutFlag", &ninja::set_pdfOutFlag)
        .def("set_vtkOutFlag", &ninja::set_vtkOutFlag)
        .def("set_flatGeoBufFlag", &ninja::set_flatGeoBufFlag)
        .def("keepOutputGridsInMemory", &ninja::keepOutputGridsInMemory)
        .def("set_outputPath", &ninja::set_outputPath)
        .def("set_outputBufferClipping", &ninja::set_outputBufferClipping)

        // Run
        .def("simulate_wind", &ninja::simulate_wind)

        // Grid accessors (as numpy arrays)
        .def("get_outputSpeedGrid",
             [](ninja& self) {
                 return as_numpy(self.get_outputSpeedGrid(),
                                 self.get_outputGridnRows(),
                                 self.get_outputGridnCols(),
                                 py::cast(self));
             })
        .def("get_outputDirectionGrid",
             [](ninja& self) {
                 return as_numpy(self.get_outputDirectionGrid(),
                                 self.get_outputGridnRows(),
                                 self.get_outputGridnCols(),
                                 py::cast(self));
             })
        .def("get_outputGridProjection", &ninja::get_outputGridProjection)
        .def("get_outputGridCellSize", &ninja::get_outputGridCellSize)
        .def("get_outputGridxllCorner", &ninja::get_outputGridxllCorner)
        .def("get_outputGridyllCorner", &ninja::get_outputGridyllCorner)
        .def("get_outputGridnCols", &ninja::get_outputGridnCols)
        .def("get_outputGridnRows", &ninja::get_outputGridnRows)

        // Filenames
        .def("get_VelFileName", &ninja::get_VelFileName)
        .def("get_AngFileName", &ninja::get_AngFileName);

    // ── ninja class ───────────────────────────
    py::class_<ninjaArmy>(m, "NinjaArmy")
        .def(py::init<>())
        .def("makeDomainAverageArmy", &ninjaArmy::makeDomainAverageArmy,
             py::arg("nRuns"), py::arg("momentumFlag") = false)
        .def("makeWeatherModelArmy",
             py::overload_cast<std::string, std::string, bool>(
                 &ninjaArmy::makeWeatherModelArmy))
        .def("startRuns", &ninjaArmy::startRuns)
        .def("getSize", &ninjaArmy::getSize)
        .def("setNumberCPUs",
             [](ninjaArmy& self, int nIndex, int nCPUs) {
                 return self.setNumberCPUs(nIndex, nCPUs);
             })
        .def("setDEM",
             [](ninjaArmy& self, int nIndex, std::string path) {
                 return self.setDEM(nIndex, path);
             })
        .def("setInputSpeed",
             [](ninjaArmy& self, int nIndex, double speed, std::string units) {
                 return self.setInputSpeed(nIndex, speed, units);
             })
        .def("setInputDirection",
             [](ninjaArmy& self, int nIndex, double dir) {
                 return self.setInputDirection(nIndex, dir);
             })
        .def("setUniVegetation",
             [](ninjaArmy& self, int nIndex, std::string veg) {
                 return self.setUniVegetation(nIndex, veg);
             })
        .def("setDateTime",
             [](ninjaArmy& self, int nIndex, int y, int m, int d,
                int h, int min, int s, std::string tz) {
                 return self.setDateTime(nIndex, y, m, d, h, min, s, tz);
             })
        .def("getOutputSpeedGrid",
             [](ninjaArmy& self, int nIndex) -> py::array_t<double> {
                 int rows = self.getOutputGridnRows(nIndex);
                 int cols = self.getOutputGridnCols(nIndex);
                 return as_numpy(self.getOutputSpeedGrid(nIndex), rows, cols,
                                 py::cast(self));
             })
        .def("getOutputDirectionGrid",
             [](ninjaArmy& self, int nIndex) -> py::array_t<double> {
                 int rows = self.getOutputGridnRows(nIndex);
                 int cols = self.getOutputGridnCols(nIndex);
                 return as_numpy(self.getOutputDirectionGrid(nIndex), rows, cols,
                                 py::cast(self));
             })
        .def("getOutputGridProjection",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridProjection(nIndex);
             })
        .def("getOutputGridCellSize",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridCellSize(nIndex);
             })
        .def("getOutputGridnCols",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridnCols(nIndex);
             })
        .def("getOutputGridnRows",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridnRows(nIndex);
             })
        .def("getOutputGridxllCorner",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridxllCorner(nIndex);
             })
        .def("getOutputGridyllCorner",
             [](ninjaArmy& self, int nIndex) {
                 return self.getOutputGridyllCorner(nIndex);
             })
        .def("setPosition",
             [](ninjaArmy& self, int nIndex) {
                 return self.setPosition(nIndex);
             })
        .def("setOutputSpeedUnits",
             [](ninjaArmy& self, int nIndex, std::string units) {
                 return self.setOutputSpeedUnits(nIndex, units);
             })
        .def("setInputWindHeight",
             [](ninjaArmy& self, int nIndex, double height,
                std::string units) {
                 return self.setInputWindHeight(nIndex, height, units);
             })
        .def("setOutputWindHeight",
             [](ninjaArmy& self, int nIndex, double height,
                std::string units) {
                 return self.setOutputWindHeight(nIndex, height, units);
             })
        .def("setNumVertLayers",
             [](ninjaArmy& self, int nIndex, int nLayers) {
                 return self.setNumVertLayers(nIndex, nLayers);
             })
        .def("setMeshResolution",
             [](ninjaArmy& self, int nIndex, double resolution,
                std::string units) {
                 return self.setMeshResolution(nIndex, resolution, units);
             })
        .def("setInitializationMethod",
             [](ninjaArmy& self, int nIndex, std::string method) {
                 return self.setInitializationMethod(nIndex, method);
             })
        .def("setDiurnalWinds",
             [](ninjaArmy& self, int nIndex, bool flag) {
                 return self.setDiurnalWinds(nIndex, flag);
             })
        .def("setStabilityFlag",
             [](ninjaArmy& self, int nIndex, bool flag) {
                 return self.setStabilityFlag(nIndex, flag);
             })
        .def("setAlphaStability",
             [](ninjaArmy& self, int nIndex, double stability_) {
                 return self.setAlphaStability(nIndex, stability_);
             })
        .def("setUniAirTemp",
             [](ninjaArmy& self, int nIndex, double temp,
                std::string units) {
                 return self.setUniAirTemp(nIndex, temp, units);
             })
        .def("setUniCloudCover",
             [](ninjaArmy& self, int nIndex, double cover,
                std::string units) {
                 return self.setUniCloudCover(nIndex, cover, units);
             })
        .def("setOutputPath",
             [](ninjaArmy& self, int nIndex, std::string path) {
                 return self.setOutputPath(nIndex, path);
             });

    // ══════════════════════════════════════════
    //  Enums
    // ══════════════════════════════════════════

    py::enum_<WindNinjaInputs::eInitializationMethod>(m, "InitMethod")
        .value("none", WindNinjaInputs::noInitializationFlag)
        .value("domainAverage", WindNinjaInputs::domainAverageInitializationFlag)
        .value("point", WindNinjaInputs::pointInitializationFlag)
        .value("wxModel", WindNinjaInputs::wxModelInitializationFlag)
        .value("gridded", WindNinjaInputs::griddedInitializationFlag)
        .export_values();

    py::enum_<WindNinjaInputs::eVegetation>(m, "Vegetation")
        .value("grass", WindNinjaInputs::grass)
        .value("brush", WindNinjaInputs::brush)
        .value("trees", WindNinjaInputs::trees)
        .export_values();

    py::enum_<velocityUnits::eVelocityUnits>(m, "VelocityUnits")
        .value("mps", velocityUnits::metersPerSecond)
        .value("mph", velocityUnits::milesPerHour)
        .value("kph", velocityUnits::kilometersPerHour)
        .value("kts", velocityUnits::knots)
        .export_values();

    py::enum_<lengthUnits::eLengthUnits>(m, "LengthUnits")
        .value("feet", lengthUnits::feet)
        .value("meters", lengthUnits::meters)
        .value("miles", lengthUnits::miles)
        .value("kilometers", lengthUnits::kilometers)
        .value("feetTimesTen", lengthUnits::feetTimesTen)
        .value("metersTimesTen", lengthUnits::metersTimesTen)
        .export_values();

    py::enum_<temperatureUnits::eTempUnits>(m, "TempUnits")
        .value("K", temperatureUnits::K)
        .value("C", temperatureUnits::C)
        .value("R", temperatureUnits::R)
        .value("F", temperatureUnits::F)
        .export_values();

    py::enum_<coverUnits::eCoverUnits>(m, "CoverUnits")
        .value("fraction", coverUnits::fraction)
        .value("percent", coverUnits::percent)
        .export_values();

    py::enum_<Mesh::eMeshChoice>(m, "MeshChoice")
        .value("coarse", Mesh::coarse)
        .value("medium", Mesh::medium)
        .value("fine", Mesh::fine)
        .export_values();
}
