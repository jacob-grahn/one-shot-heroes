/** Static tables: tool buttons, drawing tools, animation tag colours. */

export const ANIM_COLORS = ['#ff5d8f', '#41a6f6', '#a7f070', '#ffcd75', '#b48cff', '#ef7d57', '#73eff7', '#f4f4f4'];

export const TOOLS = [
  ['pencil', 'Pencil (B)', '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>'],
  ['eraser', 'Eraser (E)', '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-8 8H8z"/>'],
  ['fill', 'Fill (G)', '<path d="M5 12l7-7 7 7-7 7z"/><path d="M19 15c1 2 2 3 2 4a2 2 0 01-4 0c0-1 1-2 2-4z"/>'],
  ['picker', 'Eyedropper (I)', '<path d="M14 4l6 6"/><path d="M17 7L7 17l-3 3"/><path d="M11 9l4 4"/>'],
  ['sep'],
  ['line', 'Line (L)', '<path d="M5 19L19 5"/>'],
  ['rect', 'Rectangle (U)', '<rect x="4" y="6" width="16" height="12"/>'],
  ['ellipse', 'Ellipse (Shift+U)', '<ellipse cx="12" cy="12" rx="8" ry="6"/>'],
  ['sep'],
  ['select', 'Rectangular selection (M)', '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />'],
];
export const DRAW_TOOLS = ['pencil', 'eraser', 'fill', 'line', 'rect', 'ellipse'];
