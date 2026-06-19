var DESKTOP = 'wayland-layer-shell';
var DEFAULT_TRANSFORM = 'normal';
var DEFAULT_REFRESH_RATE = 0;

function numberOrDefault(value, defaultValue) {
    return Number.isFinite(value) ? value : defaultValue;
}

function outputIdFromMonitor(monitor) {
    return monitor.connector ||
        monitor.name ||
        monitor.get_connector?.() ||
        `monitor-${numberOrDefault(monitor.index, 0)}`;
}

function geometryFromMonitor(monitor) {
    const geometry = monitor.get_geometry?.() || {};

    return {
        x: numberOrDefault(monitor.x, numberOrDefault(geometry.x, 0)),
        y: numberOrDefault(monitor.y, numberOrDefault(geometry.y, 0)),
        logicalWidth: numberOrDefault(monitor.logicalWidth, numberOrDefault(geometry.width, 0)),
        logicalHeight: numberOrDefault(monitor.logicalHeight, numberOrDefault(geometry.height, 0)),
    };
}

function scaleFromMonitor(monitor) {
    return numberOrDefault(monitor.scale, numberOrDefault(monitor.get_scale?.(), 1));
}

function refreshRateFromMonitor(monitor) {
    return numberOrDefault(monitor.refreshRate, numberOrDefault(monitor.get_refresh_rate?.(), DEFAULT_REFRESH_RATE));
}

function outputRegistrationFromMonitor(monitor, options = {}) {
    const monitorIndex = numberOrDefault(monitor.index, numberOrDefault(options.monitorIndex, 0));
    const scale = scaleFromMonitor(monitor);
    const geometry = geometryFromMonitor(monitor);
    const logicalWidth = geometry.logicalWidth;
    const logicalHeight = geometry.logicalHeight;
    const refreshRate = refreshRateFromMonitor(monitor);

    return {
        outputId: outputIdFromMonitor(monitor),
        consumerOutputId: monitorIndex,
        monitorIndex,
        x: geometry.x,
        y: geometry.y,
        width: logicalWidth,
        height: logicalHeight,
        logicalWidth,
        logicalHeight,
        scale,
        physicalWidth: Math.round(logicalWidth * scale),
        physicalHeight: Math.round(logicalHeight * scale),
        transform: monitor.transform || DEFAULT_TRANSFORM,
        refreshRate,
        refreshRateMhz: refreshRate,
        compositor: options.compositor || 'generic',
        desktop: DESKTOP,
    };
}

function outputRegistrationFromGdkMonitor(monitor, monitorIndex, options = {}) {
    return outputRegistrationFromMonitor(monitor, {
        ...options,
        monitorIndex,
    });
}

var OutputModel = {
    DESKTOP,
    DEFAULT_TRANSFORM,
    DEFAULT_REFRESH_RATE,
    outputRegistrationFromMonitor,
    outputRegistrationFromGdkMonitor,
};
