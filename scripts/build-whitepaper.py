"""Build the shareable PDF from the versioned Markdown research draft.

Optional documentation dependency: reportlab==5.0.1.
Run from the repository root: python scripts/build-whitepaper.py
"""
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/whitepaper.md'
OUTPUT = ROOT / 'output/pdf/adaptive-inference-network-whitepaper-v0.2.pdf'


def inline(value):
    value = html.escape(value)
    value = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'`(.+?)`', r'<font name="Courier" size="9">\1</font>', value)
    value = re.sub(r'(https://[^\s<]+)', r'<link href="\1" color="#345465">\1</link>', value)
    return value


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='PaperBody', fontName='Helvetica', fontSize=10.4,
                              leading=15.3, spaceAfter=10, textColor=colors.HexColor('#202a30'),
                              alignment=TA_LEFT, splitLongWords=True))
    styles.add(ParagraphStyle(name='PaperTitle', fontName='Helvetica-Bold', fontSize=29,
                              leading=34, spaceAfter=20, textColor=colors.HexColor('#17262e')))
    styles.add(ParagraphStyle(name='PaperSection', fontName='Helvetica-Bold', fontSize=19,
                              leading=24, spaceAfter=18, keepWithNext=True))
    styles.add(ParagraphStyle(name='PaperSub', fontName='Helvetica-Bold', fontSize=11,
                              leading=16, spaceBefore=8, spaceAfter=8, keepWithNext=True))
    styles.add(ParagraphStyle(name='PaperBullet', parent=styles['PaperBody'],
                              leftIndent=12, firstLineIndent=-10, spaceAfter=5))
    story = []
    for chunk in SOURCE.read_text(encoding='utf-8').split('\n\n'):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk == '<!-- pagebreak -->':
            story.append(PageBreak())
        elif chunk.startswith('# '):
            story.extend([Spacer(1, 14), Paragraph(inline(chunk[2:]), styles['PaperTitle'])])
        elif chunk.startswith('## '):
            story.append(Paragraph(inline(chunk[3:]), styles['PaperSection']))
        elif chunk.startswith('### '):
            story.append(Paragraph(inline(chunk[4:]), styles['PaperSub']))
        elif chunk.startswith('- '):
            for line in chunk.splitlines():
                story.append(Paragraph('- ' + inline(line[2:]), styles['PaperBullet']))
        else:
            story.append(Paragraph(inline(chunk.replace('\n', ' ')), styles['PaperBody']))

    def page(canvas, document):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(colors.HexColor('#ccd4d7'))
        canvas.line(52, height - 39, width - 52, height - 39)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#53656f'))
        canvas.drawString(52, height - 29, 'ADAPTIVE INFERENCE NETWORK')
        canvas.drawRightString(width - 52, height - 29, 'RESEARCH DRAFT / v0.2')
        canvas.drawString(52, 29, 'Kilian Codaccioni  |  30 September 2026')
        canvas.drawRightString(width - 52, 29, str(document.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, topMargin=57, bottomMargin=54,
                            leftMargin=52, rightMargin=52,
                            title='Adaptive Inference Network - White Paper v0.2',
                            author='Kilian Codaccioni', subject='Research proposal and prototype boundaries')
    doc.build(story, onFirstPage=page, onLaterPages=page)
    print(OUTPUT)


if __name__ == '__main__':
    main()
