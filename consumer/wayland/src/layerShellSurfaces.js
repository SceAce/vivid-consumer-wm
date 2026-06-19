var NAMESPACE = 'vivid-wallpaper';

const cairo = imports.cairo;

function selectLayer(LayerShell) {
    if (LayerShell.Layer.BACKGROUND !== undefined) {
        return LayerShell.Layer.BACKGROUND;
    }

    return LayerShell.Layer.BOTTOM;
}

function createEmptyInputRegion(Gdk) {
    return new Gdk.Rectangle({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    });
}

function setEmptyInputRegion(window, Gdk, cairoModule) {
    if (typeof window.set_input_region === 'function') {
        window.set_input_region(createEmptyInputRegion(Gdk));
        return;
    }

    const applySurfaceInputRegion = () => {
        const surface = window.get_surface?.();
        if (surface !== null &&
            surface !== undefined &&
            typeof surface.set_input_region === 'function') {
            surface.set_input_region(new cairoModule.Region());
        }
    };

    if (typeof window.connect === 'function') {
        window.connect('realize', applySurfaceInputRegion);
        return;
    }
}

function createPicture(Gtk, paintable = null) {
    const props = {
        can_shrink: false,
    };

    if (Gtk.ContentFit?.FILL !== undefined) {
        props.content_fit = Gtk.ContentFit.FILL;
    }

    if (paintable !== null) {
        props.paintable = paintable;
    }

    return new Gtk.Picture(props);
}

function createWallpaperSurface(monitor, options = {}) {
    const Gtk = options.Gtk;
    const Gdk = options.Gdk;
    const LayerShell = options.LayerShell;
    const cairoModule = options.cairo || cairo;
    const paintable = options.paintable || null;

    const window = new Gtk.Window({
        title: NAMESPACE,
        decorated: false,
        resizable: false,
    });
    const picture = createPicture(Gtk, paintable);

    window.set_child(picture);

    LayerShell.init_for_window(window);
    LayerShell.set_namespace(window, NAMESPACE);
    LayerShell.set_layer(window, selectLayer(LayerShell));
    LayerShell.set_monitor(window, monitor);

    for (const edge of [
        LayerShell.Edge.LEFT,
        LayerShell.Edge.RIGHT,
        LayerShell.Edge.TOP,
        LayerShell.Edge.BOTTOM,
    ]) {
        LayerShell.set_anchor(window, edge, true);
    }

    LayerShell.set_exclusive_zone(window, 0);
    LayerShell.set_keyboard_mode(window, LayerShell.KeyboardMode.NONE);

    setEmptyInputRegion(window, Gdk, cairoModule);

    window.present();

    return {
        monitor,
        window,
        picture,
    };
}

function createWallpaperSurfaces(monitors, options = {}) {
    return monitors.map(monitor => createWallpaperSurface(monitor, options));
}

function destroyWallpaperSurfaces(surfaces) {
    for (const surface of surfaces) {
        surface.window?.close?.();
    }
}

var LayerShellSurfaces = {
    NAMESPACE,
    createWallpaperSurface,
    createWallpaperSurfaces,
    destroyWallpaperSurfaces,
};
