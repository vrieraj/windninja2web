let viewer, drawActive = false;
let startPos = null, rectEntity = null;
let arrowEntities = [];

async function initViewer() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    Cesium.Ion.defaultAccessToken = cfg.cesiumToken;

    viewer = new Cesium.Viewer("viewer", {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        animation: false,
        timeline: false,
        baseLayerPicker: false,
    });

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function toggleDraw() {
    drawActive = !drawActive;
    viewer.enableCursorStyle = !drawActive;
    if (!drawActive) {
        if (rectEntity) { viewer.entities.remove(rectEntity); rectEntity = null; }
        startPos = null;
    }
    document.getElementById("bbox-info").textContent =
        drawActive ? "Haz clic en dos esquinas del área" : "Ningún área seleccionada";
}

function onLeftClick(click) {
    if (!drawActive) return;
    const cartesian = viewer.camera.pickEllipsoid(click.position, Cesium.Ellipsoid.WGS84);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);

    if (!startPos) {
        startPos = carto;
        return;
    }

    const west  = Math.min(startPos.longitude, carto.longitude);
    const east  = Math.max(startPos.longitude, carto.longitude);
    const south = Math.min(startPos.latitude,  carto.latitude);
    const north = Math.max(startPos.latitude,  carto.latitude);

    if (rectEntity) viewer.entities.remove(rectEntity);
    rectEntity = viewer.entities.add({
        rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
                Cesium.Math.toDegrees(west),  Cesium.Math.toDegrees(south),
                Cesium.Math.toDegrees(east),  Cesium.Math.toDegrees(north)
            ),
            material: Cesium.Color.RED.withAlpha(0.15),
            outline: true, outlineColor: Cesium.Color.RED,
        }
    });

    appState.bbox = {
        west:  Cesium.Math.toDegrees(west),
        south: Cesium.Math.toDegrees(south),
        east:  Cesium.Math.toDegrees(east),
        north: Cesium.Math.toDegrees(north),
    };
    document.getElementById("bbox-info").textContent =
        `${appState.bbox.north.toFixed(4)}°N, ${appState.bbox.south.toFixed(4)}°S, ` +
        `${appState.bbox.east.toFixed(4)}°E, ${appState.bbox.west.toFixed(4)}°W`;

    drawActive = false;
    startPos = null;
}

function onMouseMove(movement) {
    if (!drawActive || !startPos) return;
    const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, Cesium.Ellipsoid.WGS84);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);

    if (rectEntity) viewer.entities.remove(rectEntity);
    rectEntity = viewer.entities.add({
        rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
                Cesium.Math.toDegrees(startPos.longitude),
                Cesium.Math.toDegrees(startPos.latitude),
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude)
            ),
            material: Cesium.Color.RED.withAlpha(0.1),
            outline: true, outlineColor: Cesium.Color.RED,
        }
    });
}

function clearWindArrows() {
    arrowEntities.forEach(e => viewer.entities.remove(e));
    arrowEntities = [];
}

function addWindArrows(geoJson, timeIndex) {
    clearWindArrows();
    if (!geoJson || !geoJson.features) return;

    const maxSpeed = geoJson.features.reduce((m, f) => Math.max(m, f.properties.speed || 0), 0) || 1;
    const bbox = appState.bbox;
    const latCenter = (bbox.north + bbox.south) / 2;

    geoJson.features.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const speed = f.properties.speed || 0;
        const dir = f.properties.direction || 0;
        if (speed <= 0) return;

        const rad = (dir - 180) * Math.PI / 180;
        const u = -Math.sin(rad);
        const v = -Math.cos(rad);
        const arrowLength = 300 + (speed / maxSpeed) * 2000;

        const origin = Cesium.Cartesian3.fromDegrees(lon, lat, 50);
        const dirCart = new Cesium.Cartesian3(u, v, 0);
        Cesium.Cartesian3.normalize(dirCart, dirCart);
        Cesium.Cartesian3.multiplyByScalar(dirCart, arrowLength, dirCart);

        const color = Cesium.Color.fromHsl(
            0.33 - (speed / maxSpeed) * 0.33, 0.8, 0.5
        );

        const entity = viewer.entities.add({
            position: origin,
            cylinder: {
                length: arrowLength,
                topRadius: 0,
                bottomRadius: arrowLength * 0.04,
                material: color.withAlpha(0.8),
            },
            orientation: Cesium.Quaternion.fromAxisAngle(
                Cesium.Cartesian3.UNIT_Z, Math.atan2(u, v)
            ),
        });
        arrowEntities.push(entity);
    });
}

function updateTimeSlider(index, total) {
    appState.timeIndex = index;
    document.getElementById("time-label").textContent = `Paso ${index + 1} / ${total}`;
    if (appState.windData && appState.windData.length > index) {
        addWindArrows(appState.windData[index], index);
    }
}

document.addEventListener("DOMContentLoaded", initViewer);
