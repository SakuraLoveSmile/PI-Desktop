/*
 * Pi-Desktop-Plus macOS main executable.
 *
 * Why this file exists
 * --------------------
 * Every Electron app's `Contents/MacOS/<name>` starts as the same prebuilt
 * binary that Electron ships: electron-builder only *renames* it
 * (`app-builder-lib/out/electron/electronMac.js` -> `doRename(contents/MacOS,
 * productName, CFBundleExecutable)`), it never relinks it. Two fork builds of the
 * same Electron release therefore keep the same `LC_UUID` — and Chromium links
 * with LLD, whose UUID is derived from the linked content, so the value is even
 * stable across separate builds.
 *
 * macOS attributes Local Network privacy to the code signature together with the
 * main executable's UUID (Apple TN3179), and TN3178 documents the network-subsystem
 * confusion that follows a shared build UUID. Linking this file ourselves is what
 * gives the fork an independent identity: the linker emits a fresh `LC_UUID`.
 *
 * Scope: only this file is compiled here. `Electron Framework`, the helper
 * applications and every resource are reused verbatim from the pinned official
 * distribution, so the runtime stays exactly `electron@43.6.0` and no Electron
 * upgrade is involved.
 *
 * Fidelity: mirrors, at tag `v43.6.0`,
 *   - `shell/app/electron_main_mac.cc`   -> `main()`
 *   - `shell/app/uv_stdio_fix.cc`        -> `FixStdioStreams()`
 *   - `shell/common/electron_constants.h` -> `kRunAsNode`
 *
 * Deliberate deviations from upstream, both recorded here on purpose:
 *   1. The `HELPER_EXECUTABLE` branch (seatbelt sandbox server setup) is not
 *      reproduced. It belongs to the helper executables, which this fork reuses
 *      unchanged from the official distribution; this binary is only ever the
 *      browser process.
 *   2. Upstream gates the Node path on `electron::fuses::IsRunAsNodeEnabled()`
 *      before reading `ELECTRON_RUN_AS_NODE`. That fuse is enabled in official
 *      Electron builds and this repository does not flip it (no `electronFuses`
 *      configuration), so honouring the variable whenever it is set matches the
 *      shipped configuration. If a fuse were ever flipped, this file must be
 *      updated together with it.
 */

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

/* Exported by "Electron Framework" (shell/app/electron_library_main.h,
 * __attribute__((visibility("default")))). */
extern int ElectronMain(int argc, char* argv[]);
extern int ElectronInitializeICUandStartNode(int argc, char* argv[]);

/*
 * libuv may mark stdin/stdout/stderr as close-on-exec, which interferes with
 * Chromium's subprocess spawning, so a stream that is already closed is reopened
 * onto /dev/null. Verbatim in behaviour from `shell/app/uv_stdio_fix.cc`; the
 * child processes this app spawns (host sidecar, shell tools) are the reason it
 * is reproduced rather than skipped.
 */
static void FixStdioStreams(void) {
  struct stat st;
  if (fstat(STDIN_FILENO, &st) < 0 && errno == EBADF) {
    (void)freopen("/dev/null", "r", stdin);
  }
  if (fstat(STDOUT_FILENO, &st) < 0 && errno == EBADF) {
    (void)freopen("/dev/null", "w", stdout);
  }
  if (fstat(STDERR_FILENO, &st) < 0 && errno == EBADF) {
    (void)freopen("/dev/null", "w", stderr);
  }
}

int main(int argc, char* argv[]) {
  FixStdioStreams();

  const char* run_as_node = getenv("ELECTRON_RUN_AS_NODE");
  if (run_as_node != NULL && *run_as_node != '\0') {
    return ElectronInitializeICUandStartNode(argc, argv);
  }

  return ElectronMain(argc, argv);
}
