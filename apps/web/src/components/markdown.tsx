import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown written by other people (TruckersMP event organisers). Raw HTML is
// not rendered and unsafe URLs (javascript: etc.) are dropped by react-markdown,
// so this is safe to show as-is.
const components: Components = {
  h1: ({ children }) => <h3 className="mt-6 mb-2 text-xl font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-6 mb-2 text-xl font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-5 mb-2 text-lg font-bold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-4 mb-1 font-bold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-medium text-signal-ink underline decoration-1 underline-offset-2 hover:decoration-2"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-4 h-auto max-w-full rounded-xl border"
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ children }) => (
    <code className="rounded bg-secondary px-1.5 py-0.5 text-[0.9em]">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[14px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children.replace(/\r\n/g, "\n")}
      </ReactMarkdown>
    </div>
  );
}
