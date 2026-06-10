export function placeFloatingPanel(panelEl: HTMLElement): void {
  panelEl.style.position = "fixed";
  panelEl.style.right = "24px";
  panelEl.style.bottom = "88px";
  panelEl.style.left = "";
  panelEl.style.top = "";
  panelEl.style.zIndex = "2147483646";
  panelEl.style.maxHeight = "calc(100vh - 112px)";
  panelEl.style.overflow = "auto";
}
