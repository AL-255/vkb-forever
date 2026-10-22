// Color values explicitly requested from the reference; all visual assets and
// layout remain independently drawn and implemented.
export const SINGER_THEMES = [
  { singer: 'VY1', accent: '#fb6d6d', background: '#fdece7' },
  { singer: 'MIKU', accent: '#29c8c8', background: '#dcf3ef' },
  { singer: 'MEG', accent: '#3ecd54', background: '#d8fbce' },
  { singer: 'IA', accent: '#d06d6d', background: '#fae7e7' },
  { singer: 'YUKARI', accent: '#9c66d6', background: '#f2e4f7' }
];
function luminance(color) {
  const channels = color.slice(1).match(/../g).map(hex => {
    const v = parseInt(hex, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function readableInk(accent, background) {
  const channels = accent.slice(1).match(/../g).map(hex => parseInt(hex, 16));
  // Preserve the hue while darkening text to contrast against its pale surface.
  for (let factor = 1; factor >= 0; factor -= 0.05) {
    const color = '#' + channels.map(v => Math.round(v * factor).toString(16).padStart(2, '0')).join('');
    if ((luminance(background) + 0.05) / (luminance(color) + 0.05) >= 4.5) return color;
  }
  return '#000000';
}
export function applySingerTheme(element, singerIndex = null) {
  const theme = SINGER_THEMES[singerIndex];
  if (!theme) {
    delete element.dataset.singer;
    for (const name of ['accent','background','ink','on-accent']) element.style.removeProperty('--singer-' + name);
    return;
  }
  element.dataset.singer = theme.singer;
  element.style.setProperty('--singer-accent', theme.accent);
  element.style.setProperty('--singer-background', theme.background);
  element.style.setProperty('--singer-ink', readableInk(theme.accent, theme.background));
  const light = luminance(theme.accent);
  element.style.setProperty('--singer-on-accent', (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? '#000000' : '#ffffff');
}
