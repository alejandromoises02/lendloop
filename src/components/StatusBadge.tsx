import { STATUS_STYLE } from "@/lib/labels";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status] ?? ""}`}>
      {status.replace("_", " ")}
    </span>
  );
}
