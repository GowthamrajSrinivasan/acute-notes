/** The id of the div AppShell renders beside the canvas, which `LensPanelHost` portals the Lens panel into. Its own
 * module so the shell never imports the canvas-side Lens tree (Excalidraw touches `window` at import). */
export const LENS_SLOT_ID = "acute-lens-slot";
