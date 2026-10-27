const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

async function extractPdfPages(buffer) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
  }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({
      pageNumber,
      width: page.view[2] - page.view[0],
      height: page.view[3] - page.view[1],
      items: content.items
        .filter((item) => item.str && item.str.trim())
        .map((item) => ({
          text: item.str.trim(),
          x: item.transform[4],
          // PDF.js transform y origin is bottom-left.
          y: page.view[3] - item.transform[5],
          width: item.width || 0,
          height: item.height || 0,
        })),
    });
  }

  return { pageCount: pdf.numPages, pages };
}

async function detectPdfType(buffer) {
  const parsed = await extractPdfPages(buffer);
  const text = parsed.pages
    .map((p) => p.items.map((i) => i.text).join(" "))
    .join("\n")
    .toLowerCase();

  let type = "student_feedback";
  if (
    text.includes("department summary") &&
    (text.includes("department average response") || /\bdfi\b/.test(text)) &&
    text.includes("course code")
  ) {
    type = "department_summary";
  } else if (
    text.includes("action taken report") ||
    (text.includes("action taken") && text.includes("appreciation"))
  ) {
    type = "action_taken";
  }

  return { type, pageCount: parsed.pageCount, text, pages: parsed.pages };
}

module.exports = { extractPdfPages, detectPdfType };
