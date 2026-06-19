/**
 * Copyright (C) 2023 Jeff Shee (jeffshee8969@gmail.com)
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 2 of the License
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* eslint-disable no-invalid-this */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as Logger from '../logger.js';
import * as Wallpaper from '../ui/wallpaper.js';

const logger = new Logger.Logger();

// Ref: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/workspace.js
const BACKGROUND_CORNER_RADIUS_PIXELS = 30;
const isHelperWindow = window => window?.title?.startsWith(Wallpaper.TITLE_PREFIX);

function appLabel(app) {
    return app?.get_id?.() ?? app?.get_name?.() ?? '<unknown>';
}

export class GnomeShellOverride {
    constructor(extension) {
        this._extension = extension;
        this._injectionManager = new InjectionManager();
        this._wallpaperActors = new Set();
        this._loggedHiddenHelperApps = new Set();
        this._loggedMixedHelperApps = new Set();
    }

    _reloadBackgrounds() {
        this._wallpaperActors.forEach(actor => actor.destroy());
        this._wallpaperActors.clear();

        const tryReloadStep = (label, callback) => {
            try {
                callback();
            } catch (error) {
                logger.warn(`background reload step failed label=${label}: ${error}`);
            }
        };

        tryReloadStep('layout-backgrounds', () => Main.layoutManager._updateBackgrounds());
        // `Main.screenShield` is null if the user doesn't use Gnome Shell locking.
        tryReloadStep('screen-shield-backgrounds', () => {
            if (Main.screenShield?._dialog?._updateBackgrounds != null)
                Main.screenShield._dialog._updateBackgrounds();
        });

        /**
         * WorkspaceBackground has its own bgManager,
         * we have to recreate it to use our actors, so it can set radius to our actor.
         *
         * Shell calls into other overview/dock extensions while rebuilding
         * workspaces. During session shutdown, extension disable, or dash-to-dock
         * reload, those extensions can already have torn down singleton state
         * such as dockManager. Treat workspace refresh as best-effort so a
         * third-party teardown race cannot mark this extension ERROR and prevent
         * the helper from starting on the next producer run.
         */
        tryReloadStep('workspace-views', () =>
            Main.overview._overview._controls._workspacesDisplay._updateWorkspacesViews()
        );

        /**
         *  Blur My Shell
         */
        tryReloadStep('blur-my-shell-signals', () => {
            if (Main.extensionManager._enabledExtensions.includes('blur-my-shell@aunetx')) {
                // This will trigger the `update_backgrounds` method of overview, sceenshot and coverflow alt tab.
                Main.layoutManager.emit('monitors-changed');
                // This will trigger the `reset` method of panel.
                global.display.emit('workareas-changed');
            }
        });
    }

    reloadBackgrounds() {
        this._reloadBackgrounds();
    }

    enable() {
        /**
         * Live wallpaper
         */
        let thisRef = this;

        this._injectionManager.overrideMethod(Background.BackgroundManager.prototype, '_createBackgroundActor',
            originalMethod => {
                return function () {
                    const backgroundActor = originalMethod.call(this);

                    // We need to pass radius to actors, so save a ref in bgManager.
                    this.videoActor = new Wallpaper.LiveWallpaper(
                        backgroundActor,
                        thisRef._extension.displayHelper
                    );
                    thisRef._wallpaperActors.add(this.videoActor);

                    this.videoActor.connect('destroy', actor => {
                        thisRef._wallpaperActors.delete(actor);
                    });

                    return backgroundActor;
                };
            });

        /*
         * The GTK helper windows must remain real compositor windows so
         * Clutter.Clone can sample their MetaWindowActor. At the same time
         * they are not user windows: showing them in overview, Alt-Tab, app
         * running lists, or workspace thumbnails would leak an implementation
         * detail of the consumer. Keep global.get_window_actors() untouched so
         * the wallpaper clone path can find the helper on GNOME versions where
         * the introspected method no longer accepts compatibility arguments.
         * User-facing Shell lists are filtered at their own integration points
         * below instead of changing this low-level global API contract.
         *
         * Keep AppSystem.get_running() filtering narrowly scoped to helper-only
         * apps. Dash-to-dock and the Shell number hotkeys build their startup
         * model from this global app list; pruning every temporary zero-window
         * entry can leave a real app without its running indicator until another
         * window event happens to refresh the dock.
         */

        let shellAppGetWindows = null;
        const getUnfilteredAppWindows = app => {
            try {
                return shellAppGetWindows
                    ? shellAppGetWindows.call(app)
                    : app.get_windows();
            } catch (error) {
                logger.debug(`failed to inspect app windows app=${appLabel(app)} error=${error}`);
                return [];
            }
        };

        const shouldHideRunningApp = app => {
            const windows = getUnfilteredAppWindows(app);
            const hasHelperWindow = windows.some(window => isHelperWindow(window));
            if (!hasHelperWindow)
                return false;

            const hasNonHelperWindow = windows.some(window => !isHelperWindow(window));
            if (hasNonHelperWindow) {
                const label = appLabel(app);
                if (!thisRef._loggedMixedHelperApps.has(label)) {
                    thisRef._loggedMixedHelperApps.add(label);
                    logger.warn(`helper window is associated with a real app app=${label} ` +
                        `windows=${windows.length}`);
                }
                return false;
            }

            const label = appLabel(app);
            if (!thisRef._loggedHiddenHelperApps.has(label)) {
                thisRef._loggedHiddenHelperApps.add(label);
                logger.debug(`hiding helper-only app from running apps app=${label} ` +
                    `windows=${windows.length}`);
            }
            return true;
        };

        this._injectionManager.overrideMethod(
            Workspace.Workspace.prototype,
            '_isOverviewWindow',
            originalMethod => function (window) {
                return isHelperWindow(window)
                    ? false
                    : originalMethod.apply(this, [window]);
            }
        );

        this._injectionManager.overrideMethod(
            WorkspaceThumbnail.WorkspaceThumbnail.prototype,
            '_isOverviewWindow',
            originalMethod => function (window) {
                return isHelperWindow(window)
                    ? false
                    : originalMethod.apply(this, [window]);
            }
        );

        this._injectionManager.overrideMethod(
            Meta.Display.prototype,
            'get_tab_list',
            originalMethod => function (type, workspace) {
                return originalMethod
                    .apply(this, [type, workspace])
                    .filter(window => !isHelperWindow(window));
            }
        );

        this._injectionManager.overrideMethod(
            Shell.WindowTracker.prototype,
            'get_window_app',
            originalMethod => function (window) {
                return isHelperWindow(window)
                    ? null
                    : originalMethod.apply(this, [window]);
            }
        );

        this._injectionManager.overrideMethod(
            Shell.App.prototype,
            'get_windows',
            originalMethod => {
                shellAppGetWindows = originalMethod;
                return function () {
                    return originalMethod.call(this).filter(window => !isHelperWindow(window));
                };
            }
        );

        this._injectionManager.overrideMethod(
            Shell.App.prototype,
            'get_n_windows',
            _originalMethod => function () {
                return this.get_windows().length;
            }
        );

        this._injectionManager.overrideMethod(
            Shell.AppSystem.prototype,
            'get_running',
            originalMethod => function () {
                return originalMethod.call(this).filter(app => !shouldHideRunningApp(app));
            }
        );

        /**
         * Rounded corner
         *
         * Ref: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/a6d35fdd2abd63d23c7a9d093645f760691539a0/js/ui/workspace.js#L1003-1022
         */
        this._injectionManager.overrideMethod(Workspace.WorkspaceBackground.prototype, '_updateBorderRadius',
            // Don't call the orginal method, use our implementation of rounded corners instead.
            _originalMethod => {
                return function () {
                    // The scale factor here is an integer, not the fractional scale factor.
                    // Ref: https://gjs-docs.gnome.org/st13~13/st.themecontext#method-get_scale_factor
                    const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
                    const cornerRadius = scaleFactor * BACKGROUND_CORNER_RADIUS_PIXELS;

                    const radius = Util.lerp(0, cornerRadius, this._stateAdjustment.value);
                    this._bgManager.videoActor?.setRoundedClipRadius?.(radius);
                };
            }
        );

        this._reloadBackgrounds();
    }

    disable() {
        this._injectionManager.clear();
        this._reloadBackgrounds();
    }
}
