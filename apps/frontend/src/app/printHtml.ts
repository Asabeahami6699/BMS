/** Open HTML in a hidden iframe and trigger the browser print dialog. */
export function printHtmlDocument(html: string, blockedMessage: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print document");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument ?? frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error(blockedMessage);
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  const cleanup = () => {
    iframe.remove();
  };

  const trigger = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      // Keep the iframe briefly so Chrome can finish preparing the print job.
      window.setTimeout(cleanup, 1000);
    }
  };

  if (frameDocument.readyState === "complete") {
    window.setTimeout(trigger, 300);
  } else {
    iframe.onload = () => window.setTimeout(trigger, 300);
  }
}

export function downloadHtmlDocument(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
