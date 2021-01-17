pkg_name=restic-snapshot
pkg_origin=emergence
pkg_version="1.0"
pkg_maintainer="Chris Alfano <chris@jarv.us>"
pkg_license=("MIT")
pkg_upstream_url="https://github.com/JarvusInnovations/emergence-backup"

pkg_deps=(
  core/bash
  core/jq-static
  core/mysql-client
  jarvus/restic
)

pkg_bin_dirs=(bin)


do_build() {
  return 0
}

do_build() {

  pushd "${CACHE_PATH}" > /dev/null
    build_line "Preparing bin scripts"
    mkdir -v "bin"
    cp -v "${PLAN_CONTEXT}/bin"/* "./bin/"
    fix_interpreter "bin/*" core/bash bin/bash
  popd > /dev/null
}

do_install() {
  cp -r "${CACHE_PATH}"/* "${pkg_prefix}/"
}

do_strip() {
  return 0
}
