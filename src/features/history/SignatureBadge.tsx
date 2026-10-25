import type { ReactNode } from "react";
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestionMark, ShieldX } from "lucide-react";
import type { SignatureStatus } from "@/bindings/SignatureStatus";
import { cx } from "@/components/ui/cx";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

const LOOK: Record<Exclude<SignatureStatus, "notSigned">, { label: string; icon: ReactNode; className: string }> = {
  verified: { label: "Verified", icon: <ShieldCheck size={12} />, className: "bg-added-bg text-success" },
  unverified: { label: "Signed, unverified", icon: <ShieldQuestionMark size={12} />, className: "bg-warning-bg text-warning" },
  bad: { label: "Bad signature", icon: <ShieldX size={12} />, className: "bg-removed-bg text-danger" },
  expired: { label: "Signature expired", icon: <ShieldAlert size={12} />, className: "bg-warning-bg text-warning" },
  revoked: { label: "Key revoked", icon: <ShieldX size={12} />, className: "bg-removed-bg text-danger" },
  cannotCheck: { label: "Signed, can't check", icon: <Shield size={12} />, className: "bg-surface-3 text-muted" },
};

/** A commit's signature: icon + word, with the signer and key on hover. Nothing for unsigned commits. */
export function SignatureBadge({ repoId, hash }: { repoId: number; hash: string }) {
  const sig = useAsync(() => api.commitSignature(repoId, hash), [repoId, hash]);
  const s = sig.data;
  if (!s || s.status === "notSigned") return null;
  const look = LOOK[s.status];
  const who = [s.signer, s.key].filter(Boolean).join(" · ");
  return (
    <span title={who || undefined} className={cx("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium", look.className)}>
      {look.icon}
      {look.label}
    </span>
  );
}
