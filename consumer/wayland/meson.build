project(
  'vivid-consumer-wayland',
  version: '0.1.0',
  license: 'GPL-3.0-or-later',
  meson_version: '>= 0.57.0'
)

gjs = find_program('gjs')
gtk4 = dependency('gtk4')

layer_shell_option = get_option('layer_shell')
layer_shell = dependency(
  'gtk4-layer-shell-0',
  required: layer_shell_option,
  not_found_message: 'gtk4-layer-shell-0 is required for vivid-consumer-wayland. Install the GTK4 layer-shell development package, or pass -Dlayer_shell=disabled for the documented probe-only fallback.'
)

layer_shell_required = layer_shell.found() ? 'true' : 'false'

probe_config = configuration_data()
probe_config.set('gjs', gjs.full_path())
probe_config.set('layer_shell_required', layer_shell_required)

probe = configure_file(
  input: 'src/layer-shell-probe.js',
  output: 'vivid-consumer-wayland-probe',
  configuration: probe_config,
)

install_data(
  probe,
  install_dir: get_option('bindir'),
  install_mode: 'rwxr-xr-x',
)

run_target(
  'probe-help',
  command: [gjs, probe, '--help'],
)
