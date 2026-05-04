import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
});

interface MermaidRendererProps {
  code: string;
}

/** 去掉模型常夹带的围栏/BOM，避免被当成图表正文解析。 */
export function normalizeMermaidSource(raw: string): string {
  let t = (raw || '').replace(/^\uFEFF/, '').trim();
  if (!t) return '';
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:mermaid)?\s*\r?\n?/i, '');
    t = t.replace(/\r?\n?```\s*$/i, '');
    t = t.trim();
  }
  return t.trim();
}

const DEBOUNCE_MS = 220;

export function MermaidRenderer({ code }: MermaidRendererProps) {
  const baseId = useId().replace(/:/g, '');
  const renderSeq = useRef(0);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [parseIncomplete, setParseIncomplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const src = normalizeMermaidSource(code);

    setParseIncomplete(false);
    if (!src) {
      setSvg('');
      setError('');
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        const rid = `mmd-${baseId}-${++renderSeq.current}`;
        try {
          const parsed = await mermaid.parse(src, { suppressErrors: true });
          if (parsed === false) {
            if (!cancelled) {
              setSvg('');
              setError('');
              setParseIncomplete(true);
            }
            return;
          }
          const { svg: out } = await mermaid.render(rid, src);
          if (!cancelled) {
            setSvg(out);
            setError('');
            setParseIncomplete(false);
          }
        } catch (e) {
          if (!cancelled) {
            setSvg('');
            setParseIncomplete(false);
            const msg = (e as Error)?.message || String(e);
            setError(msg.replace(/\s*mermaid version\s+[\d.]+/i, '').trim());
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, baseId]);

  if (error) {
    return (
      <div
        style={{
          background: 'rgba(255,80,80,0.1)',
          border: '1px solid rgba(255,80,80,0.3)',
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          color: '#ff6b6b',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        Mermaid 渲染错误：{error}
      </div>
    );
  }

  if (parseIncomplete) {
    return (
      <div
        style={{
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 6,
          padding: 8,
          fontSize: 10,
          color: '#6a7588',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        Mermaid：当前内容无法解析（语法未写完或不符合 Mermaid 11 规则）。补全后再预览。
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        style={{
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          color: '#888',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        正在渲染 Mermaid…
      </div>
    );
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        background: 'rgba(0,0,0,0.35)',
        borderRadius: 6,
        padding: 8,
        overflowX: 'auto',
      }}
    />
  );
}
