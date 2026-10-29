/** The steps of adding a server, as the design numbers them, the one at marked current. */
export function Steps({ names, at }: { names: readonly string[]; at: number }) {
  return (
    <ol className="flex gap-4">
      {names.map((step, index) => (
        <li key={step} aria-current={index === at ? 'step' : undefined} className={index <= at ? 'font-medium' : 'text-muted-foreground'}>
          {index + 1} {step}
        </li>
      ))}
    </ol>
  );
}
