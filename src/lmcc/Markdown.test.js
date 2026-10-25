import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from './Markdown';

function render(source) {
  return renderToStaticMarkup(
    <Markdown source={source} root="/question" baseDir="" />
  );
}

describe('Markdown renderer', () => {
  test('renders headings, emphasis and inline code', () => {
    const html = render(
      '# 标题\n\n段落 **粗体** 和 *斜体* 与 `code <x>`。'
    );
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<code>code &lt;x&gt;</code>');
  });

  test('allows only http, https and mailto links', () => {
    const html = render(
      '[安全](https://example.com) [邮件](mailto:a@example.com) [危险](javascript:alert(1))'
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('lmcc-md-link-blocked');
  });

  test('does not interpret raw HTML', () => {
    const html = render('<script>alert(1)</script>\n\n<div>raw</div>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;div&gt;');
  });

  test('renders fenced code, blockquotes, lists and tables', () => {
    const html = render(
      [
        '```json',
        '{"a": 1}',
        '```',
        '',
        '> 引用',
        '',
        '- 一',
        '  - 嵌套',
        '- 二',
        '',
        '| A | B |',
        '| --- | ---: |',
        '| 1 | 2 |',
      ].join('\n')
    );

    expect(html).toContain('lmcc-md-code');
    expect(html).toContain('{&quot;a&quot;: 1}');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul><li>一<ul><li>嵌套</li></ul></li><li>二</li></ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('text-align:right');
  });

  test('leaves local images to the bridge-backed image component', () => {
    const html = render('![示意图](images/diagram.png)');
    expect(html).toContain('lmcc-md-image-loading');
    expect(html).toContain('示意图');
    expect(html).not.toContain('src="images/diagram.png"');
  });

  test('renders remote images directly', () => {
    const html = render('![remote](https://example.com/a.png)');
    expect(html).toContain('src="https://example.com/a.png"');
  });

  test('escapes entities and treats them as text', () => {
    const html = render('a &lt; b &amp;&amp; c &gt; d');
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
  });
});
