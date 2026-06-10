export function injectContentFonts(): void {
  if (document.getElementById("clapback-content-fonts")) return;

  const getURL = getRuntimeURL();
  if (!getURL) return;

  const style = document.createElement("style");
  style.id = "clapback-content-fonts";
  style.textContent = `
    @font-face {
      font-family: "Liu Jian Mao Cao";
      src: url("${getURL("fonts/LiuJianMaoCao-Regular.woff2")}") format("woff2");
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }
  `;
  document.head.append(style);
}

function getRuntimeURL(): ((path: string) => string) | null {
  const runtime = (globalThis as unknown as {
    chrome?: { runtime?: { getURL?: (path: string) => string } };
  }).chrome?.runtime;

  if (runtime && typeof runtime.getURL === "function") {
    return runtime.getURL.bind(runtime);
  }
  return null;
}
