/** The bar of a page shown to no account signed in: the sign-in pages, and a gateway that signs no one in to its pages. */
export function PlainHeader() {
  return (
    <header className="flex h-14 items-center border-b border-border px-4">
      <a href="/overview" className="text-section font-semibold">
        Aeolus
      </a>
    </header>
  );
}
