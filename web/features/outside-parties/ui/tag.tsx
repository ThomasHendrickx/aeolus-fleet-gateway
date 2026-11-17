/** A plain tag: a protocol, a side, an id. */
export function Tag({ children, isMono = false }: { children: React.ReactNode; isMono?: boolean }) {
  return <span className={`inline-flex h-5.5 items-center rounded-sm border border-border px-1.5 text-caption font-medium ${isMono ? 'font-mono' : ''}`}>{children}</span>;
}
