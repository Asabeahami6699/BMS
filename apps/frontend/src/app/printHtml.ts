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

  let printed = false;
  const trigger = () => {
    if (printed) {
      return;
    }
    printed = true;
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      // Keep the iframe briefly so Chrome can finish preparing the print job.
      window.setTimeout(cleanup, 1000);
    }
  };

  const waitForImagesAndPrint = () => {
    const images = Array.from(frameDocument.images ?? []);
    const pending = images.filter((img) => !img.complete);
    if (pending.length === 0) {
      window.setTimeout(trigger, 250);
      return;
    }
    let remaining = pending.length;
    const onDone = () => {
      remaining -= 1;
      if (remaining <= 0) {
        window.setTimeout(trigger, 150);
      }
    };
    for (const img of pending) {
      img.addEventListener("load", onDone, { once: true });
      img.addEventListener("error", onDone, { once: true });
    }
    window.setTimeout(trigger, 2500);
  };

  if (frameDocument.readyState === "complete") {
    waitForImagesAndPrint();
  } else {
    iframe.onload = () => waitForImagesAndPrint();
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
