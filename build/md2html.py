# -*- coding: utf-8 -*-
"""把推广说明的 Markdown 转成可直接双击打开的单文件 HTML"""
import os
import re
import html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = r"C:\Users\Survaetr ExcelzZ\Desktop\SMUCL推广素材\给推广同学的说明.md"
DST = r"C:\Users\Survaetr ExcelzZ\Desktop\SMUCL推广素材\给推广同学的说明.html"


def inline(s):
    s = html.escape(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    return s


def convert(md):
    lines = md.split("\n")
    out = []
    i = 0
    in_ul = False
    in_ol = False
    in_quote = False

    def close_lists():
        nonlocal in_ul, in_ol, in_quote
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False
        if in_quote:
            out.append("</blockquote>")
            in_quote = False

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        if not s:
            close_lists()
            i += 1
            continue

        if s.startswith("---") and set(s) <= {"-"}:
            close_lists()
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            close_lists()
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if s.startswith("|"):
            close_lists()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            if len(rows) >= 2:
                head = rows[0]
                body = [r for r in rows[2:]]
                out.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>")
                for r in body:
                    out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
                out.append("</tbody></table>")
            continue

        if s.startswith(">"):
            if not in_quote:
                close_lists()
                out.append("<blockquote>")
                in_quote = True
            out.append(f"<p>{inline(s.lstrip('>').strip())}</p>")
            i += 1
            continue

        if re.match(r"^[-*]\s+", s):
            if not in_ul:
                close_lists()
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline(re.sub(r'^[-*]\s+', '', s))}</li>")
            i += 1
            continue

        if re.match(r"^\d+\.\s+", s):
            if not in_ol:
                close_lists()
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{inline(re.sub(r'^\d+\.\s+', '', s))}</li>")
            i += 1
            continue

        close_lists()
        out.append(f"<p>{inline(s)}</p>")
        i += 1

    close_lists()
    return "\n".join(out)


CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 56px 24px 96px;
  background: #f6f8fb; color: #1b2432;
  font: 15px/1.85 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.page { max-width: 820px; margin: 0 auto; }
h1 {
  font-size: 30px; line-height: 1.35; margin: 0 0 8px;
  letter-spacing: -0.02em;
}
h1 + p { color: #667; margin-top: 0; }
h2 {
  font-size: 20px; margin: 44px 0 14px; padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
}
h3 { font-size: 16px; margin: 28px 0 10px; color: #2c3a4e; }
p { margin: 10px 0; }
blockquote {
  margin: 14px 0; padding: 14px 18px;
  background: #fff; border-left: 3px solid #3b7dd8;
  border-radius: 0 8px 8px 0; color: #33415a;
}
blockquote p { margin: 6px 0; }
ul, ol { padding-left: 22px; margin: 10px 0; }
li { margin: 5px 0; }
code {
  font-family: "Cascadia Mono", Consolas, monospace; font-size: 13px;
  background: #eaeef6; padding: 1px 6px; border-radius: 4px; color: #2b4a7a;
}
strong { color: #101a2b; }
table {
  width: 100%; border-collapse: collapse; margin: 16px 0;
  background: #fff; border-radius: 10px; overflow: hidden;
  box-shadow: 0 1px 2px rgba(16,26,42,.06);
}
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #edf1f7; font-size: 13.5px; }
th { background: #f0f4fa; font-weight: 600; color: #2c3a4e; }
tr:last-child td { border-bottom: none; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 36px 0; }
a { color: #2f6fd0; }
@media print {
  body { background: #fff; padding: 0; }
  h2 { page-break-after: avoid; }
  table, blockquote { page-break-inside: avoid; }
}
"""


def main():
    md = open(SRC, encoding="utf-8").read()
    body = convert(md)
    doc = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SMUCL 推广素材包</title>
<style>{CSS}</style></head>
<body><div class="page">
{body}
</div></body></html>"""
    open(DST, "w", encoding="utf-8").write(doc)
    print("生成:", DST, round(os.path.getsize(DST) / 1024, 1), "KB")


if __name__ == "__main__":
    main()
