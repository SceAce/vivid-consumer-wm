project(
  'vivid-hyprland-bridge',
  'cpp',
  version: '0.1.0',
  license: 'GPL-3.0-or-later',
  meson_version: '>= 0.57.0',
  default_options: ['cpp_std=c++23']
)

hyprland_include_dir = get_option('hyprland_include_dir')
hyprland_inc = include_directories(hyprland_include_dir, hyprland_include_dir / 'src')
hyprland_dep = dependency(
  'hyprland',
  required: false,
  not_found_message: 'Install Hyprland headers/pkg-config metadata, or pass -Dhyprland_include_dir=/path/to/hyprland headers.'
)
required_hash = get_option('required_hash')
default_socket = get_option('default_socket')
plugin_install_dir = get_option('libdir') / 'vivid' / 'hyprland'

add_project_arguments(
  '-DVIVID_HYPRLAND_REQUIRED_HASH="@0@"'.format(required_hash),
  '-DVIVID_HYPRLAND_DEFAULT_SOCKET="@0@"'.format(default_socket),
  language: 'cpp'
)

shared_module(
  'vivid-hyprland-bridge',
  files('src/plugin.cpp', 'src/vivid_socket.cpp', 'src/output_map.cpp', 'src/pointer_mapper.cpp', 'src/pointer_debug.cpp'),
  dependencies: hyprland_dep,
  include_directories: hyprland_inc,
  install: true,
  install_dir: plugin_install_dir,
  name_prefix: 'lib',
)

protocol_test = executable(
  'vivid-hyprland-protocol-test',
  files('tests/protocol_test.cpp'),
  include_directories: hyprland_inc,
)
test('protocol', protocol_test)

socket_queue_src = files('src/vivid_socket.cpp')

socket_queue_test = executable(
  'vivid-hyprland-socket-queue-test',
  files('tests/socket_queue_test.cpp', 'src/pointer_debug.cpp') + socket_queue_src,
  include_directories: hyprland_inc,
)
test('socket-queue', socket_queue_test)

socket_backoff_test = executable(
  'vivid-hyprland-socket-backoff-test',
  files('tests/socket_backoff_test.cpp', 'src/pointer_debug.cpp') + socket_queue_src,
  include_directories: hyprland_inc,
)
test('socket-backoff', socket_backoff_test)

output_map_test = executable(
  'vivid-hyprland-output-map-test',
  files('tests/output_map_test.cpp', 'src/output_map.cpp', 'src/pointer_debug.cpp'),
  include_directories: hyprland_inc,
)
test('output-map', output_map_test)

pointer_mapper_test = executable(
  'vivid-hyprland-pointer-mapper-test',
  files('tests/pointer_mapper_test.cpp', 'src/pointer_mapper.cpp'),
  include_directories: hyprland_inc,
)
test('pointer-mapper', pointer_mapper_test)

hash_policy_test = executable(
  'vivid-hyprland-hash-policy-test',
  files('tests/hash_policy_test.cpp'),
  include_directories: hyprland_inc,
)
test('hash-policy', hash_policy_test)

pointer_debug_test = executable(
  'vivid-hyprland-pointer-debug-test',
  files('tests/pointer_debug_test.cpp', 'src/pointer_debug.cpp'),
  include_directories: hyprland_inc,
)
test('pointer-debug', pointer_debug_test)

test(
  'install-workflow',
  find_program('sh'),
  args: [files('tests/install_workflow_test.sh'), meson.project_source_root()],
)
