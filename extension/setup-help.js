// Battery Theme — helper install instructions, shared by the popup and the
// setup page.
(function (root) {
  "use strict";
  const REPO = "https://github.com/william-ricchiuti/battery-theme";
  root.BatteryHelp = {
    repoUrl: REPO,
    why: "Firefox doesn't let extensions read the battery, so Battery Theme uses a small helper script on this computer.",
    // Keyed by runtime.getPlatformInfo().os; anything else uses "default".
    install: {
      default: {
        how: "Paste this into a terminal:",
        command: "curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash",
      },
      win: {
        how: "Windows support is experimental. Download the project ZIP from GitHub, unzip it, and run:",
        command: "host\\windows\\install.bat",
      },
    },
    forPlatform(os) {
      return this.install[os] || this.install.default;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
