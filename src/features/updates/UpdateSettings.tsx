import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { relativeTime } from "@/lib/format";
import { useStore } from "@/store/AppStore";
import { useUpdates } from "./UpdateProvider";

export function UpdateSettings() {
  const { info, settings, saveSettings } = useStore();
  const { phase, support, checkNow, setDialogOpen } = useUpdates();
  if (!settings) return null;
  const dev = support?.installKind === "dev";

  let status: string;
  switch (phase.kind) {
    case "checking":
      status = "Checking…";
      break;
    case "upToDate":
      status = `You're on the latest version (checked ${relativeTime(phase.at / 1000)}).`;
      break;
    case "available":
    case "downloading":
    case "installing":
      status = `Version ${phase.update.version} is available.`;
      break;
    case "restartPending":
      status = `Version ${phase.update.version} is installed. Restart to use it.`;
      break;
    default:
      status = dev ? "Updates are off in development builds." : "";
  }

  return (
    <>
      <p className="text-base">
        GitPilot {info?.version}
        {status && <span className="text-muted"> · {status}</span>}
      </p>
      {support?.note && <p className="text-sm text-muted">{support.note}</p>}
      <div className="flex gap-2">
        <Button loading={phase.kind === "checking"} disabled={dev} onClick={() => void checkNow()}>
          Check for updates
        </Button>
        {(phase.kind === "available" || phase.kind === "restartPending") && (
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            {phase.kind === "restartPending" ? "Restart to update" : "See update"}
          </Button>
        )}
      </div>
      {phase.kind === "error" && <ErrorNotice error={phase.error} />}
      <Switch
        label="Check for updates automatically"
        description="Looks for a new version when GitPilot starts, at most once a day. Nothing is installed without asking you."
        checked={settings.checkForUpdates}
        disabled={dev}
        onChange={(checkForUpdates) => void saveSettings({ checkForUpdates })}
      />
    </>
  );
}
