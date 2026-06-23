export function updateCompass(camera, controlsTarget) {
    const el = document.getElementById('compass-arrow');
    if (!el || !camera || !controlsTarget) return;
    const dx = camera.position.x - controlsTarget.x;
    const dz = camera.position.z - controlsTarget.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    const deg = Math.atan2(dx, dz) * 180 / Math.PI;
    el.style.transform = `rotate(${deg}deg)`;
}
