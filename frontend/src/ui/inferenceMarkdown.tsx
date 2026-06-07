import { Children, isValidElement, memo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidRenderer } from './MermaidRenderer';
import { colors } from './theme';

export const inferenceMono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const tableCellBorder = `1px solid ${colors.border}`;

export const inferenceMdComponents: Components = {
  p: ({ children }) => <p style={{ margin: '0.35em 0', lineHeight: 1.45 }}>{children}</p>,
  h1: ({ children }) => <h1 style={{ fontSize: 14, margin: '0.5em 0 0.25em', fontWeight: 'bold' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 13, margin: '0.5em 0 0.25em', fontWeight: 'bold' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 12, margin: '0.4em 0 0.2em', fontWeight: 'bold' }}>{children}</h3>,
  ul: ({ children }) => <ul style={{ margin: '0.25em 0', paddingLeft: 18, lineHeight: 1.45 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0.25em 0', paddingLeft: 18, lineHeight: 1.45 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0.15em 0' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0.35em 0',
        paddingLeft: 10,
        borderLeft: '3px solid #4a5a8a',
        color: '#a8b4c8',
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} rel="noopener noreferrer" target="_blank" style={{ color: '#8ab4f8', textDecoration: 'underline' }}>
      {children}
    </a>
  ),
  strong: ({ children }) => <strong style={{ fontWeight: 'bold', color: colors.bright }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '0.5em 0' }} />,
  pre: ({ children }) => {
    const arr = Children.toArray(children);
    for (const child of arr) {
      if (isValidElement(child) && child.type === MermaidRenderer) {
        return child;
      }
    }
    try {
      for (const child of arr) {
        if (isValidElement(child) && typeof child.type === 'string' && child.type === 'code') {
          const p = (child as ReactElement<{ children?: ReactNode }>).props;
          const content = String(p.children ?? '');
          const m = content.match(/^<merMAID>([\s\S]*)<\/merMAID>$/);
          if (m) {
            return <MermaidRenderer code={m[1].trim()} />;
          }
        }
      }
    } catch {
      // fall through
    }
    return (
      <pre
        style={{
          margin: '0.5em 0',
          padding: 8,
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 4,
          overflow: 'auto',
          fontFamily: inferenceMono,
          fontSize: 10,
          lineHeight: 1.4,
        }}
      >
        {children}
      </pre>
    );
  },
  code: (props) => {
    const { className, children, ...rest } = props;
    if (className && /language-mermaid\b/i.test(className)) {
      const src = String(children).replace(/\n$/, '');
      return <MermaidRenderer code={src} />;
    }
    const isFenced = Boolean(className && /^language-/.test(className));
    if (isFenced) {
      return (
        <code
          className={className}
          style={{ fontFamily: inferenceMono, display: 'block', whiteSpace: 'pre', fontSize: 10 }}
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          fontFamily: inferenceMono,
          background: 'rgba(0,0,0,0.35)',
          padding: '1px 4px',
          borderRadius: 3,
          fontSize: 10,
        }}
        {...rest}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div style={{ margin: '0.5em 0', overflowX: 'auto', maxWidth: '100%' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: 10,
          lineHeight: 1.35,
          border: tableCellBorder,
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: 'rgba(0,0,0,0.28)' }}>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th
      style={{
        border: tableCellBorder,
        padding: '5px 7px',
        textAlign: 'left',
        fontWeight: 'bold',
        color: colors.bright,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: tableCellBorder, padding: '5px 7px', textAlign: 'left', verticalAlign: 'top' }}>{children}</td>
  ),
};

export const InferenceMarkdownBody = memo(function InferenceMarkdownBody(props: { body: string }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.45, color: '#c8d4e0', wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={inferenceMdComponents}>
        {props.body}
      </ReactMarkdown>
    </div>
  );
});
