import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, QrCode, Smartphone, Trash2, Wifi, WifiOff } from "lucide-react";
import type { Pairing } from "@/bindings/Pairing";
import type { RemoteDevice } from "@/bindings/RemoteDevice";
import type { RemoteStatus } from "@/bindings/RemoteStatus";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input, Switch } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { encodeQr, qrPath } from "@/lib/qr";
import { useStore } from "@/store/AppStore";
import type { AppError } from "@/bindings/AppError";
import { Group, PaneHeader } from "./parts";

/** The QR code itself: one SVG path, so it stays sharp at any size and needs no canvas. */
function QrCodeImage({ text }: { text: string }) {
  const grid = encodeQr(text);
  const size = grid.length;
  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className="h-56 w-56 rounded bg-white p-1"
      role="img"
      aria-label="Pairing code. Point your phone's camera at it."
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={qrPath(grid)} fill="#000" />
    </svg>
  );
}

function PairDialog({ open, onClose, onPaired }: { open: boolean; onClose: () => void; onPaired: (s: RemoteStatus) => void }) {
  const { notify } = useStore();
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setPairing(null);
      setError(null);
      setSeen(false);
    }
  }, [open]);

  // While the code is on screen, check often: the phone says hello as soon as it is scanned.
  useEffect(() => {
    if (!pairing || seen) return;
    let stop = false;
    const tick = async () => {
      await api.remotePollNow().catch(() => 0);
      const status = await api.remoteStatus().catch(() => null);
      const device = status?.devices.find((d) => d.id === pairing.device);
      if (stop) return;
      if (status && device?.lastSeen) {
        setSeen(true);
        onPaired(status);
        notify({ tone: "success", title: `${device.name} is paired` });
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [pairing, seen, onPaired, notify]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setPairing(await api.remotePairStart(name.trim()));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={pairing ? "Scan this with your phone" : "Pair a phone"}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{seen ? "Done" : "Cancel"}</Button>
          {!pairing && (
            <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void start()}>
              {busy ? <Spinner size={14} /> : "Show the code"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!pairing && (
          <>
            <p className="text-base text-muted">
              GitPilot will show a code. Point your phone's normal camera at it and open the link it offers — there's nothing to install, and
              no account or password anywhere.
            </p>
            <Field label="What do you call this phone?">
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={name}
                  maxLength={60}
                  placeholder="Pixel"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && void start()}
                />
              )}
            </Field>
            {error && <ErrorNotice error={error} />}
          </>
        )}

        {pairing && (
          <div className="flex flex-col items-center gap-3">
            <QrCodeImage text={pairing.url} />
            <p className="text-center text-base text-muted">
              The code holds this phone's key, so keep it on your screen only while you're scanning it.
            </p>
            <p className="flex items-center gap-2 text-base" aria-live="polite">
              {seen ? (
                <>
                  <Check size={15} className="text-added" /> {pairing.name} is paired.
                </>
              ) : (
                <>
                  <Loader2 size={15} className="animate-spin text-muted" /> Waiting for {pairing.name}…
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function DeviceRow({ device, onRemove }: { device: RemoteDevice; onRemove: (d: RemoteDevice) => void }) {
  return (
    <div className="flex items-center gap-3 rounded border border-border px-3 py-2">
      <Smartphone size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base">{device.name}</div>
        <div className="text-sm text-faint">
          {device.lastSeen ? `Last used ${relativeTime(device.lastSeen)}` : "Waiting for this phone to connect"}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onRemove(device)} aria-label={`Remove ${device.name}`}>
        <Trash2 size={14} /> Remove
      </Button>
    </div>
  );
}

export function RemotePane() {
  const { notify, run } = useStore();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pairing, setPairing] = useState(false);
  const [removing, setRemoving] = useState<RemoteDevice | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.remoteStatus());
      setError(null);
    } catch (e) {
      setError(toAppError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (enabled: boolean) => {
    try {
      setStatus(await api.remoteEnable(enabled));
    } catch (e) {
      setError(toAppError(e));
    }
  };

  const test = async () => {
    setChecking(true);
    try {
      const fresh = await api.remoteStatus();
      setStatus(fresh);
      notify(
        fresh.relayOk
          ? { tone: "success", title: "The relay is reachable" }
          : { tone: "error", title: "The relay didn't answer", body: fresh.relayError ?? undefined },
      );
    } finally {
      setChecking(false);
    }
  };

  const devices = status?.devices ?? [];

  return (
    <>
      <PaneHeader
        title="Remote control"
        description="See your repositories from your phone and fetch, pull, push, stage and commit — from anywhere, with GitPilot left running on this computer."
      />

      <Group title="Turn it on">
        <Switch
          label="Let a paired phone control GitPilot"
          description="Off by default. Nothing is contacted until you turn this on and pair a phone."
          checked={status?.enabled ?? false}
          onChange={(v) => void toggle(v)}
        />
        {error && <ErrorNotice error={error} />}
        {status?.enabled && (
          <div className="flex items-center gap-2 text-base">
            {status.relayOk ? (
              <>
                <Wifi size={15} className="text-added" />
                <span className="text-muted">Connected to {status.relayBase.replace(/^https?:\/\//, "")}</span>
              </>
            ) : (
              <>
                <WifiOff size={15} className="text-removed" />
                <span className="text-muted">{status.relayError ?? "Checking the connection…"}</span>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={checking} onClick={() => void test()}>
              {checking ? <Spinner size={13} /> : "Test the connection"}
            </Button>
          </div>
        )}
      </Group>

      <Group title="Phones" description="Each phone has its own key. Removing one stops it immediately.">
        {devices.length === 0 && <p className="text-base text-muted">No phones yet.</p>}
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} onRemove={setRemoving} />
          ))}
        </div>
        <div>
          <Button variant="primary" onClick={() => setPairing(true)}>
            <QrCode size={15} /> Pair a phone
          </Button>
        </div>
      </Group>

      <Group title="What a phone can do">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-muted">
          <li>See your repositories, what's changed, and recent commits.</li>
          <li>Look at one file's changes. Files that look like keys or .env are never sent.</li>
          <li>Stage and unstage files, and commit what's staged.</li>
          <li>Fetch, pull, and push after a confirmation on the phone.</li>
        </ul>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-muted">
          <li>It can never force push, discard your work, or change these settings.</li>
          <li>Messages are locked with a key that only this computer and the phone have.</li>
          <li>GitPilot has to be running here for any of it to work.</li>
        </ul>
      </Group>

      <PairDialog
        open={pairing}
        onClose={() => {
          setPairing(false);
          void load();
        }}
        onPaired={setStatus}
      />

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? "this phone"}?`}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await run("Remove phone", async () => setStatus(await api.remoteDeviceRemove(removing.id)), {
            success: `${removing.name} removed`,
            rethrow: true,
          });
        }}
      >
        Its key is forgotten and it can't reach this computer again. You can pair it again later.
      </ConfirmDialog>
    </>
  );
}
