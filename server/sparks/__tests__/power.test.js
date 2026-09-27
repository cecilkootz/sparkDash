import assert from "node:assert/strict";
import test from "node:test";
import { SHUTDOWN_BIN, SHUTDOWN_REMOTE_CMD } from "../../power.js";

test("shutdown pre-check is scoped to the spark-shutdown sudoers rule", () => {
  assert.equal(SHUTDOWN_BIN, "/usr/local/bin/spark-shutdown");
  // `sudo -n true` fails when sudoers only grants NOPASSWD for SHUTDOWN_BIN.
  assert.ok(!SHUTDOWN_REMOTE_CMD.includes("sudo -n true"));
  const exists = SHUTDOWN_REMOTE_CMD.indexOf(`test -x ${SHUTDOWN_BIN} || {`);
  const sudoCheck = SHUTDOWN_REMOTE_CMD.indexOf(
    `sudo -n -l ${SHUTDOWN_BIN} >/dev/null 2>&1 || { echo "passwordless sudo required for ${SHUTDOWN_BIN}" >&2; exit 126; }`
  );
  const launch = SHUTDOWN_REMOTE_CMD.indexOf(`nohup sudo -n ${SHUTDOWN_BIN} >/dev/null 2>&1 &`);
  assert.ok(exists === 0 && exists < sudoCheck && sudoCheck < launch);
});
