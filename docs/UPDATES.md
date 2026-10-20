# Updates

GitPilot updates itself in place. Nobody needs to uninstall and reinstall.

## How users get updates

| Installed with | How it updates |
|---|---|
| Windows `.exe` (NSIS) or `.msi` | In the app: **Update to x.y.z** appears in the sidebar → **Update now**. The installer runs in the background, replaces the old version and starts GitPilot again. Running a newer installer by hand also upgrades in place. |
| AppImage | In the app: the AppImage file is replaced with the new one, then **Restart now**. |
| Debian/Ubuntu `.deb` | In the app; the system asks for your password (installing system packages needs administrator rights). |
| CachyOS/Arch package | The app tells you a new version exists and links to the release page. Install it with `sudo pacman -U gitpilot-bin-<version>-1-x86_64.pkg.tar.zst`, which upgrades in place. GitPilot doesn't replace files pacman manages. |

GitPilot checks at most once a day, a few seconds after it starts. You can turn that off or check by hand in **Settings → General → Updates**. Nothing is downloaded or installed until you click **Update now**. Repositories, settings and API keys are kept.

Every update is verified against GitPilot's public key (in `src-tauri/tauri.conf.json`) before it's installed. A download that wasn't signed with the matching private key is rejected.

## One-time setup for maintainers

The update signing key pair was generated once. The **public** key is already in `tauri.conf.json`. The **private** key must never be committed.

1. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, and add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `gitpilot-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the contents of `password.txt`
2. Store both files somewhere safe and private (a password manager). **If the private key or its password is lost, existing installs can never receive another update**: you'd have to ship a new key and ask everyone to reinstall once.

To make a new key pair instead: `npx tauri signer generate -w gitpilot-updater.key`, put the `.pub` contents into `plugins.updater.pubkey` in `tauri.conf.json`, and update the two secrets.

## Publishing a release that installed copies will pick up

1. Raise `version` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `packaging/arch/PKGBUILD`, and add a section to `CHANGELOG.md`. The changelog section becomes the "What's new" text in the update dialog.
2. Commit, then create and push a tag matching the version:
   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```
3. The **Build installers** workflow builds everything, signs the update packages, creates `latest.json`, and publishes a **full (not pre-release)** GitHub Release with all files.

Installed copies read `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`. GitHub only serves that from the newest release that is **not** marked pre-release, so:
- a pre-release is never offered as an update;
- if you create a release by hand on the website, attach `latest.json` (from the workflow's **gitpilot-update-manifest** artifact) and don't tick "pre-release".

If the repository moves or is renamed, update `plugins.updater.endpoints` in `tauri.conf.json`.
