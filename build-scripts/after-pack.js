const fs = require("fs");
const path = require("path");

// electron-builder runs this after the app is laid out on disk and before it is
// wrapped into an installer/package. The Linux fpcalc binary is committed from
// Windows, where git cannot record an executable bit, so without this the
// .rpm/.deb would ship an fpcalc that Auto-Tag fails to run (EACCES).
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

  const fpcalc = path.join(
    context.appOutDir,
    "resources",
    "fpcalc",
    "linux",
    "fpcalc",
  );
  if (fs.existsSync(fpcalc)) {
    fs.chmodSync(fpcalc, 0o755);
    console.log("  * made fpcalc executable for the Linux package");
  }
};
