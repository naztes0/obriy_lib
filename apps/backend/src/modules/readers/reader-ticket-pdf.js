import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const regularFontPath = fileURLToPath(
  import.meta.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff'),
);
const boldFontPath = fileURLToPath(
  import.meta.resolve('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff'),
);
const latinRegularFontPath = fileURLToPath(
  import.meta.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
);
const latinBoldFontPath = fileURLToPath(
  import.meta.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'),
);

function formatDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function drawMixedSingleLine(document, value, x, y, { fontSize, color, bold = false }) {
  const parts = String(value).match(/[\p{Script=Cyrillic}]+|[^\p{Script=Cyrillic}]+/gu) ?? [];
  let offset = 0;
  for (const part of parts) {
    const isCyrillic = /\p{Script=Cyrillic}/u.test(part);
    const font = isCyrillic
      ? bold
        ? 'NotoSansBold'
        : 'NotoSans'
      : bold
        ? 'NotoSansLatinBold'
        : 'NotoSansLatin';
    document.font(font).fontSize(fontSize).fillColor(color).text(part, x + offset, y, {
      lineBreak: false,
    });
    offset += document.widthOfString(part);
  }
}

export function generateReaderTicketPdf(ticket) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A6',
      layout: 'landscape',
      margin: 0,
      info: {
        Title: `Електронний читацький квиток ${ticket.ticketNumber}`,
        Author: 'Бібліотека ліцею «Обрій»',
      },
    });
    const chunks = [];

    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.registerFont('NotoSans', regularFontPath);
    document.registerFont('NotoSansBold', boldFontPath);
    document.registerFont('NotoSansLatin', latinRegularFontPath);
    document.registerFont('NotoSansLatinBold', latinBoldFontPath);

    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    const blue = '#1d4f91';
    const dark = '#172033';
    const muted = '#5f6b7a';

    document.rect(0, 0, pageWidth, pageHeight).fill('#f7f9fc');
    document.rect(0, 0, pageWidth, 58).fill(blue);
    document.lineWidth(2).roundedRect(12, 12, pageWidth - 24, pageHeight - 24, 10).stroke(blue);

    document
      .font('NotoSansBold')
      .fontSize(17)
      .fillColor('#ffffff')
      .text('БІБЛІОТЕКА ЛІЦЕЮ ОБРІЙ', 28, 17, { width: pageWidth - 56 });
    document
      .font('NotoSans')
      .fontSize(8)
      .text('ЕЛЕКТРОННИЙ ЧИТАЦЬКИЙ КВИТОК', 28, 40, { characterSpacing: 0.7 });

    document
      .font('NotoSansBold')
      .fontSize(10)
      .fillColor(muted)
      .text('НОМЕР КВИТКА', 28, 78);
    document
      .font('NotoSansLatinBold')
      .fontSize(22)
      .fillColor(blue)
      .text(ticket.ticketNumber, 28, 92, { width: 155 });

    document
      .font('NotoSans')
      .fontSize(8)
      .fillColor(muted)
      .text('ЧИТАЧ', 205, 78)
      .font('NotoSansBold')
      .fontSize(12)
      .fillColor(dark)
      .text(ticket.fullName, 205, 91, { width: pageWidth - 233, height: 36 });

    document.font('NotoSans').fontSize(8).fillColor(muted).text('КЛАС', 28, 143);
    drawMixedSingleLine(document, ticket.className, 28, 156, {
      fontSize: 11,
      color: dark,
      bold: true,
    });

    document
      .font('NotoSans')
      .fontSize(8)
      .fillColor(muted)
      .text('СФОРМОВАНО', 162, 143)
      .font('NotoSansLatinBold')
      .fontSize(11)
      .fillColor(dark)
      .text(formatDate(ticket.ticketIssuedOn), 162, 156, { width: 100 });

    document
      .font('NotoSans')
      .fontSize(8)
      .fillColor(muted)
      .text('ДІЙСНИЙ ДО', 280, 143)
      .font('NotoSansLatinBold')
      .fontSize(11)
      .fillColor(dark)
      .text(formatDate(ticket.ticketExpiresOn), 280, 156, { width: 110 });

    document
      .moveTo(28, 196)
      .lineTo(pageWidth - 28, 196)
      .lineWidth(0.7)
      .stroke('#c8d1df');
    document
      .font('NotoSans')
      .fontSize(7.5)
      .fillColor(muted)
      .text('Квиток є персональним і використовується для обслуговування в бібліотеці', 28, 207, {
        width: pageWidth - 56,
        align: 'center',
      });

    document.end();
  });
}
