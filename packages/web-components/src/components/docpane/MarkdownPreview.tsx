import type { JSX } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import rehypePrismPlus from "rehype-prism-plus/common";
import remarkGfm from "remark-gfm";
import styles from "./DocPane.module.scss";

/** Props for {@link MarkdownPreview}. */
export interface MarkdownPreviewProps {
  /** The markdown source to render. */
  content: string;
  /** Open a `file://` link clicked inside the document as a new doc tab. */
  onOpenUri?: (uri: string) => void;
}

/**
 * Renders a markdown document as trusted, first-party content (#1396).
 *
 * Markdown from a file in the user's own worktree is NOT agent-authored widget
 * content, so it renders directly via react-markdown (GFM + Prism highlight),
 * not through the widget/iframe sandbox. `file://` links open as new doc tabs;
 * external links open in a new tab.
 */
export function MarkdownPreview({ content, onOpenUri }: MarkdownPreviewProps): JSX.Element {
  const components: Components = {
    a(props: JSX.IntrinsicElements["a"] & ExtraProps) {
      const { href, children } = props;
      if (href && href.startsWith("file://") && onOpenUri) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpenUri(href);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };

  return (
    <div className={styles.markdownBody} data-testid="doc-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypePrismPlus]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
