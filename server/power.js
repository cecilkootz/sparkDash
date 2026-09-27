export const SHUTDOWN_BIN = "/usr/local/bin/spark-shutdown";

/**
 * Remote: verify script + passwordless sudo, then background shutdown so SSH
 * returns before the host dies. Failures before backgrounding surface to the UI.
 * `sudo -n -l <bin>` rather than `sudo -n true`: the README sudoers rule grants
 * NOPASSWD for this one binary only, so a generic probe would always fail.
 */
export const SHUTDOWN_REMOTE_CMD = [
  `test -x ${SHUTDOWN_BIN} || { echo "missing ${SHUTDOWN_BIN}" >&2; exit 127; }`,
  `sudo -n -l ${SHUTDOWN_BIN} >/dev/null 2>&1 || { echo "passwordless sudo required for ${SHUTDOWN_BIN}" >&2; exit 126; }`,
  `nohup sudo -n ${SHUTDOWN_BIN} >/dev/null 2>&1 &`,
  `sleep 0.3`,
  `exit 0`,
].join("; ");
