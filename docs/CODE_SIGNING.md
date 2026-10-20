# Signing the Windows installers

Windows shows "Windows protected your PC" (SmartScreen) for installers that aren't signed with a code-signing certificate. Code cannot remove this by itself: you need a certificate issued to you (or your organization) by a certificate authority that Windows trusts. A self-signed certificate does **not** help.

The build workflow is already set up to sign as soon as a certificate is available. Until then it builds unsigned installers and prints a warning.

## What signing changes

- The installer shows your name as the **verified publisher** instead of "Unknown publisher".
- SmartScreen warnings fade as the signed installer gains reputation (downloads without reports). A brand-new certificate can still trigger a warning for the first releases; that's how SmartScreen works for everyone.
- Users can verify the files weren't tampered with.

## Ways to get a certificate

| Option | Cost (approx.) | Notes |
|---|---|---|
| **SignPath Foundation** | Free | For open-source projects. Apply at signpath.org; they sign builds from your public GitHub repository through their own service, so you'd follow their GitHub Actions integration instead of the `.pfx` steps below. |
| **Certum Open Source Code Signing** | Low annual fee | Certificate for individual open-source developers, delivered on a smart card/cloud key. |
| **Azure Trusted Signing** | Monthly subscription | Microsoft's managed signing. Requires identity validation; check eligibility for your country and whether you're an individual or organization. Uses a `signCommand` rather than a `.pfx`. |
| Commercial OV certificate (Sectigo, DigiCert, SSL.com…) | Annual fee | Organization validation. Since 2023, new certificates are issued on hardware tokens or cloud HSMs, so a downloadable `.pfx` may not be available. Check the CA's CI/CD signing option. |

Prices and eligibility change; check the provider's current terms.

## Using a `.pfx` certificate with the workflow

If your provider gives you a `.pfx` file:

1. Convert it to base64:
   - Linux/macOS: `base64 -w0 certificate.pfx > certificate.txt`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Content certificate.txt`
2. On GitHub, open the repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `WINDOWS_CERTIFICATE`: the contents of `certificate.txt`
   - `WINDOWS_CERTIFICATE_PASSWORD`: the `.pfx` password
3. Delete `certificate.txt`. Never commit the certificate.
4. Run **Build installers** again. The log says "Signing with certificate …", and the MSI and EXE are signed and timestamped.

To check a downloaded installer on Windows: right-click it → **Properties → Digital Signatures**.

## Using a cloud or hardware-token certificate

Tauri can call any signing tool through `bundle.windows.signCommand` in `src-tauri/tauri.conf.json` (for example Azure Trusted Signing's `trusted-signing-cli`, or your CA's cloud signing tool). Follow your provider's instructions for a GitHub Actions runner and replace the signing branch in `.github/workflows/build-installers.yml`.

## Until then

Tell users to click **More info → Run anyway**. The release notes and `INSTALL.md` already explain this.
