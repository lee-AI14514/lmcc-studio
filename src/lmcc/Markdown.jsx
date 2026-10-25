import React from 'react';
import LmccImage from './LmccImage';
import './Markdown.css';

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|"']/;
const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function normalizeSource(source) {
  return String(source ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function plainText(text) {
  return decodeEntities(String(text ?? '').replace(/[*_`~]/g, '')).trim();
}

function isSafeLink(destination) {
  try {
    const parsed = new URL(destination);
    return SAFE_LINK_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function openExternalLink(href) {
  if (window.lmcc?.openExternal) {
    window.lmcc.openExternal(href);
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function renderAnchor(href, children, title) {
  return (
    <a
      href={href}
      title={title || undefined}
      rel="noreferrer noopener"
      onClick={(event) => {
        event.preventDefault();
        openExternalLink(href);
      }}
    >
      {children}
    </a>
  );
}

// ---- block helpers -------------------------------------------------------

function matchFence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/.exec(line);
  if (!match) return null;
  const info = match[2].trim();
  return {
    marker: match[1][0],
    length: match[1].length,
    lang: info ? info.split(/\s+/)[0] : '',
  };
}

function isClosingFence(line, fence) {
  const marker = fence.marker;
  const pattern = new RegExp(
    `^ {0,3}${marker === '`' ? '`' : '~'}{${fence.length},}\\s*$`
  );
  return pattern.test(line);
}

function isThematicBreak(line) {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    line
  );
}

function matchListItem(line) {
  const bullet = /^( {0,12})([-+*])([ \t]+)(.*)$/.exec(line);
  if (bullet) {
    return {
      ordered: false,
      indent: bullet[1].length,
      markerWidth: 1,
      spaces: bullet[3].length,
      content: bullet[4],
      start: null,
    };
  }
  const ordered = /^( {0,12})(\d{1,9})([.)])([ \t]+)(.*)$/.exec(line);
  if (ordered) {
    return {
      ordered: true,
      indent: ordered[1].length,
      markerWidth: ordered[2].length + 1,
      spaces: ordered[4].length,
      content: ordered[5],
      start: Number(ordered[2]),
    };
  }
  return null;
}

function stripIndent(line, count) {
  let index = 0;
  while (index < line.length && index < count && line[index] === ' ') index += 1;
  if (index === count) return line.slice(index);
  if (isBlank(line.slice(index))) return '';
  return null;
}

function isTableDelimiter(line) {
  if (!line.includes('|')) return false;
  return /^ {0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(
    line
  );
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes('|')) return false;
  if (!isTableDelimiter(lines[index + 1])) return false;
  return (
    splitTableRow(lines[index]).length ===
    splitTableRow(lines[index + 1]).length
  );
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  const cells = [];
  let current = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignments(line) {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function startsBlock(lines, index) {
  const line = lines[index];
  if (line === undefined) return false;
  if (matchFence(line)) return true;
  if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)) return true;
  if (isThematicBreak(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (matchListItem(line)) return true;
  if (isTableStart(lines, index)) return true;
  return false;
}

function parseBlocks(lines) {
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !isClosingFence(lines[index], fence)) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: 'code',
        lang: fence.lang,
        text: body.join('\n'),
      });
      continue;
    }

    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2] || '',
      });
      index += 1;
      continue;
    }

    if (isThematicBreak(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines = [];
      while (
        index < lines.length &&
        (/^ {0,3}>/.test(lines[index]) || isBlank(lines[index]))
      ) {
        if (isBlank(lines[index])) {
          quoteLines.push('');
          index += 1;
          continue;
        }
        quoteLines.push(lines[index].replace(/^ {0,3}> ?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoteLines) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(line);
      const alignments = parseAlignments(lines[index + 1]);
      const rows = [];
      index += 2;
      while (
        index < lines.length &&
        !isBlank(lines[index]) &&
        lines[index].includes('|')
      ) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, alignments, rows });
      continue;
    }

    const list = parseList(lines, index);
    if (list) {
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    let setextLevel = null;
    while (index < lines.length && !isBlank(lines[index])) {
      if (
        paragraphLines.length === 1 &&
        /^ {0,3}(=+|-+)[ \t]*$/.test(lines[index])
      ) {
        setextLevel = lines[index].trim()[0] === '=' ? 1 : 2;
        index += 1;
        break;
      }
      if (startsBlock(lines, index)) break;
      paragraphLines.push(lines[index]);
      index += 1;
    }

    if (setextLevel) {
      blocks.push({
        type: 'heading',
        level: setextLevel,
        text: paragraphLines.join(' '),
      });
    } else {
      blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
    }
  }

  return blocks;
}

function parseList(lines, start) {
  const first = matchListItem(lines[start]);
  if (!first) return null;

  const items = [];
  let index = start;
  const siblingIndent = first.indent + first.markerWidth + first.spaces;

  while (index < lines.length) {
    const marker = matchListItem(lines[index]);
    if (
      !marker ||
      marker.ordered !== first.ordered ||
      marker.indent >= siblingIndent
    ) {
      break;
    }

    const contentIndent = marker.indent + marker.markerWidth + marker.spaces;
    const itemLines = [marker.content];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      if (isBlank(line)) {
        itemLines.push('');
        index += 1;
        const nextMarker =
          index < lines.length ? matchListItem(lines[index]) : null;
        if (nextMarker && nextMarker.indent < siblingIndent) break;
        continue;
      }

      const nextMarker = matchListItem(line);
      if (nextMarker && nextMarker.indent < siblingIndent) break;

      const stripped = stripIndent(line, contentIndent);
      if (stripped === null) break;
      itemLines.push(stripped);
      index += 1;
    }

    while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) {
      itemLines.pop();
    }
    items.push(parseBlocks(itemLines));

    const next = index < lines.length ? matchListItem(lines[index]) : null;
    if (
      !next ||
      next.ordered !== first.ordered ||
      next.indent >= siblingIndent
    ) {
      break;
    }
  }

  return {
    block: {
      type: 'list',
      ordered: first.ordered,
      start: first.start,
      items,
    },
    next: index,
  };
}

// ---- inline helpers ------------------------------------------------------

function findMatchingBracket(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseDestination(text, openIndex) {
  let index = openIndex + 1;
  while (index < text.length && /\s/.test(text[index])) index += 1;

  let destination = '';
  if (text[index] === '<') {
    const end = text.indexOf('>', index + 1);
    if (end === -1) return null;
    destination = text.slice(index + 1, end);
    index = end + 1;
  } else {
    const begin = index;
    let depth = 0;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (character === '(') {
        depth += 1;
        continue;
      }
      if (character === ')') {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (/\s/.test(character) && depth === 0) break;
    }
    destination = text.slice(begin, index);
  }

  while (index < text.length && /\s/.test(text[index])) index += 1;

  let title = null;
  if (['"', "'", '('].includes(text[index])) {
    const quote = text[index] === '(' ? ')' : text[index];
    const end = text.indexOf(quote, index + 1);
    if (end === -1) return null;
    title = text.slice(index + 1, end);
    index = end + 1;
    while (index < text.length && /\s/.test(text[index])) index += 1;
  }

  if (text[index] !== ')') return null;
  return {
    dest: destination.replace(/\\([\\()<>"'])/g, '$1'),
    title,
    next: index + 1,
  };
}

function parseEmphasis(text, start, ctx) {
  const marker = text[start];
  const double = text[start + 1] === marker;
  const length = double ? 2 : 1;
  const nextCharacter = text[start + length];
  if (!nextCharacter || /\s/.test(nextCharacter)) return null;

  if (marker === '_') {
    const previous = text[start - 1];
    if (previous && /[A-Za-z0-9]/.test(previous)) return null;
  }

  const token = marker.repeat(length);
  let searchFrom = start + length;
  while (searchFrom < text.length) {
    const found = text.indexOf(token, searchFrom);
    if (found === -1) return null;
    if (found === start + length) {
      searchFrom = found + 1;
      continue;
    }
    if (marker === '_' && /[A-Za-z0-9]/.test(text[found - 1] || '')) {
      searchFrom = found + 1;
      continue;
    }
    const inner = text.slice(start + length, found);
    if (!inner.trim()) {
      searchFrom = found + 1;
      continue;
    }
    const children = renderInline(inner, ctx);
    return {
      node: double ? <strong>{children}</strong> : <em>{children}</em>,
      next: found + length,
    };
  }
  return null;
}

function parseLinkOrImage(text, bracketStart, isImage, ctx) {
  const bracketEnd = findMatchingBracket(text, bracketStart);
  if (bracketEnd === -1) return null;
  if (text[bracketEnd + 1] !== '(') return null;

  const destination = parseDestination(text, bracketEnd + 1);
  if (!destination) return null;

  const label = text.slice(bracketStart + 1, bracketEnd);

  if (isImage) {
    return {
      node: (
        <LmccImage
          src={destination.dest}
          alt={plainText(label)}
          root={ctx.root}
          baseDir={ctx.baseDir}
        />
      ),
      next: destination.next,
    };
  }

  const children = renderInline(label, ctx);
  if (!isSafeLink(destination.dest)) {
    return {
      node: (
        <span className="lmcc-md-link-blocked" title={destination.dest}>
          {children}
        </span>
      ),
      next: destination.next,
    };
  }

  return {
    node: renderAnchor(destination.dest, children, destination.title),
    next: destination.next,
  };
}

function parseInlineNodes(text, ctx) {
  const nodes = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer) {
      nodes.push(decodeEntities(buffer));
      buffer = '';
    }
  };

  while (index < text.length) {
    const character = text[index];

    if (
      character === '\\' &&
      index + 1 < text.length &&
      ESCAPABLE.test(text[index + 1])
    ) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (character === '`') {
      const fenceMatch = /^(`+)/.exec(text.slice(index));
      const fence = fenceMatch[1];
      const closeIndex = text.indexOf(fence, index + fence.length);
      if (closeIndex !== -1) {
        flush();
        let code = text
          .slice(index + fence.length, closeIndex)
          .replace(/\n/g, ' ');
        if (
          code.length > 2 &&
          code.startsWith(' ') &&
          code.endsWith(' ') &&
          code.trim()
        ) {
          code = code.slice(1, -1);
        }
        nodes.push(<code>{code}</code>);
        index = closeIndex + fence.length;
        continue;
      }
    }

    if (character === '!' && text[index + 1] === '[') {
      const image = parseLinkOrImage(text, index + 1, true, ctx);
      if (image) {
        flush();
        nodes.push(image.node);
        index = image.next;
        continue;
      }
    }

    if (character === '[') {
      const link = parseLinkOrImage(text, index, false, ctx);
      if (link) {
        flush();
        nodes.push(link.node);
        index = link.next;
        continue;
      }
    }

    if (character === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(
        text.slice(index)
      );
      if (auto) {
        flush();
        nodes.push(renderAnchor(auto[1], auto[1]));
        index += auto[0].length;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const emphasis = parseEmphasis(text, index, ctx);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.next;
        continue;
      }
    }

    if (character === '\n') {
      const hardBreak = / {2,}$/.test(buffer) || /\\$/.test(buffer);
      if (hardBreak) {
        buffer = buffer.replace(/ {2,}$/, '').replace(/\\$/, '');
        flush();
        nodes.push(<br />);
      } else {
        buffer += ' ';
      }
      index += 1;
      continue;
    }

    buffer += character;
    index += 1;
  }

  flush();
  return nodes;
}

function renderInline(text, ctx) {
  return parseInlineNodes(text, ctx).map((node, index) =>
    typeof node === 'string'
      ? node
      : React.cloneElement(node, { key: `i${index}` })
  );
}

// ---- block rendering -----------------------------------------------------

function renderListItem(blocks, ctx) {
  if (blocks[0]?.type === 'paragraph') {
    const [first, ...rest] = blocks;
    return (
      <>
        {renderInline(first.text, ctx)}
        {rest.length ? renderBlocks(rest, ctx) : null}
      </>
    );
  }
  return renderBlocks(blocks, ctx);
}

function renderBlocks(blocks, ctx) {
  return blocks.map((block, index) => {
    const key = `b${index}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}`;
        return <Tag key={key}>{renderInline(block.text, ctx)}</Tag>;
      }
      case 'paragraph':
        return <p key={key}>{renderInline(block.text, ctx)}</p>;
      case 'code':
        return (
          <div className="lmcc-md-code" key={key}>
            <div className="lmcc-md-code-head">
              <span>{block.lang || 'text'}</span>
            </div>
            <pre>
              <code>{block.text}</code>
            </pre>
          </div>
        );
      case 'hr':
        return <hr key={key} />;
      case 'blockquote':
        return (
          <blockquote key={key}>
            {renderBlocks(block.children, ctx)}
          </blockquote>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        const start =
          block.ordered && block.start && block.start !== 1
            ? block.start
            : undefined;
        return (
          <Tag key={key} start={start}>
            {block.items.map((itemBlocks, itemIndex) => (
              <li key={`li${itemIndex}`}>
                {renderListItem(itemBlocks, ctx)}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div className="lmcc-md-table-wrap" key={key}>
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th
                      key={`h${cellIndex}`}
                      style={{ textAlign: block.alignments[cellIndex] || undefined }}
                    >
                      {renderInline(cell, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`r${rowIndex}`}>
                    {block.header.map((_cell, cellIndex) => (
                      <td
                        key={`c${cellIndex}`}
                        style={{
                          textAlign: block.alignments[cellIndex] || undefined,
                        }}
                      >
                        {renderInline(row[cellIndex] ?? '', ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

/**
 * Safe Markdown renderer for question statements.
 *
 * Supports headings, paragraphs, fenced code, lists, tables, blockquotes,
 * inline code, emphasis, links (http/https/mailto only) and images. Raw HTML
 * is never interpreted.
 */
export default function Markdown({ source, root, baseDir }) {
  const content = React.useMemo(
    () => renderBlocks(parseBlocks(normalizeSource(source).split('\n')), {
      root,
      baseDir,
    }),
    [source, root, baseDir]
  );

  return <div className="lmcc-markdown">{content}</div>;
}
