import ReactMarkdown, { type Components } from 'react-markdown';

/** How each part of the text is drawn: code on muted ground in mono, links underlined, opening outside Aeolus in a tab of their own. */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="break-words">{children}</p>,
  code: ({ children }) => <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-caption [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-primary">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
};

/**
 * What an item says in Markdown, as an opened item shows it: a question's
 * context, a step's why, an alert's or a notice's body (Bridge mockups).
 * HTML in the text stays text, and a link leads only to a safe address,
 * as react-markdown does by default.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="grid gap-2">
      <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
