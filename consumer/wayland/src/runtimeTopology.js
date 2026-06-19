function monitorsFromDisplay(display) {
    const monitorList = display?.get_monitors?.();
    const monitors = [];
    const count = monitorList?.get_n_items?.() ?? 0;
    for (let index = 0; index < count; index += 1) {
        const monitor = monitorList.get_item(index);
        if (monitor !== null && monitor !== undefined) {
            monitors.push(monitor);
        }
    }

    return monitors;
}

var TopologyController = class TopologyController {
    constructor(options = {}) {
        this._display = options.display;
        this._compositor = options.compositor || 'generic';
        this._createSurfaces = options.createSurfaces;
        this._destroySurfaces = options.destroySurfaces;
        this._createPresenter = options.createPresenter;
        this._outputFromMonitor = options.outputFromMonitor;
        this._onPresentersChanged = options.onPresentersChanged || null;
        this._log = options.log || (_message => {});
        this._surfaces = [];
        this._presenters = [];
        this._monitorList = null;
        this._itemsChangedSignalId = 0;
    }

    get presenters() {
        return this._presenters;
    }

    buildInitial() {
        return this._rebuild({allowEmpty: false});
    }

    watch(connection) {
        this._connection = connection;
        this._monitorList = this._display?.get_monitors?.() ?? null;
        if (this._monitorList && typeof this._monitorList.connect === 'function') {
            this._itemsChangedSignalId = this._monitorList.connect('items-changed', () => {
                this.rebuildForTopologyChange();
            });
        }
    }

    rebuildForTopologyChange() {
        const presenters = this._rebuild({allowEmpty: true});
        this._connection?.rebuildTopology?.(presenters);
        this._onPresentersChanged?.(presenters);
        return presenters;
    }

    stop() {
        if (this._monitorList && this._itemsChangedSignalId !== 0 &&
            typeof this._monitorList.disconnect === 'function') {
            this._monitorList.disconnect(this._itemsChangedSignalId);
        }
        this._itemsChangedSignalId = 0;
        this._destroyCurrentSurfaces();
        this._presenters = [];
    }

    _rebuild(options = {}) {
        this._destroyCurrentSurfaces();

        const monitors = monitorsFromDisplay(this._display);
        if (monitors.length === 0) {
            this._presenters = [];
            if (options.allowEmpty) {
                this._log('No GDK monitors are available after topology change; clearing producer outputs.');
                return this._presenters;
            }

            throw new Error('No GDK monitors are available for Wayland layer-shell surfaces.');
        }

        this._surfaces = this._createSurfaces(monitors);
        this._presenters = this._surfaces.map((surface, index) => {
            const output = this._outputFromMonitor(monitors[index], index, {
                compositor: this._compositor,
            });
            return this._createPresenter(surface, output, monitors[index], index);
        });

        return this._presenters;
    }

    _destroyCurrentSurfaces() {
        if (this._surfaces.length === 0) {
            return;
        }

        this._destroySurfaces(this._surfaces);
        this._surfaces = [];
    }
};

var RuntimeTopology = {
    TopologyController,
    monitorsFromDisplay,
};
