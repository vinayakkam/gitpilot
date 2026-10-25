# Installing GitPilot

GitPilot needs **Git** installed on your computer. Everything else it needs comes with the installer (Windows) or from your package manager (Linux).

Downloads are on the [Releases page](https://github.com/vinayakkam/gitpilot/releases). In the file names below, replace `<version>` with the version you downloaded (for example `0.4.0`).

---

## CachyOS (and other Arch-based distros: Arch, EndeavourOS, Manjaro, Garuda)

### Option A — install the ready-made package (recommended)

1. Download `gitpilot-bin-<version>-1-x86_64.pkg.tar.zst`.
2. Open a terminal in the folder you downloaded it to and run:

   ```bash
   sudo pacman -U gitpilot-bin-<version>-1-x86_64.pkg.tar.zst
   ```

   pacman installs the dependencies it needs (`git`, `webkit2gtk-4.1`, `gtk3`, `libsoup3`).
3. Start **GitPilot** from your application menu (it's listed under Development), or run `gitpilot` in a terminal.

To uninstall: `sudo pacman -R gitpilot-bin`

### Option B — build the package yourself with makepkg

Use this if you'd rather build the package on your own machine.

1. Put `PKGBUILD` and `GitPilot_<version>_amd64.deb` in the same, empty folder.
2. In that folder run (as your normal user, not root):

   ```bash
   makepkg -si
   ```

   `-s` installs missing dependencies, `-i` installs the finished package.

### Option C — AppImage (no installation)

```bash
sudo pacman -S --needed git webkit2gtk-4.1 fuse2
chmod +x GitPilot_<version>_amd64.AppImage
./GitPilot_<version>_amd64.AppImage
```

`fuse2` is needed to mount AppImages. Without it, run `./GitPilot_<version>_amd64.AppImage --appimage-extract-and-run`.

### Optional extras on CachyOS

- **Saving AI API keys:** GitPilot stores keys in the system keychain. KDE Plasma (CachyOS default) uses KWallet; GNOME uses GNOME Keyring. If neither is running, set the key as an environment variable instead (`export ANTHROPIC_API_KEY=...` in `~/.profile`).
- **Claude Code:** install it, then GitPilot opens it in your terminal (Konsole, kitty, Alacritty… are detected automatically; you can pick one in Settings → Claude Code).
- **Blank or flickering window** on some NVIDIA setups: start it with `WEBKIT_DISABLE_DMABUF_RENDERER=1 gitpilot`.

---

## Windows 10 / 11

### Before you install

Install **Git for Windows** from <https://git-scm.com/download/win> (keep the default options). GitPilot finds it automatically; if you installed it somewhere unusual, set the path in GitPilot under Settings → Git.

### Install with the MSI

1. Download `GitPilot_<version>_x64_en-US.msi`.
2. Double-click it and follow the installer.
3. Windows may show **"Windows protected your PC"** (SmartScreen) while the installer is unsigned. Click **More info → Run anyway**. (Maintainers: see `docs/CODE_SIGNING.md` to sign releases.)
4. Start **GitPilot** from the Start menu.

Uninstall from **Settings → Apps → Installed apps → GitPilot**.

### Alternative: the EXE installer

`GitPilot_<version>_x64-setup.exe` installs for your user only and doesn't need administrator rights. Same SmartScreen note applies.

GitPilot uses Microsoft Edge WebView2, which is built into Windows 11 and current Windows 10. If it's missing, the installer downloads it.

---

## Updating

You never need to uninstall first.

- **Windows, AppImage, Debian/Ubuntu:** when a new version is out, **Update to x.y.z** appears at the bottom of GitPilot's sidebar. Click it, then **Update now**. Your repositories and settings are kept. You can also check by hand in **Settings → General → Updates**. On Windows, running a newer installer over the old one also upgrades in place.
- **CachyOS / Arch:** GitPilot tells you a new version exists. Download the new `.pkg.tar.zst` and run `sudo pacman -U gitpilot-bin-<version>-1-x86_64.pkg.tar.zst`. pacman replaces the old version.

---

## Getting the Windows installers built

Windows installers have to be built on Windows (the MSI tool, WiX, only runs there). The project includes a GitHub Actions workflow that does this for free on GitHub's Windows machines:

1. Create a repository on GitHub (it can be private) and push the project:

   ```bash
   cd gitpilot
   git remote add origin https://github.com/<you>/gitpilot.git
   git push -u origin main
   ```

2. On GitHub, open the repository's **Actions** tab, choose **Build installers**, and click **Run workflow**.
3. When it finishes (about 15–20 minutes), open the run and download **gitpilot-windows** (MSI + EXE) and **gitpilot-linux** (deb, AppImage, CachyOS package) from the Artifacts section.

To publish a release with all installers attached, push a version tag instead:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Or build on your own Windows PC: install Rust (<https://rustup.rs>, MSVC toolchain), Node.js 22, and the "Desktop development with C++" workload from Visual Studio Build Tools, then:

```powershell
npm ci
npm run tauri build -- --bundles msi,nsis
```

The installers appear in `src-tauri\target\release\bundle\msi\` and `...\nsis\`.

---

## Debian / Ubuntu

```bash
sudo apt install ./GitPilot_<version>_amd64.deb
```
