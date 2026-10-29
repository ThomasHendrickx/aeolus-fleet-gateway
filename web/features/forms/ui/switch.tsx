/** A switch: on or off, said by its look and to a screen reader, busy while its change is on its way. */
export function Switch({ isOn, label, isPending = false, type = 'button', onClick, testId }: { isOn: boolean; label: string; isPending?: boolean; type?: 'button' | 'submit'; onClick?: () => void; testId?: string }) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      aria-busy={isPending}
      disabled={isPending}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:opacity-60 ${isOn ? 'border-primary bg-primary' : 'border-input bg-muted'}`}
    >
      <span className={`size-3.5 rounded-full bg-background shadow-sm transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'} ${isPending ? 'animate-pulse' : ''}`} />
    </button>
  );
}
